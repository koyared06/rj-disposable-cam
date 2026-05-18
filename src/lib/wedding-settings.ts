import { getSettingsSheetName } from "@/lib/env";
import {
  ensureSheetWithHeaders,
  readRows,
  writeRows,
} from "@/lib/sheets";

const SETTINGS_HEADERS = ["key", "value"];
const WEDDING_DATE_KEY = "weddingDate";
const WEDDING_TIME_KEY = "weddingTime";
const SHOW_COUNTDOWN_KEY = "showCountdown";
const CAMERA_ENABLED_KEY = "cameraEnabled";
const CAMERA_REQUIRE_APPROVAL_KEY = "cameraRequireApproval";
const CAMERA_GALLERY_UNLOCK_DATE_KEY = "cameraGalleryUnlockDate";
const CAMERA_GALLERY_UNLOCK_TIME_KEY = "cameraGalleryUnlockTime";
const CAMERA_MAX_UPLOAD_MB_KEY = "cameraMaxUploadMb";
const CAMERA_SHOT_LIMIT_PER_INVITE_KEY = "cameraShotLimitPerInvite";
const CAMERA_LANDING_ENABLED_KEY = "cameraLandingEnabled";
const CAMERA_EVENT_TITLE_KEY = "cameraEventTitle";
const CAMERA_EVENT_SUBTITLE_KEY = "cameraEventSubtitle";
const CAMERA_EVENT_DISPLAY_TITLE_KEY = "cameraEventDisplayTitle";
const CAMERA_EVENT_HASHTAG_KEY = "cameraEventHashtag";
const CAMERA_EVENT_TAGLINE_KEY = "cameraEventTagline";
const CAMERA_COVER_IMAGE_URL_KEY = "cameraCoverImageUrl";
const CAMERA_START_BUTTON_LABEL_KEY = "cameraStartButtonLabel";
const CAMERA_LAST_QR_EVENT_ID_KEY = "cameraLastQrEventId";
const CAMERA_LAST_QR_TABLE_CODE_KEY = "cameraLastQrTableCode";
const CAMERA_LAST_QR_URL_KEY = "cameraLastQrUrl";
const CAMERA_LAST_QR_EXPIRES_AT_KEY = "cameraLastQrExpiresAt";
const CAMERA_LAST_QR_EXPIRES_IN_HOURS_KEY = "cameraLastQrExpiresInHours";
const CAMERA_LAST_QR_GENERATED_AT_KEY = "cameraLastQrGeneratedAt";
const DEFAULT_WEDDING_TIME = "16:00";
const DEFAULT_CAMERA_MAX_UPLOAD_MB = 3;
const DEFAULT_CAMERA_SHOT_LIMIT = 27;
const DEFAULT_CAMERA_EVENT_TITLE = "Guest Camera";
const DEFAULT_CAMERA_EVENT_SUBTITLE = "Capture moments from our celebration.";
const DEFAULT_CAMERA_EVENT_DISPLAY_TITLE = "Red & Jess";
const DEFAULT_CAMERA_EVENT_HASHTAG = "#soaferRED-ynasiJESS";
const DEFAULT_CAMERA_EVENT_TAGLINE = "Welcome to our Forever!";
const DEFAULT_CAMERA_START_BUTTON_LABEL = "Start Camera";
const DEFAULT_CAMERA_QR_EXPIRY_HOURS = 48;

export type WeddingSettings = {
  weddingDate: string;
  weddingTime: string;
  showCountdown: boolean;
  cameraEnabled: boolean;
  cameraRequireApproval: boolean;
  cameraGalleryUnlockDate: string;
  cameraGalleryUnlockTime: string;
  cameraMaxUploadMb: number;
  cameraShotLimitPerInvite: number;
  cameraLandingEnabled: boolean;
  cameraEventTitle: string;
  cameraEventSubtitle: string;
  cameraEventDisplayTitle: string;
  cameraEventHashtag: string;
  cameraEventTagline: string;
  cameraCoverImageUrl: string;
  cameraStartButtonLabel: string;
  cameraLastQrEventId: string;
  cameraLastQrTableCode: string;
  cameraLastQrUrl: string;
  cameraLastQrExpiresAt: string;
  cameraLastQrExpiresInHours: number;
  cameraLastQrGeneratedAt: string;
};

function isMissingSheetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unable to parse range") ||
    normalized.includes("requested entity was not found") ||
    normalized.includes("sheet") && normalized.includes("not found")
  );
}

