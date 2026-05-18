import { NextRequest, NextResponse } from "next/server";
import { verifyCameraQrToken } from "@/lib/camera-qr";
import { isCameraQrTokenRevoked } from "@/lib/camera-qr-sessions";
import { normalizeCameraCoverUrl } from "@/lib/camera-cover";
import { readWeddingSettings } from "@/lib/wedding-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const eventId = (request.nextUrl.searchParams.get("e") ?? "").trim();
    const token = (request.nextUrl.searchParams.get("t") ?? "").trim();

    if (!eventId || !token) {
      return NextResponse.json(
        { error: "Missing camera session parameters." },
        { status: 400 },
      );
    }

    const verified = verifyCameraQrToken(token, eventId);
    if (!verified) {
      return NextResponse.json({ error: "Invalid or expired camera QR." }, { status: 401 });
    }

    if (await isCameraQrTokenRevoked(token)) {
      return NextResponse.json({ error: "This camera QR has been revoked." }, { status: 401 });
    }

    const settings = await readWeddingSettings();
    const normalizedCoverUrl = normalizeCameraCoverUrl(
      settings.cameraCoverImageUrl,
      request.nextUrl.origin,
    );
    if (!settings.cameraEnabled) {
      return NextResponse.json(
        { error: "Guest camera is currently disabled." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
      access: {
        eventId: verified.eventId,
        tableCode: verified.tableCode,
        expiresAt: new Date(verified.exp * 1000).toISOString(),
      },
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
        weddingDate: settings.weddingDate,
        weddingTime: settings.weddingTime,
      },
    });
  } catch (error) {
    console.error("Camera session error:", error);
    const details = error instanceof Error ? error.message : "Unknown camera session error.";
    return NextResponse.json(
      {
        error: "Unable to start camera session right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
