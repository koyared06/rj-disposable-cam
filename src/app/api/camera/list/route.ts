import { NextRequest, NextResponse } from "next/server";
import { readCameraPhotos } from "@/lib/camera-photos";
import { isPhotoVisibleNow } from "@/lib/camera-visibility";
import { buildCameraUploaderCode, verifyCameraQrToken } from "@/lib/camera-qr";
import { findGuestByInviteCredentials } from "@/lib/guest-access";
import { validateAdmin } from "@/lib/admin-auth";
import { readWeddingSettings } from "@/lib/wedding-settings";

export const dynamic = "force-dynamic";

function toTimeValue(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readWeddingSettings();
    const isAdmin = validateAdmin(request);

    if (!settings.cameraEnabled && !isAdmin) {
      return NextResponse.json(
        { error: "Guest camera is currently disabled." },
        { status: 403 },
      );
    }

    const inviteCode = (request.nextUrl.searchParams.get("invite") ?? "").trim();
    const inviteToken = (request.nextUrl.searchParams.get("token") ?? "").trim();
    const eventId = (request.nextUrl.searchParams.get("e") ?? "").trim();
    const cameraToken = (request.nextUrl.searchParams.get("t") ?? "").trim();
    const deviceId = (request.nextUrl.searchParams.get("device") ?? "").trim();

    const guest = isAdmin
      ? null
      : await findGuestByInviteCredentials(inviteCode, inviteToken);
    const verifiedQr = isAdmin ? null : verifyCameraQrToken(cameraToken, eventId);
    const ownCodeFromQr =
      verifiedQr && deviceId ? buildCameraUploaderCode(verifiedQr, deviceId) : "";
    const ownCode = guest?.inviteCode ?? ownCodeFromQr;

    if (!isAdmin && !ownCode) {
      return NextResponse.json(
        { error: "Invalid camera access details for gallery." },
        { status: 401 },
      );
    }

    const now = new Date();
    const photos = await readCameraPhotos();
    const normalizedOwnCode = ownCode.trim().toLowerCase();
    const shotsUsed = ownCode
      ? photos.filter(
          (photo) => photo.inviteCode.trim().toLowerCase() === normalizedOwnCode,
        ).length
      : null;
    const resolvedShotsUsed = typeof shotsUsed === "number" ? shotsUsed : 0;
    const shotsLimit = settings.cameraShotLimitPerInvite;
    const sorted = photos.sort(
      (a, b) => toTimeValue(b.createdAt) - toTimeValue(a.createdAt),
    );

    const items = sorted
      .filter((photo) => {
        if (isAdmin) return true;

        const isOwnPhoto =
          photo.inviteCode.trim().toLowerCase() === normalizedOwnCode;

        if (isOwnPhoto) {
          return photo.status !== "rejected" && photo.status !== "hidden";
        }

        return isPhotoVisibleNow(photo, now);
      })
      .map((photo) => {
        const isOwnPhoto =
          !isAdmin &&
          photo.inviteCode.trim().toLowerCase() === normalizedOwnCode;

        const urlParams = new URLSearchParams({ id: photo.id });
        if (isAdmin) {
          const adminToken = request.headers.get("x-admin-token");
          if (adminToken) {
            urlParams.set("token", adminToken);
          }
        } else {
          if (guest) {
            urlParams.set("invite", inviteCode);
            urlParams.set("token", inviteToken);
          } else {
            urlParams.set("e", eventId);
            urlParams.set("t", cameraToken);
            urlParams.set("device", deviceId);
          }
        }

        return {
          id: photo.id,
          createdAt: photo.createdAt,
          inviteCode: photo.inviteCode,
          uploaderName: photo.uploaderName,
          status: photo.status,
          isOwnPhoto,
          visibilityAt: photo.visibilityAt,
          imageUrl: `/api/camera/file?${urlParams.toString()}`,
        };
      });

    return NextResponse.json({
      items,
      settings: {
        cameraMaxUploadMb: settings.cameraMaxUploadMb,
        cameraShotLimitPerInvite: shotsLimit,
        cameraRequireApproval: settings.cameraRequireApproval,
        cameraGalleryUnlockDate: settings.cameraGalleryUnlockDate,
        cameraGalleryUnlockTime: settings.cameraGalleryUnlockTime,
      },
      usage: guest
        ? {
            shotsUsed: resolvedShotsUsed,
            shotsLimit,
            shotsLeft:
              shotsLimit > 0 ? Math.max(0, shotsLimit - resolvedShotsUsed) : null,
          }
        : ownCode
        ? {
            shotsUsed: resolvedShotsUsed,
            shotsLimit,
            shotsLeft:
              shotsLimit > 0 ? Math.max(0, shotsLimit - resolvedShotsUsed) : null,
          }
        : null,
    });
  } catch (error) {
    console.error("Camera list error:", error);
    const details = error instanceof Error ? error.message : "Unknown camera list error.";
    return NextResponse.json(
      {
        error: "Unable to load camera gallery right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