export async function readWeddingSettings(): Promise<WeddingSettings> {
  try {
    const rows = await readRows(`${getSettingsSheetName()}!A2:B`);
    const normalized = new Map(
      rows
        .filter((row) => (row[0] ?? "").trim())
        .map((row) => [(row[0] ?? "").trim(), (row[1] ?? "").trim()]),
    );

    const cameraLastQrEventId = parseCameraSessionText(
      normalized.get(CAMERA_LAST_QR_EVENT_ID_KEY) ?? "",
      60,
    );
    const cameraLastQrTableCode = parseCameraSessionText(
      normalized.get(CAMERA_LAST_QR_TABLE_CODE_KEY) ?? "",
      60,
    );
    const cameraLastQrUrl = parseCameraUrl(normalized.get(CAMERA_LAST_QR_URL_KEY) ?? "");
    const cameraLastQrExpiresAt = normalizeIsoDateTime(
      normalized.get(CAMERA_LAST_QR_EXPIRES_AT_KEY) ?? "",
    );
    const cameraLastQrGeneratedAt = normalizeIsoDateTime(
      normalized.get(CAMERA_LAST_QR_GENERATED_AT_KEY) ?? "",
    );
    const cameraLastQrExpiresInHours = parseCameraQrExpiryHours(
      normalized.get(CAMERA_LAST_QR_EXPIRES_IN_HOURS_KEY) ?? "",
    );
    const isQrExpired =
      cameraLastQrExpiresAt && Date.parse(cameraLastQrExpiresAt) <= Date.now();

    return {
      weddingDate: normalized.get(WEDDING_DATE_KEY) ?? "",
      weddingTime: normalizeWeddingTime(normalized.get(WEDDING_TIME_KEY) ?? ""),
      showCountdown: parseBooleanSetting(normalized.get(SHOW_COUNTDOWN_KEY) ?? "", true),
      cameraEnabled: parseBooleanSetting(normalized.get(CAMERA_ENABLED_KEY) ?? "", false),
      cameraRequireApproval: parseBooleanSetting(
        normalized.get(CAMERA_REQUIRE_APPROVAL_KEY) ?? "",
        false,
      ),
      cameraGalleryUnlockDate: normalizeUnlockDate(
        normalized.get(CAMERA_GALLERY_UNLOCK_DATE_KEY) ?? "",
      ),
      cameraGalleryUnlockTime: normalizeUnlockTime(
        normalized.get(CAMERA_GALLERY_UNLOCK_TIME_KEY) ?? "",
      ),
      cameraMaxUploadMb: parseCameraMaxUploadMb(
        normalized.get(CAMERA_MAX_UPLOAD_MB_KEY) ?? "",
      ),
      cameraShotLimitPerInvite: parseCameraShotLimitPerInvite(
        normalized.get(CAMERA_SHOT_LIMIT_PER_INVITE_KEY) ?? "",
      ),
      cameraLandingEnabled: parseBooleanSetting(
        normalized.get(CAMERA_LANDING_ENABLED_KEY) ?? "",
        true,
      ),
      cameraEventTitle: parseCameraDisplayText(
        normalized.get(CAMERA_EVENT_TITLE_KEY) ?? "",
        DEFAULT_CAMERA_EVENT_TITLE,
        120,
      ),
      cameraEventSubtitle: parseCameraDisplayText(
        normalized.get(CAMERA_EVENT_SUBTITLE_KEY) ?? "",
        DEFAULT_CAMERA_EVENT_SUBTITLE,
        240,
      ),
      cameraEventDisplayTitle: parseCameraDisplayText(
        normalized.get(CAMERA_EVENT_DISPLAY_TITLE_KEY) ?? "",
        DEFAULT_CAMERA_EVENT_DISPLAY_TITLE,
        80,
      ),
      cameraEventHashtag: parseCameraHashtag(
        normalized.get(CAMERA_EVENT_HASHTAG_KEY) ?? "",
        DEFAULT_CAMERA_EVENT_HASHTAG,
        80,
      ),
      cameraEventTagline: parseCameraDisplayText(
        normalized.get(CAMERA_EVENT_TAGLINE_KEY) ?? "",
        DEFAULT_CAMERA_EVENT_TAGLINE,
        120,
      ),
      cameraCoverImageUrl: parseCameraUrl(normalized.get(CAMERA_COVER_IMAGE_URL_KEY) ?? ""),
      cameraStartButtonLabel: parseCameraDisplayText(
        normalized.get(CAMERA_START_BUTTON_LABEL_KEY) ?? "",
        DEFAULT_CAMERA_START_BUTTON_LABEL,
        40,
      ),
      cameraLastQrEventId: isQrExpired ? "" : cameraLastQrEventId,
      cameraLastQrTableCode: isQrExpired ? "" : cameraLastQrTableCode,
      cameraLastQrUrl: isQrExpired ? "" : cameraLastQrUrl,
      cameraLastQrExpiresAt: isQrExpired ? "" : cameraLastQrExpiresAt,
      cameraLastQrExpiresInHours: isQrExpired
        ? DEFAULT_CAMERA_QR_EXPIRY_HOURS
        : cameraLastQrExpiresInHours,
      cameraLastQrGeneratedAt: isQrExpired ? "" : cameraLastQrGeneratedAt,
    };
  } catch (error) {
    if (isMissingSheetError(error)) {
      return {
        weddingDate: "",
        weddingTime: DEFAULT_WEDDING_TIME,
        showCountdown: true,
        cameraEnabled: false,
        cameraRequireApproval: false,
        cameraGalleryUnlockDate: "",
        cameraGalleryUnlockTime: "",
        cameraMaxUploadMb: DEFAULT_CAMERA_MAX_UPLOAD_MB,
        cameraShotLimitPerInvite: DEFAULT_CAMERA_SHOT_LIMIT,
        cameraLandingEnabled: true,
        cameraEventTitle: DEFAULT_CAMERA_EVENT_TITLE,
        cameraEventSubtitle: DEFAULT_CAMERA_EVENT_SUBTITLE,
        cameraEventDisplayTitle: DEFAULT_CAMERA_EVENT_DISPLAY_TITLE,
        cameraEventHashtag: DEFAULT_CAMERA_EVENT_HASHTAG,
        cameraEventTagline: DEFAULT_CAMERA_EVENT_TAGLINE,
        cameraCoverImageUrl: "",
        cameraStartButtonLabel: DEFAULT_CAMERA_START_BUTTON_LABEL,
        cameraLastQrEventId: "",
        cameraLastQrTableCode: "",
        cameraLastQrUrl: "",
        cameraLastQrExpiresAt: "",
        cameraLastQrExpiresInHours: DEFAULT_CAMERA_QR_EXPIRY_HOURS,
        cameraLastQrGeneratedAt: "",
      };
    }
    throw error;
  }
}

