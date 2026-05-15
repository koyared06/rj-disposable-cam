import { Readable } from "stream";
import { google } from "googleapis";
import { getDriveCameraEnv, getSheetsEnv } from "@/lib/env";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type DriveUploadResult = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  webContentLink: string;
};

export type DriveFileMetadata = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  driveId: string;
};

export type CameraDriveFolders = {
  rootFolderId: string;
  originalsFolderId: string;
  previewsFolderId: string;
};

let cachedCameraFoldersPromise: Promise<CameraDriveFolders> | null = null;
let cachedCameraFoldersKey = "";

function getDriveClient() {
  const env = getSheetsEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: DRIVE_SCOPES,
  });

  return google.drive({ version: "v3", auth });
}

function getRequiredCameraFolderId() {
  const driveEnv = getDriveCameraEnv();
  if (!driveEnv.folderId) {
    throw new Error(
      "Missing GOOGLE_DRIVE_CAMERA_FOLDER_ID. Set this in your environment variables.",
    );
  }
  return driveEnv.folderId;
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findChildFolderByName(
  parentFolderId: string,
  childFolderName: string,
): Promise<string | null> {
  const drive = getDriveClient();
  const driveEnv = getDriveCameraEnv();
  const escapedName = escapeDriveQueryValue(childFolderName);
  const escapedParentId = escapeDriveQueryValue(parentFolderId);

  const response = await drive.files.list({
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    q: `trashed=false and mimeType='${DRIVE_FOLDER_MIME_TYPE}' and name='${escapedName}' and '${escapedParentId}' in parents`,
    fields: "files(id,name)",
    pageSize: 1,
    ...(driveEnv.sharedDriveId
      ? {
          corpora: "drive" as const,
          driveId: driveEnv.sharedDriveId,
        }
      : {}),
  });

  const found = response.data.files?.[0]?.id?.trim();
  return found || null;
}

async function ensureChildFolder(
  parentFolderId: string,
  childFolderName: string,
): Promise<string> {
  const existing = await findChildFolderByName(parentFolderId, childFolderName);
  if (existing) return existing;

  const drive = getDriveClient();
  try {
    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: childFolderName,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: [parentFolderId],
      },
      fields: "id",
    });

    const createdId = created.data.id?.trim();
    if (createdId) return createdId;
  } catch {
    // Another request may create the folder at the same time.
  }

  const foundAfterCreate = await findChildFolderByName(parentFolderId, childFolderName);
  if (foundAfterCreate) return foundAfterCreate;
  throw new Error(`Unable to resolve camera folder "${childFolderName}" in Google Drive.`);
}

async function resolveCameraFoldersInternal(): Promise<CameraDriveFolders> {
  const driveEnv = getDriveCameraEnv();
  const rootFolderId = getRequiredCameraFolderId();

  const originalsFolderId = await ensureChildFolder(
    rootFolderId,
    driveEnv.originalsFolderName,
  );
  const previewsFolderId = await ensureChildFolder(
    rootFolderId,
    driveEnv.previewsFolderName,
  );

  return {
    rootFolderId,
    originalsFolderId,
    previewsFolderId,
  };
}

export async function resolveCameraDriveFolders() {
  const driveEnv = getDriveCameraEnv();
  const cacheKey = [
    driveEnv.folderId,
    driveEnv.sharedDriveId,
    driveEnv.originalsFolderName,
    driveEnv.previewsFolderName,
  ].join("::");

  if (!cachedCameraFoldersPromise || cachedCameraFoldersKey !== cacheKey) {
    cachedCameraFoldersPromise = resolveCameraFoldersInternal();
    cachedCameraFoldersKey = cacheKey;
  }

  return cachedCameraFoldersPromise;
}

export async function uploadImageToDrive(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  parentFolderId?: string;
}) {
  const drive = getDriveClient();
  const parentFolderId = params.parentFolderId ?? getRequiredCameraFolderId();

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: params.fileName,
      mimeType: params.mimeType,
      parents: [parentFolderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.buffer),
    },
    fields: "id,name,mimeType,size,webViewLink,webContentLink",
  });

  const data = response.data;
  if (!data.id) {
    throw new Error("Google Drive upload failed: file ID missing in response.");
  }

  return {
    fileId: data.id,
    name: data.name ?? params.fileName,
    mimeType: data.mimeType ?? params.mimeType,
    size: Number(data.size ?? 0),
    webViewLink: data.webViewLink ?? "",
    webContentLink: data.webContentLink ?? "",
  } satisfies DriveUploadResult;
}

export async function makeDriveFilePublicRead(fileId: string) {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });
}

export function buildDrivePublicImageUrl(fileId: string) {
  const safeId = fileId.trim();
  if (!safeId) return "";
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(safeId)}`;
}

export async function getDriveFileMetadata(fileId: string) {
  const drive = getDriveClient();
  const response = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "id,name,mimeType,size,createdTime,driveId",
  });

  const data = response.data;
  if (!data.id) {
    throw new Error("Google Drive file metadata missing file ID.");
  }

  return {
    fileId: data.id,
    name: data.name ?? "",
    mimeType: data.mimeType ?? "application/octet-stream",
    size: Number(data.size ?? 0),
    createdTime: data.createdTime ?? "",
    driveId: data.driveId ?? "",
  } satisfies DriveFileMetadata;
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const response = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer" },
  );

  const payload = response.data;
  if (!payload) {
    throw new Error("Google Drive download returned an empty body.");
  }

  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload);
  }

  return Buffer.from(payload as Uint8Array);
}
