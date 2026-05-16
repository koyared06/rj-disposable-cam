import { NextRequest, NextResponse } from "next/server";
import { findCameraPhotoById } from "@/lib/camera-photos";
import { isPhotoVisibleNow } from "@/lib/camera-visibility";
import { isCameraQrTokenRevoked } from "@/lib/camera-qr-sessions";
import { buildCameraUploaderCode, verifyCameraQrToken } from "@/lib/camera-qr";
import { downloadDriveFile } from "@/lib/drive-camera";
import { findGuestByInviteCredentials } from "@/lib/guest-access";
import { validateAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDriveFileId(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return "";

  if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const idFromQuery = parsed.searchParams.get("id")?.trim();
    if (idFromQuery && /^[a-zA-Z0-9_-]{10,}$/.test(idFromQuery)) {
      return idFromQuery;
    }

    const pathMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
  } catch {
    // Ignore parse errors and fallback to empty.
  }

  return "";
}

function buildDriveFileCandidates(previewDriveFileId: string, driveFileId: string) {
  const candidates: string[] = [];
  const pushUnique = (value: string) => {
    if (!value) return;
    if (candidates.includes(value)) return;
    candidates.push(value);
  };

  pushUnique(normalizeDriveFileId(previewDriveFileId));
  pushUnique(normalizeDriveFileId(driveFileId));
  return candidates;
}

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
      if (verifiedQr && (await isCameraQrTokenRevoked(cameraToken))) {
        return NextResponse.json({ error: "This camera QR has been revoked." }, { status: 401 });
      }
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

    const fileIdCandidates = buildDriveFileCandidates(
      photo.previewDriveFileId,
      photo.driveFileId,
    );
    if (fileIdCandidates.length < 1) {
      return NextResponse.json({ error: "Photo file reference is missing." }, { status: 404 });
    }

    let bytes: Buffer | null = null;
    let lastError: unknown = null;
    for (const driveFileId of fileIdCandidates) {
      try {
        bytes = await downloadDriveFile(driveFileId);
        break;
      } catch (candidateError) {
        lastError = candidateError;
      }
    }

    if (!bytes) {
      console.warn("Camera file download failed for all candidates.", {
        photoId: photo.id,
        fileIdCandidates,
      });
      if (lastError instanceof Error && /404/.test(lastError.message)) {
        return NextResponse.json({ error: "Photo file no longer exists." }, { status: 404 });
      }
      throw lastError ?? new Error("Unable to download any camera file candidate.");
    }

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
