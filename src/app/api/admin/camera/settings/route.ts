import { NextRequest, NextResponse } from "next/server";
import { validateAdmin } from "@/lib/admin-auth";
import { normalizeCameraCoverUrl } from "@/lib/camera-cover";
import { updateWeddingDateSchema } from "@/lib/schemas";
import {
  calculateCountdownDays,
  readWeddingSettings,
  saveWeddingSettings,
} from "@/lib/wedding-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await readWeddingSettings();
    const normalizedCoverUrl = normalizeCameraCoverUrl(
      settings.cameraCoverImageUrl,
      request.nextUrl.origin,
    );
    return NextResponse.json({
      settings: {
        cameraEnabled: settings.cameraEnabled,
        cameraRequireApproval: settings.cameraRequireApproval,
        cameraGalleryUnlockDate: settings.cameraGalleryUnlockDate,
        cameraGalleryUnlockTime: settings.cameraGalleryUnlockTime,
        cameraMaxUploadMb: settings.cameraMaxUploadMb,
        cameraShotLimitPerInvite: settings.cameraShotLimitPerInvite,
        cameraLandingEnabled: settings.cameraLandingEnabled,
        cameraEventTitle: settings.cameraEventTitle,
        cameraEventSubtitle: settings.cameraEventSubtitle,
        cameraEventDisplayTitle: settings.cameraEventDisplayTitle,
        cameraEventHashtag: settings.cameraEventHashtag,
        cameraEventTagline: settings.cameraEventTagline,
        cameraCoverImageUrl: normalizedCoverUrl,
        cameraStartButtonLabel: settings.cameraStartButtonLabel,
        cameraLastQrEventId: settings.cameraLastQrEventId,
        cameraLastQrTableCode: settings.cameraLastQrTableCode,
        cameraLastQrUrl: settings.cameraLastQrUrl,
        cameraLastQrExpiresAt: settings.cameraLastQrExpiresAt,
        cameraLastQrExpiresInHours: settings.cameraLastQrExpiresInHours,
        cameraLastQrGeneratedAt: settings.cameraLastQrGeneratedAt,
        weddingDate: settings.weddingDate,
        weddingTime: settings.weddingTime,
        showCountdown: settings.showCountdown,
        countdownDays: calculateCountdownDays(settings.weddingDate),
      },
    });
  } catch (error) {
    console.error("Admin camera settings GET error:", error);
    const details =
      error instanceof Error
        ? error.message
        : "Unknown admin camera settings GET error.";
    return NextResponse.json(
      {
        error: "Unable to load camera settings.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateWeddingDateSchema.safeParse({
      weddingDate: "",
      ...body,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid settings payload." },
        { status: 400 },
      );
    }

    const currentSettings = await readWeddingSettings();
    const normalizedCoverUrl = normalizeCameraCoverUrl(
      parsed.data.cameraCoverImageUrl ?? currentSettings.cameraCoverImageUrl,
      request.nextUrl.origin,
    );
    await saveWeddingSettings({
      weddingDate: currentSettings.weddingDate,
      weddingTime: currentSettings.weddingTime,
      showCountdown: currentSettings.showCountdown,
      cameraEnabled: parsed.data.cameraEnabled ?? currentSettings.cameraEnabled,
      cameraRequireApproval:
        parsed.data.cameraRequireApproval ?? currentSettings.cameraRequireApproval,
      cameraGalleryUnlockDate:
        parsed.data.cameraGalleryUnlockDate ?? currentSettings.cameraGalleryUnlockDate,
      cameraGalleryUnlockTime:
        parsed.data.cameraGalleryUnlockTime ?? currentSettings.cameraGalleryUnlockTime,
      cameraMaxUploadMb:
        parsed.data.cameraMaxUploadMb ?? currentSettings.cameraMaxUploadMb,
      cameraShotLimitPerInvite:
        parsed.data.cameraShotLimitPerInvite ??
        currentSettings.cameraShotLimitPerInvite,
      cameraLandingEnabled:
        parsed.data.cameraLandingEnabled ?? currentSettings.cameraLandingEnabled,
      cameraEventTitle:
        parsed.data.cameraEventTitle ?? currentSettings.cameraEventTitle,
      cameraEventSubtitle:
        parsed.data.cameraEventSubtitle ?? currentSettings.cameraEventSubtitle,
      cameraEventDisplayTitle:
        parsed.data.cameraEventDisplayTitle ?? currentSettings.cameraEventDisplayTitle,
      cameraEventHashtag:
        parsed.data.cameraEventHashtag ?? currentSettings.cameraEventHashtag,
      cameraEventTagline:
        parsed.data.cameraEventTagline ?? currentSettings.cameraEventTagline,
      cameraCoverImageUrl: normalizedCoverUrl,
      cameraStartButtonLabel:
        parsed.data.cameraStartButtonLabel ??
        currentSettings.cameraStartButtonLabel,
      cameraLastQrEventId: currentSettings.cameraLastQrEventId,
      cameraLastQrTableCode: currentSettings.cameraLastQrTableCode,
      cameraLastQrUrl: currentSettings.cameraLastQrUrl,
      cameraLastQrExpiresAt: currentSettings.cameraLastQrExpiresAt,
      cameraLastQrExpiresInHours: currentSettings.cameraLastQrExpiresInHours,
      cameraLastQrGeneratedAt: currentSettings.cameraLastQrGeneratedAt,
    });

    const updated = await readWeddingSettings();
    return NextResponse.json({
      ok: true,
      settings: {
        cameraEnabled: updated.cameraEnabled,
        cameraRequireApproval: updated.cameraRequireApproval,
        cameraGalleryUnlockDate: updated.cameraGalleryUnlockDate,
        cameraGalleryUnlockTime: updated.cameraGalleryUnlockTime,
        cameraMaxUploadMb: updated.cameraMaxUploadMb,
        cameraShotLimitPerInvite: updated.cameraShotLimitPerInvite,
        cameraLandingEnabled: updated.cameraLandingEnabled,
        cameraEventTitle: updated.cameraEventTitle,
        cameraEventSubtitle: updated.cameraEventSubtitle,
        cameraEventDisplayTitle: updated.cameraEventDisplayTitle,
        cameraEventHashtag: updated.cameraEventHashtag,
        cameraEventTagline: updated.cameraEventTagline,
        cameraCoverImageUrl: updated.cameraCoverImageUrl,
        cameraStartButtonLabel: updated.cameraStartButtonLabel,
        cameraLastQrEventId: updated.cameraLastQrEventId,
        cameraLastQrTableCode: updated.cameraLastQrTableCode,
        cameraLastQrUrl: updated.cameraLastQrUrl,
        cameraLastQrExpiresAt: updated.cameraLastQrExpiresAt,
        cameraLastQrExpiresInHours: updated.cameraLastQrExpiresInHours,
        cameraLastQrGeneratedAt: updated.cameraLastQrGeneratedAt,
        weddingDate: updated.weddingDate,
        weddingTime: updated.weddingTime,
        showCountdown: updated.showCountdown,
        countdownDays: calculateCountdownDays(updated.weddingDate),
      },
    });
  } catch (error) {
    console.error("Admin camera settings PATCH error:", error);
    const details =
      error instanceof Error
        ? error.message
        : "Unknown admin camera settings PATCH error.";
    return NextResponse.json(
      {
        error: "Unable to save camera settings.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