export async function saveWeddingSettings(settings: WeddingSettings) {
  const sheetName = getSettingsSheetName();
  await ensureSheetWithHeaders(sheetName, SETTINGS_HEADERS);

  const entries: Array<[string, string]> = [
    [WEDDING_DATE_KEY, settings.weddingDate],
    [WEDDING_TIME_KEY, normalizeWeddingTime(settings.weddingTime)],
    [SHOW_COUNTDOWN_KEY, settings.showCountdown ? "true" : "false"],
    [CAMERA_ENABLED_KEY, settings.cameraEnabled ? "true" : "false"],
    [
      CAMERA_REQUIRE_APPROVAL_KEY,
      settings.cameraRequireApproval ? "true" : "false",
    ],
    [
      CAMERA_GALLERY_UNLOCK_DATE_KEY,
      normalizeUnlockDate(settings.cameraGalleryUnlockDate),
    ],
    [
      CAMERA_GALLERY_UNLOCK_TIME_KEY,
      normalizeUnlockTime(settings.cameraGalleryUnlockTime),
    ],
    [
      CAMERA_MAX_UPLOAD_MB_KEY,
      String(parseCameraMaxUploadMb(String(settings.cameraMaxUploadMb))),
    ],
    [
      CAMERA_SHOT_LIMIT_PER_INVITE_KEY,
      String(parseCameraShotLimitPerInvite(String(settings.cameraShotLimitPerInvite))),
    ],
    [CAMERA_LANDING_ENABLED_KEY, settings.cameraLandingEnabled ? "true" : "false"],
    [
      CAMERA_EVENT_TITLE_KEY,
      parseCameraDisplayText(
        settings.cameraEventTitle,
        DEFAULT_CAMERA_EVENT_TITLE,
        120,
      ),
    ],
    [
      CAMERA_EVENT_SUBTITLE_KEY,
      parseCameraDisplayText(
        settings.cameraEventSubtitle,
        DEFAULT_CAMERA_EVENT_SUBTITLE,
        240,
      ),
    ],
    [
      CAMERA_EVENT_DISPLAY_TITLE_KEY,
      parseCameraDisplayText(
        settings.cameraEventDisplayTitle,
        DEFAULT_CAMERA_EVENT_DISPLAY_TITLE,
        80,
      ),
    ],
    [
      CAMERA_EVENT_HASHTAG_KEY,
      parseCameraHashtag(
        settings.cameraEventHashtag,
        DEFAULT_CAMERA_EVENT_HASHTAG,
        80,
      ),
    ],
    [
      CAMERA_EVENT_TAGLINE_KEY,
      parseCameraDisplayText(
        settings.cameraEventTagline,
        DEFAULT_CAMERA_EVENT_TAGLINE,
        120,
      ),
    ],
    [CAMERA_COVER_IMAGE_URL_KEY, parseCameraUrl(settings.cameraCoverImageUrl)],
    [
      CAMERA_START_BUTTON_LABEL_KEY,
      parseCameraDisplayText(
        settings.cameraStartButtonLabel,
        DEFAULT_CAMERA_START_BUTTON_LABEL,
        40,
      ),
    ],
    [
      CAMERA_LAST_QR_EVENT_ID_KEY,
      parseCameraSessionText(settings.cameraLastQrEventId, 60),
    ],
    [
      CAMERA_LAST_QR_TABLE_CODE_KEY,
      parseCameraSessionText(settings.cameraLastQrTableCode, 60),
    ],
    [CAMERA_LAST_QR_URL_KEY, parseCameraUrl(settings.cameraLastQrUrl)],
    [
      CAMERA_LAST_QR_EXPIRES_AT_KEY,
      normalizeIsoDateTime(settings.cameraLastQrExpiresAt),
    ],
    [
      CAMERA_LAST_QR_EXPIRES_IN_HOURS_KEY,
      String(parseCameraQrExpiryHours(String(settings.cameraLastQrExpiresInHours))),
    ],
    [
      CAMERA_LAST_QR_GENERATED_AT_KEY,
      normalizeIsoDateTime(settings.cameraLastQrGeneratedAt),
    ],
  ];
  // Use a single range write to avoid many per-row API calls that can hit quota limits.
  const blankRowsToClearOldValues = 40;
  const rowsToWrite = [
    ...entries.map(([key, value]) => [key, value]),
    ...Array.from({ length: blankRowsToClearOldValues }, () => ["", ""]),
  ];
  const endRow = 1 + rowsToWrite.length;
  await writeRows(`${sheetName}!A2:B${endRow}`, rowsToWrite);
}

