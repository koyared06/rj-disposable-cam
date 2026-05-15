import { createHmac, timingSafeEqual } from "crypto";

function getCoverSigningSecret() {
  const fromCameraSecret = (process.env.CAMERA_QR_SIGNING_SECRET ?? "").trim();
  if (fromCameraSecret) return fromCameraSecret;

  const fromAdminToken = (process.env.ADMIN_TOKEN ?? "").trim();
  if (fromAdminToken) return fromAdminToken;

  throw new Error(
    "Missing signing secret. Set CAMERA_QR_SIGNING_SECRET (or fallback ADMIN_TOKEN).",
  );
}

function signFileId(fileId: string) {
  return createHmac("sha256", getCoverSigningSecret())
    .update(`camera-cover:${fileId}`)
    .digest("base64url");
}

export function buildCameraCoverUrl(origin: string, fileId: string) {
  const cleanId = fileId.trim();
  if (!cleanId) return "";
  const sig = signFileId(cleanId);
  const params = new URLSearchParams({ id: cleanId, sig });
  return `${origin}/api/camera/cover?${params.toString()}`;
}

export function verifyCameraCoverSignature(fileId: string, signature: string) {
  const cleanId = (fileId ?? "").trim();
  const cleanSig = (signature ?? "").trim();
  if (!cleanId || !cleanSig) return false;

  const expected = signFileId(cleanId);
  const providedBuffer = Buffer.from(cleanSig, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function extractGoogleDriveFileId(input: string) {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const idFromQuery = (parsed.searchParams.get("id") ?? "").trim();
    if (idFromQuery) return idFromQuery;

    const path = parsed.pathname;
    const match = path.match(/\/file\/d\/([^/]+)/i);
    if (match?.[1]) return match[1].trim();
  } catch {
    return "";
  }

  return "";
}

export function normalizeCameraCoverUrl(input: string, origin: string) {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith("/api/camera/cover?")) {
    return `${origin}${raw}`;
  }

  const driveFileId = extractGoogleDriveFileId(raw);
  if (driveFileId) {
    return buildCameraCoverUrl(origin, driveFileId);
  }

  return raw;
}

