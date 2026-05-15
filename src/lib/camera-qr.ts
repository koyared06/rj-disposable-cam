import { createHmac, timingSafeEqual } from "crypto";

type CameraQrPayload = {
  v: 1;
  eventId: string;
  tableCode: string;
  exp: number;
};
const DEFAULT_CAMERA_QR_CODE = "GENERAL";

export type VerifiedCameraQr = {
  eventId: string;
  tableCode: string;
  exp: number;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getCameraQrSigningSecret() {
  const fromCameraSecret = (process.env.CAMERA_QR_SIGNING_SECRET ?? "").trim();
  if (fromCameraSecret) return fromCameraSecret;

  const fromAdminToken = (process.env.ADMIN_TOKEN ?? "").trim();
  if (fromAdminToken) return fromAdminToken;

  throw new Error(
    "Missing signing secret. Set CAMERA_QR_SIGNING_SECRET (or fallback ADMIN_TOKEN).",
  );
}

function signSegment(segment: string) {
  return createHmac("sha256", getCameraQrSigningSecret())
    .update(segment)
    .digest("base64url");
}

export function createCameraQrToken(params: {
  eventId: string;
  tableCode?: string;
  expiresAt: Date;
}) {
  const payload: CameraQrPayload = {
    v: 1,
    eventId: params.eventId.trim().slice(0, 60) || "event",
    tableCode: params.tableCode?.trim().slice(0, 60) || DEFAULT_CAMERA_QR_CODE,
    exp: Math.floor(params.expiresAt.getTime() / 1000),
  };
  const segment = encodeBase64Url(JSON.stringify(payload));
  const signature = signSegment(segment);
  return `${segment}.${signature}`;
}

export function verifyCameraQrToken(token: string, expectedEventId?: string) {
  const normalized = (token ?? "").trim();
  if (!normalized) return null;

  const [segment, signature] = normalized.split(".");
  if (!segment || !signature) return null;

  const expectedSignature = signSegment(segment);
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: CameraQrPayload;
  try {
    payload = JSON.parse(decodeBase64Url(segment)) as CameraQrPayload;
  } catch {
    return null;
  }

  if (payload.v !== 1) return null;
  if (!payload.eventId || !payload.tableCode || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (expectedEventId && payload.eventId.trim() !== expectedEventId.trim()) return null;

  return {
    eventId: payload.eventId.trim(),
    tableCode: payload.tableCode.trim(),
    exp: payload.exp,
  } satisfies VerifiedCameraQr;
}

export function buildCameraUploaderCode(verified: VerifiedCameraQr, deviceId: string) {
  const safeDevice = deviceId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  const safeEvent = verified.eventId.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  const safeTable = verified.tableCode.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  return `cam-${safeEvent}-${safeTable}-${safeDevice || "device"}`;
}
