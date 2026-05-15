import { NextResponse } from "next/server";
import { appendCameraPhoto, countCameraPhotosByInvite } from "@/lib/camera-photos";
import { processCameraImage } from "@/lib/camera-image";
import { resolveCameraVisibilityAt } from "@/lib/camera-visibility";
import { buildCameraUploaderCode, verifyCameraQrToken } from "@/lib/camera-qr";
import { resolveCameraDriveFolders, uploadImageToDrive } from "@/lib/drive-camera";
import { getDriveCameraEnv } from "@/lib/env";
import { findGuestByInviteCredentials } from "@/lib/guest-access";
import { cameraUploadMetaSchema } from "@/lib/schemas";
import { readWeddingSettings } from "@/lib/wedding-settings";

export const runtime = "nodejs";

function readFormText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeIntegerField(value: FormDataEntryValue | null): number {
  if (!value || typeof value !== "string") return 0;
  const parsed = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

function buildDriveFileName(inviteCode: string, extension: string) {
  const safeInviteCode = inviteCode.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40) || "guest";
  const stamp = Date.now();
  return `camera-${safeInviteCode}-${stamp}.${extension}`;
}

function classifyUploadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const responseStatus = Number(
    (error as { response?: { status?: number } } | null)?.response?.status ?? 0,
  );

  if (message.includes("Missing GOOGLE_DRIVE_CAMERA_FOLDER_ID")) {
    return {
      code: "DRIVE_FOLDER_ENV_MISSING",
      hint: "Set GOOGLE_DRIVE_CAMERA_FOLDER_ID in Vercel Project Environment Variables.",
    };
  }

  if (message.includes("Unable to resolve camera folder")) {
    return {
      code: "DRIVE_SUBFOLDER_RESOLUTION_FAILED",
      hint: "Verify service-account Editor access to the camera folder/shared drive.",
    };
  }

  if (message.includes("CAMERA_WATERMARK_PROCESSING_FAILED")) {
    return {
      code: "WATERMARK_PROCESSING_FAILED",
      hint: "Watermark processing failed. Check image format support and Vercel function logs.",
    };
  }

  if (message.includes("Sheet not found:") || message.includes("spreadsheets")) {
    return {
      code: "SHEETS_WRITE_FAILED",
      hint: "Check GOOGLE_SHEETS_SPREADSHEET_ID and ensure service account can edit it.",
    };
  }

  if (responseStatus === 403) {
    return {
      code: "DRIVE_OR_SHEETS_PERMISSION_DENIED",
      hint: "Grant service account Editor access to Drive folder and Google Sheet.",
    };
  }

  if (responseStatus === 404) {
    return {
      code: "DRIVE_OR_SHEETS_RESOURCE_NOT_FOUND",
      hint: "Verify Drive Folder ID and Spreadsheet ID in Vercel env values.",
    };
  }

  return {
    code: "UPLOAD_INTERNAL_ERROR",
    hint: "Check Vercel Function logs for /api/camera/upload.",
  };
}

