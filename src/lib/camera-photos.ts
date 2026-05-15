import { randomUUID } from "crypto";
import { getCameraPhotosSheetName } from "@/lib/env";
import {
  cameraPhotoToArray,
  type CameraPhotoRow,
  toCameraPhotoRow,
} from "@/lib/sheet-models";
import {
  appendRow,
  ensureSheetWithHeaders,
  readRows,
  updateRow,
} from "@/lib/sheets";

const CAMERA_PHOTOS_HEADERS = [
  "id",
  "createdAt",
  "inviteCode",
  "uploaderName",
  "driveFileId",
  "previewDriveFileId",
  "mimeType",
  "fileSizeBytes",
  "width",
  "height",
  "status",
  "visibilityAt",
  "rejectionReason",
  "hiddenAt",
];

export async function ensureCameraPhotosSheet() {
  await ensureSheetWithHeaders(getCameraPhotosSheetName(), CAMERA_PHOTOS_HEADERS);
}

export async function readCameraPhotos(): Promise<CameraPhotoRow[]> {
  await ensureCameraPhotosSheet();
  const rows = await readRows(`${getCameraPhotosSheetName()}!A2:N`);
  return rows.map((row, index) => toCameraPhotoRow(row, index + 2));
}

export async function findCameraPhotoById(id: string) {
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedId) return null;

  const photos = await readCameraPhotos();
  return photos.find((photo) => photo.id.trim().toLowerCase() === normalizedId) ?? null;
}

export async function countCameraPhotosByInvite(inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toLowerCase();
  if (!normalizedInviteCode) return 0;

  const photos = await readCameraPhotos();
  return photos.filter(
    (photo) => photo.inviteCode.trim().toLowerCase() === normalizedInviteCode,
  ).length;
}

export async function appendCameraPhoto(
  photo: Omit<CameraPhotoRow, "rowNumber" | "id" | "createdAt"> &
    Partial<Pick<CameraPhotoRow, "id" | "createdAt">>,
) {
  await ensureCameraPhotosSheet();

  const normalized: Omit<CameraPhotoRow, "rowNumber"> = {
    id: (photo.id ?? "").trim() || randomUUID().replace(/-/g, ""),
    createdAt: photo.createdAt?.trim() || new Date().toISOString(),
    inviteCode: photo.inviteCode,
    uploaderName: photo.uploaderName,
    driveFileId: photo.driveFileId,
    previewDriveFileId: photo.previewDriveFileId,
    mimeType: photo.mimeType,
    fileSizeBytes: photo.fileSizeBytes,
    width: photo.width,
    height: photo.height,
    status: photo.status,
    visibilityAt: photo.visibilityAt,
    rejectionReason: photo.rejectionReason,
    hiddenAt: photo.hiddenAt,
  };

  await appendRow(`${getCameraPhotosSheetName()}!A2:N`, cameraPhotoToArray(normalized));

  return normalized;
}

export async function updateCameraPhoto(
  rowNumber: number,
  photo: Omit<CameraPhotoRow, "rowNumber">,
) {
  await ensureCameraPhotosSheet();
  await updateRow(getCameraPhotosSheetName(), rowNumber, cameraPhotoToArray(photo));
}
