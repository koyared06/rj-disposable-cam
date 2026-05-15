import { NextRequest, NextResponse } from "next/server";
import { findCameraPhotoById, updateCameraPhoto } from "@/lib/camera-photos";
import { resolveCameraVisibilityAt } from "@/lib/camera-visibility";
import { validateAdmin } from "@/lib/admin-auth";
import { cameraModerationSchema } from "@/lib/schemas";
import { readWeddingSettings } from "@/lib/wedding-settings";

export const dynamic = "force-dynamic";

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