function normalizeWeddingTime(value: string): string {
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return value;
  }
  return DEFAULT_WEDDING_TIME;
}

function normalizeUnlockDate(value: string): string {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return parseIsoDate(value) ? value : "";
}

function normalizeUnlockTime(value: string): string {
  if (!value) return "";
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return value;
  }
  return "";
}

function parseBooleanSetting(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

function parseCameraMaxUploadMb(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAMERA_MAX_UPLOAD_MB;
  }
  const normalized = Math.round(parsed);
  return Math.min(100, Math.max(0, normalized));
}

function parseCameraShotLimitPerInvite(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAMERA_SHOT_LIMIT;
  }
  const normalized = Math.round(parsed);
  return Math.min(500, Math.max(0, normalized));
}

function parseCameraDisplayText(
  value: string,
  fallback: string,
  maxLength: number,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function parseCameraHashtag(
  value: string,
  fallback: string,
  maxLength: number,
): string {
  const trimmed = (value ?? "").trim();
  const base = trimmed || fallback;
  if (!base) return "";
  const normalized = base.startsWith("#") ? base : `#${base}`;
  return normalized.slice(0, maxLength);
}

function parseCameraUrl(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
}

function parseCameraSessionText(value: string, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

function parseCameraQrExpiryHours(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAMERA_QR_EXPIRY_HOURS;
  }

  const normalized = Math.round(parsed);
  return Math.min(720, Math.max(1, normalized));
}

function normalizeIsoDateTime(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function parseIsoDate(isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [yearRaw, monthRaw, dayRaw] = isoDate.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === month - 1 &&
    utcDate.getUTCDate() === day;

  return isValid ? utcDate : null;
}

export function calculateCountdownDays(weddingDate: string): number | null {
  const target = parseIsoDate(weddingDate);
  if (!target) return null;

  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const weddingUtc = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );

  return Math.round((weddingUtc - todayUtc) / (1000 * 60 * 60 * 24));
}
