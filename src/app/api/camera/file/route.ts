import { NextRequest, NextResponse } from "next/server";
import { findCameraPhotoById } from "@/lib/camera-photos";
import { isPhotoVisibleNow } from "@/lib/camera-visibility";
import { buildCameraUploaderCode, verifyCameraQrToken } from "@/lib/camera-qr";
import { downloadDriveFile } from "@/lib/drive-camera";
import { findGuestByInviteCredentials } from "@/lib/guest-access";
import { validateAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const photoId = (request.nextUrl.searchParams.get("id") ?? "").trim();
    if (!photoId) {
      return NextResponse.json({ error: "Missing photo ID." }, { status: 400 });
    }

    const photo = await findCameraPhotoById(photoId);
    if (!photo) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    const isAdmin = validateAdmin(request);
    if (!isAdmin) {
      const inviteCode = (request.nextUrl.searchParams.get("invite") ?? "").trim();
      const inviteToken = (request.nextUrl.searchParams.get("token") ?? "").trim();
      const guest = await findGuestByInviteCredentials(inviteCode, inviteToken);
      const eventId = (request.nextUrl.searchParams.get("e") ?? "").trim();
      const cameraToken = (request.nextUrl.searchParams.get("t") ?? "").trim();
      const deviceId = (request.nextUrl.searchParams.get("device") ?? "").trim();
      const verifiedQr = verifyCameraQrToken(cameraToken, eventId);
      const ownCodeFromQr =
        verifiedQr && deviceId ? buildCameraUploaderCode(verifiedQr, deviceId) : "";
      const ownCode = guest?.inviteCode ?? ownCodeFromQr;

      if (!ownCode) {
        return NextResponse.json(
          { error: "Invalid camera access details for image access." },
          { status: 401 },
        );
      }

      const isOwnPhoto =
        photo.inviteCode.trim().toLowerCase() === ownCode.trim().toLowerCase();

      if (isOwnPhoto) {
        if (photo.status === "hidden" || photo.status === "rejected") {
          return NextResponse.json({ error: "Photo is not available." }, { status: 404 });
        }
      } else if (!isPhotoVisibleNow(photo, new Date())) {
        return NextResponse.json({ error: "Photo is not visible yet." }, { status: 403 });
      }
    }

    const driveFileId = photo.previewDriveFileId || photo.driveFileId;
    const bytes = await downloadDriveFile(driveFileId);
    const body = new Uint8Array(bytes);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": photo.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("Camera file error:", error);
    const details = error instanceof Error ? error.message : "Unknown camera file error.";
    return NextResponse.json(
      {
        error: "Unable to load photo right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
