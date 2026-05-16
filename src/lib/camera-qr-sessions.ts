import { randomUUID } from "crypto";
import { getCameraQrSessionsSheetName } from "@/lib/env";
import {
  cameraQrSessionToArray,
  toCameraQrSessionRow,
  type CameraQrSessionRow,
} from "@/lib/sheet-models";
import {
  appendRow,
  deleteRow,
  ensureSheetWithHeaders,
  readRows,
  updateRow,
} from "@/lib/sheets";

const CAMERA_QR_SESSIONS_HEADERS = [
  "id",
  "createdAt",
  "eventId",
  "tableCode",
  "expiresAt",
  "url",
  "token",
  "revokedAt",
];
const REVOKED_TOKEN_CACHE_MS = 15_000;

let ensureSheetPromise: Promise<void> | null = null;
let revokedTokenCache:
  | {
      expiresAtMs: number;
      tokens: Set<string>;
    }
  | null = null;

function normalizeToken(token: string) {
  return (token ?? "").trim();
}

export async function ensureCameraQrSessionsSheet() {
  if (!ensureSheetPromise) {
    ensureSheetPromise = ensureSheetWithHeaders(
      getCameraQrSessionsSheetName(),
      CAMERA_QR_SESSIONS_HEADERS,
    ).catch((error) => {
      ensureSheetPromise = null;
      throw error;
    });
  }
  await ensureSheetPromise;
}

export async function readCameraQrSessions(): Promise<CameraQrSessionRow[]> {
  await ensureCameraQrSessionsSheet();
  const rows = await readRows(`${getCameraQrSessionsSheetName()}!A2:H`);
  return rows
    .filter((row) => (row[0] ?? "").trim())
    .map((row, index) => toCameraQrSessionRow(row, index + 2));
}

export async function appendCameraQrSession(
  session: Omit<CameraQrSessionRow, "rowNumber" | "id" | "createdAt"> &
    Partial<Pick<CameraQrSessionRow, "id" | "createdAt">>,
) {
  await ensureCameraQrSessionsSheet();

  const normalized: Omit<CameraQrSessionRow, "rowNumber"> = {
    id: (session.id ?? "").trim() || randomUUID().replace(/-/g, ""),
    createdAt: session.createdAt?.trim() || new Date().toISOString(),
    eventId: session.eventId.trim(),
    tableCode: session.tableCode.trim(),
    expiresAt: session.expiresAt.trim(),
    url: session.url.trim(),
    token: session.token.trim(),
    revokedAt: session.revokedAt.trim(),
  };

  await appendRow(
    `${getCameraQrSessionsSheetName()}!A2:H`,
    cameraQrSessionToArray(normalized),
  );
  revokedTokenCache = null;

  return normalized;
}

export async function findCameraQrSessionById(id: string) {
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedId) return null;

  const sessions = await readCameraQrSessions();
  return sessions.find((session) => session.id.trim().toLowerCase() === normalizedId) ?? null;
}

export async function setCameraQrSessionRevokedState(id: string, revoked: boolean) {
  const session = await findCameraQrSessionById(id);
  if (!session) return null;

  const updated: Omit<CameraQrSessionRow, "rowNumber"> = {
    id: session.id,
    createdAt: session.createdAt,
    eventId: session.eventId,
    tableCode: session.tableCode,
    expiresAt: session.expiresAt,
    url: session.url,
    token: session.token,
    revokedAt: revoked ? new Date().toISOString() : "",
  };

  await updateRow(
    getCameraQrSessionsSheetName(),
    session.rowNumber,
    cameraQrSessionToArray(updated),
  );
  revokedTokenCache = null;

  return {
    ...updated,
    rowNumber: session.rowNumber,
  } satisfies CameraQrSessionRow;
}

export async function deleteCameraQrSessionById(id: string) {
  const session = await findCameraQrSessionById(id);
  if (!session) return false;

  await deleteRow(getCameraQrSessionsSheetName(), session.rowNumber);
  revokedTokenCache = null;
  return true;
}

async function loadRevokedTokenSet() {
  const now = Date.now();
  if (revokedTokenCache && revokedTokenCache.expiresAtMs > now) {
    return revokedTokenCache.tokens;
  }

  const sessions = await readCameraQrSessions();
  const tokens = new Set<string>();
  for (const session of sessions) {
    const token = normalizeToken(session.token);
    if (!token || !session.revokedAt.trim()) continue;
    tokens.add(token);
  }

  revokedTokenCache = {
    expiresAtMs: now + REVOKED_TOKEN_CACHE_MS,
    tokens,
  };
  return tokens;
}

export async function isCameraQrTokenRevoked(token: string) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;

  const tokens = await loadRevokedTokenSet();
  return tokens.has(normalized);
}
