import { NextRequest, NextResponse } from "next/server";
import {
  deleteCameraPhotoRow,
  findCameraPhotoById,
  updateCameraPhoto,
} from "@/lib/camera-photos";
import { resolveCameraVisibilityAt } from "@/lib/camera-visibility";
import { validateAdmin } from "@/lib/admin-auth";
import { cameraModerationSchema } from "@/lib/schemas";
import { readWeddingSettings } from "@/lib/wedding-settings";
import { deleteDriveFile } from "@/lib/drive-camera";

export const dynamic = "force-dynamic";

function isDriveNotFoundError(error: unknown) {
  const status = Number(
    (error as { response?: { status?: number } } | null)?.response?.status ?? 0,
  );
  if (status === 404) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b404\b/.test(message) || /not\s*found/i.test(message);
}

export async function PATCH(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = cameraModerationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid moderation payload." },
        { status: 400 },
      );
    }

    const existing = await findCameraPhotoById(parsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const settings = await readWeddingSettings();

    const updated = { ...existing };
    if (parsed.data.action === "approve") {
      updated.status = "approved";
      updated.rejectionReason = "";
      updated.hiddenAt = "";
      updated.visibilityAt = resolveCameraVisibilityAt(settings, nowIso);
    }

    if (parsed.data.action === "hide") {
      updated.status = "hidden";
      updated.hiddenAt = nowIso;
      updated.rejectionReason = "";
    }

    if (parsed.data.action === "reject") {
      updated.status = "rejected";
      updated.rejectionReason = parsed.data.rejectionReason?.trim() ?? "";
      updated.hiddenAt = "";
    }

    await updateCameraPhoto(existing.rowNumber, {
      id: updated.id,
      createdAt: updated.createdAt,
      inviteCode: updated.inviteCode,
      uploaderName: updated.uploaderName,
      driveFileId: updated.driveFileId,
      previewDriveFileId: updated.previewDriveFileId,
      mimeType: updated.mimeType,
      fileSizeBytes: updated.fileSizeBytes,
      width: updated.width,
      height: updated.height,
      status: updated.status,
      visibilityAt: updated.visibilityAt,
      rejectionReason: updated.rejectionReason,
      hiddenAt: updated.hiddenAt,
    });

    return NextResponse.json({
      ok: true,
      photo: {
        id: updated.id,
        status: updated.status,
        visibilityAt: updated.visibilityAt,
        rejectionReason: updated.rejectionReason,
        hiddenAt: updated.hiddenAt,
      },
    });
  } catch (error) {
    console.error("Camera moderation error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown camera moderation error.";
    return NextResponse.json(
      {
        error: "Unable to moderate photo right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Photo ID is required." }, { status: 400 });
    }

    const existing = await findCameraPhotoById(id);
    if (!existing) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    const driveIds = Array.from(
      new Set(
        [existing.previewDriveFileId, existing.driveFileId]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );

    for (const driveId of driveIds) {
      try {
        await deleteDriveFile(driveId);
      } catch (error) {
        if (!isDriveNotFoundError(error)) {
          throw error;
        }
      }
    }

    await deleteCameraPhotoRow(existing.rowNumber);

    return NextResponse.json({
      ok: true,
      deleted: {
        id: existing.id,
      },
    });
  } catch (error) {
    console.error("Camera delete error:", error);
    const details = error instanceof Error ? error.message : "Unknown camera delete error.";
    return NextResponse.json(
      {
        error: "Unable to delete photo right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