export async function POST(request: Request) {
  try {
    const settings = await readWeddingSettings();
    if (!settings.cameraEnabled) {
      return NextResponse.json(
        { error: "Guest camera is currently disabled." },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const parsedMeta = cameraUploadMetaSchema.safeParse({
      inviteCode: readFormText(form, "inviteCode"),
      inviteToken: readFormText(form, "inviteToken"),
      eventId: readFormText(form, "eventId"),
      cameraToken: readFormText(form, "cameraToken"),
      deviceId: readFormText(form, "deviceId"),
      uploaderName: readFormText(form, "uploaderName"),
    });

    if (!parsedMeta.success) {
      return NextResponse.json(
        { error: parsedMeta.error.issues[0]?.message ?? "Invalid upload metadata." },
        { status: 400 },
      );
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image uploads are allowed." },
        { status: 400 },
      );
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Image file is empty." }, { status: 400 });
    }

    const maxBytes = settings.cameraMaxUploadMb * 1024 * 1024;
    if (settings.cameraMaxUploadMb > 0 && file.size > maxBytes) {
      return NextResponse.json(
        {
          error: `Image exceeds size limit (${settings.cameraMaxUploadMb} MB max).`,
        },
        { status: 400 },
      );
    }

    const payload = parsedMeta.data;
    let actorCode = "";
    let uploaderNameFallback = "";

    const hasInviteCredentials =
      Boolean(payload.inviteCode?.trim()) && Boolean(payload.inviteToken?.trim());
    if (hasInviteCredentials) {
      const guest = await findGuestByInviteCredentials(
        payload.inviteCode ?? "",
        payload.inviteToken ?? "",
      );

      if (guest) {
        actorCode = guest.inviteCode;
        uploaderNameFallback = guest.fullName;
      }
    }

    if (!actorCode) {
      const cameraToken = (payload.cameraToken ?? "").trim();
      const eventId = (payload.eventId ?? "").trim();
      const deviceId = (payload.deviceId ?? "").trim();
      const verified = verifyCameraQrToken(cameraToken, eventId);

      if (!verified || !deviceId) {
        return NextResponse.json(
          { error: "Invalid camera session for upload." },
          { status: 401 },
        );
      }

      actorCode = buildCameraUploaderCode(verified, deviceId);
      uploaderNameFallback = `Guest (${verified.tableCode})`;
    }

    const shotsLimit = settings.cameraShotLimitPerInvite;
    const shotsUsed = await countCameraPhotosByInvite(actorCode);
    if (shotsLimit > 0 && shotsUsed >= shotsLimit) {
      return NextResponse.json(
        {
          error: `Shot limit reached (${shotsLimit} per invite).`,
          usage: {
            shotsUsed,
            shotsLimit,
            shotsLeft: 0,
          },
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const uploadBuffer = Buffer.from(await file.arrayBuffer());
    const driveEnv = getDriveCameraEnv();

    const rootFolderId = driveEnv.folderId;
    if (!rootFolderId) {
      throw new Error("Missing GOOGLE_DRIVE_CAMERA_FOLDER_ID.");
    }

    const driveFolders = await (async () => {
      try {
        return await resolveCameraDriveFolders();
      } catch (folderError) {
        console.warn("Camera folder resolution failed. Falling back to root folder.", folderError);
        return {
          rootFolderId,
          originalsFolderId: rootFolderId,
          previewsFolderId: rootFolderId,
        };
      }
    })();

    const resolvedUploaderName = payload.uploaderName?.trim() || uploaderNameFallback || "Guest";

    const processed = await processCameraImage(uploadBuffer, {
      line1: driveEnv.watermarkLine1,
      line2: driveEnv.watermarkLine2,
      capturedBy: resolvedUploaderName,
    });

    const originalFileName = buildDriveFileName(actorCode, processed.extension);
    const previewFileName = buildDriveFileName(`${actorCode}-preview`, processed.extension);

    const uploadedOriginal = await uploadImageToDrive({
      buffer: processed.originalBuffer,
      fileName: originalFileName,
      mimeType: processed.mimeType,
      parentFolderId: driveFolders.originalsFolderId,
    });

    const uploadedPreview = await (async () => {
      try {
        return await uploadImageToDrive({
          buffer: processed.previewBuffer,
          fileName: previewFileName,
          mimeType: processed.mimeType,
          parentFolderId: driveFolders.previewsFolderId,
        });
      } catch (previewUploadError) {
        console.warn("Preview upload failed. Falling back to original file reference.", previewUploadError);
        return uploadedOriginal;
      }
    })();

    const status = settings.cameraRequireApproval ? "pending" : "approved";
    const visibilityAt = resolveCameraVisibilityAt(settings, nowIso);
    const width = normalizeIntegerField(form.get("width")) || processed.width;
    const height = normalizeIntegerField(form.get("height")) || processed.height;

    const saved = await appendCameraPhoto({
      inviteCode: actorCode,
      uploaderName: resolvedUploaderName,
      driveFileId: uploadedOriginal.fileId,
      previewDriveFileId: uploadedPreview.fileId,
      mimeType: uploadedOriginal.mimeType,
      fileSizeBytes: uploadedOriginal.size || processed.originalBuffer.byteLength,
      width,
      height,
      status,
      visibilityAt,
      rejectionReason: "",
      hiddenAt: "",
    });

    return NextResponse.json({
      ok: true,
      photo: {
        id: saved.id,
        createdAt: saved.createdAt,
        inviteCode: saved.inviteCode,
        uploaderName: saved.uploaderName,
        status: saved.status,
        visibilityAt: saved.visibilityAt,
      },
      usage: {
        shotsUsed: shotsUsed + 1,
        shotsLimit,
        shotsLeft:
          shotsLimit > 0 ? Math.max(0, shotsLimit - (shotsUsed + 1)) : null,
      },
    });
  } catch (error) {
    console.error("Camera upload error:", error);
    const classified = classifyUploadFailure(error);
    const details = error instanceof Error ? error.message : "Unknown camera upload error.";
    return NextResponse.json(
      {
        error: "Unable to upload photo right now.",
        errorCode: classified.code,
        hint: classified.hint,
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
