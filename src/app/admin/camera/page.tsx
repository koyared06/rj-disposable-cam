"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ThemeToggle } from "@/components/theme-toggle";

type CameraSettings = {
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
  countdownDays: number | null;
};

type CameraPhotoItem = {
  id: string;
  createdAt: string;
  inviteCode: string;
  uploaderName: string;
  status: "pending" | "approved" | "hidden" | "rejected" | string;
  isOwnPhoto: boolean;
  visibilityAt: string;
  imageUrl: string;
};

type CameraQrHistoryItem = {
  id: string;
  createdAt: string;
  eventId: string;
  tableCode: string;
  expiresAt: string;
  url: string;
  isExpired: boolean;
  isRevoked: boolean;
  isActive: boolean;
};

const ADMIN_SESSION_KEY = "rj_admin_session_v1";
const COVER_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const COVER_UPLOAD_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const COVER_UPLOAD_MAX_DIMENSION = 2048;
const COVER_JPEG_QUALITIES = [0.88, 0.8, 0.72, 0.64] as const;
const QR_PAGE_SIZE = 10;
const PHOTO_PAGE_SIZE = 12;
const A4_QR_COPIES_PER_PAGE = 8;

function readStoredAdminSession(): string | null {
  try {
    return window.sessionStorage.getItem(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStoredAdminSession(token: string) {
  window.sessionStorage.setItem(ADMIN_SESSION_KEY, token);
}

function clearStoredAdminSession() {
  window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function formatTimestamp(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatPhotoRevealTimestamp(dateValue: string, timeValue: string) {
  const safeDate = dateValue.trim();
  const safeTime = timeValue.trim();

  if (safeDate && safeTime) {
    return formatTimestamp(`${safeDate}T${safeTime}`);
  }
  if (safeDate) {
    return formatTimestamp(`${safeDate}T00:00:00`);
  }
  if (safeTime) {
    return safeTime;
  }
  return "Not set";
}

function formatEventHashtag(value: string, fallback = "#soaferRED-ynasiJESS") {
  const trimmed = (value ?? "").trim();
  const resolved = trimmed || fallback;
  if (!resolved) return "";
  return resolved.startsWith("#") ? resolved : `#${resolved}`;
}

function sanitizeFileNameSegment(value: string) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildQrExportFileName(eventId: string, tableCode: string) {
  const eventPart = sanitizeFileNameSegment(eventId) || "event";
  const tablePart = sanitizeFileNameSegment(tableCode || "general") || "general";
  return `camera-qr-${eventPart}-${tablePart}.png`;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

type JsonRecord = Record<string, unknown>;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeErrorText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as JsonRecord;
  const error = typeof record.error === "string" ? record.error : "";
  const details = typeof record.details === "string" ? record.details : "";
  const hint = typeof record.hint === "string" ? record.hint : "";
  return `${error} ${details} ${hint}`.trim().toLowerCase();
}

function isQuotaLimitedResponse(status: number, payload: unknown) {
  const text = normalizeErrorText(payload);
  const quotaLike =
    text.includes("quota exceeded") ||
    text.includes("rate limit") ||
    text.includes("read requests per minute") ||
    text.includes("too many requests") ||
    text.includes("userratelimitexceeded");

  if (status === 429 || status === 503) return true;
  if (status === 403 && quotaLike) return true;
  if (status === 500 && quotaLike) return true;
  return false;
}

async function fetchJsonWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { maxAttempts?: number; baseDelayMs?: number },
) {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(200, options?.baseDelayMs ?? 800);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      const payload = await response.json().catch(() => ({}));

      const shouldRetry =
        attempt < maxAttempts && isQuotaLimitedResponse(response.status, payload);

      if (shouldRetry) {
        await delay(baseDelayMs * attempt);
        continue;
      }

      return { response, payload, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await delay(baseDelayMs * attempt);
    }
  }

  throw lastError ?? new Error("Request failed after retries.");
}

function fileNameWithoutExtension(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) return "landing-cover";
  return trimmed.replace(/\.[^.]+$/, "") || "landing-cover";
}

function blobToFile(blob: Blob, fileName: string, type: string) {
  return new File([blob], fileName, {
    type,
    lastModified: Date.now(),
  });
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read selected image."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function prepareCoverUploadFile(file: File) {
  if (file.size <= COVER_UPLOAD_LIMIT_BYTES) return file;
  if (file.size > COVER_UPLOAD_HARD_LIMIT_BYTES) {
    throw new Error("Selected image is too large. Please choose an image below 16 MB.");
  }

  const image = await loadImageElement(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale =
    longestSide > COVER_UPLOAD_MAX_DIMENSION
      ? COVER_UPLOAD_MAX_DIMENSION / longestSide
      : 1;

  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process selected image.");
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const safeName = fileNameWithoutExtension(file.name);
  let bestBlob: Blob | null = null;

  for (const quality of COVER_JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) continue;
    bestBlob = blob;
    if (blob.size <= COVER_UPLOAD_LIMIT_BYTES) {
      break;
    }
  }

  if (!bestBlob) {
    throw new Error("Unable to process selected image.");
  }

  if (bestBlob.size > COVER_UPLOAD_LIMIT_BYTES) {
    throw new Error(
      "Image is still too large for Vercel upload limit. Choose a smaller image.",
    );
  }

  return blobToFile(bestBlob, `${safeName}.jpg`, "image/jpeg");
}

export default function CameraAdminPage() {
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPreviewObjectUrl, setCoverPreviewObjectUrl] = useState("");
  const [cameraActionLoadingId, setCameraActionLoadingId] = useState("");
  const [qrEventId, setQrEventId] = useState("RJ2026");
  const [qrTableCode, setQrTableCode] = useState("");
  const [qrExpiresHours, setQrExpiresHours] = useState("48");
  const [qrGenerating, setQrGenerating] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [qrImageDataUrl, setQrImageDataUrl] = useState("");
  const [qrSessionCode, setQrSessionCode] = useState("");
  const [qrExpiresAt, setQrExpiresAt] = useState("");
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthReportJson, setHealthReportJson] = useState("");
  const [qrHistory, setQrHistory] = useState<CameraQrHistoryItem[]>([]);
  const [qrHistoryActionLoadingId, setQrHistoryActionLoadingId] = useState("");
  const [qrBulkActionLoading, setQrBulkActionLoading] = useState("");
  const [qrActionsMenu, setQrActionsMenu] = useState<{
    id: string;
    top: number;
    left: number;
  } | null>(null);
  const [qrBulkMenuOpen, setQrBulkMenuOpen] = useState(false);
  const [qrModalItem, setQrModalItem] = useState<CameraQrHistoryItem | null>(null);
  const [qrModalImageDataUrl, setQrModalImageDataUrl] = useState("");
  const [qrModalLoading, setQrModalLoading] = useState(false);
  const [photoPreviewId, setPhotoPreviewId] = useState("");
  const [qrPage, setQrPage] = useState(1);
  const [photoPage, setPhotoPage] = useState(1);
  const [photoUploaderFilter, setPhotoUploaderFilter] = useState("all");
  const [settings, setSettings] = useState<CameraSettings>({
    cameraEnabled: false,
    cameraRequireApproval: false,
    cameraGalleryUnlockDate: "",
    cameraGalleryUnlockTime: "",
    cameraMaxUploadMb: 3,
    cameraShotLimitPerInvite: 27,
    cameraLandingEnabled: true,
    cameraEventTitle: "Guest Camera",
    cameraEventSubtitle: "Capture moments from our celebration.",
    cameraEventDisplayTitle: "Red & Jess",
    cameraEventHashtag: "#soaferRED-ynasiJESS",
    cameraEventTagline: "Welcome to our Forever!",
    cameraCoverImageUrl: "",
    cameraStartButtonLabel: "Start Camera",
    countdownDays: null,
  });
  const [cameraPhotos, setCameraPhotos] = useState<CameraPhotoItem[]>([]);

  const pendingCount = useMemo(
    () => cameraPhotos.filter((photo) => photo.status === "pending").length,
    [cameraPhotos],
  );
  const approvedCount = useMemo(
    () => cameraPhotos.filter((photo) => photo.status === "approved").length,
    [cameraPhotos],
  );
  const hiddenCount = useMemo(
    () => cameraPhotos.filter((photo) => photo.status === "hidden").length,
    [cameraPhotos],
  );
  const rejectedCount = useMemo(
    () => cameraPhotos.filter((photo) => photo.status === "rejected").length,
    [cameraPhotos],
  );
  const landingCoverPreviewSrc = coverPreviewObjectUrl || settings.cameraCoverImageUrl;
  const qrExpiresAtLabel = useMemo(
    () => (qrExpiresAt ? formatTimestamp(qrExpiresAt) : ""),
    [qrExpiresAt],
  );
  const qrExpiredCount = useMemo(
    () => qrHistory.filter((item) => item.isExpired).length,
    [qrHistory],
  );
  const qrExpiredUnrevokedCount = useMemo(
    () => qrHistory.filter((item) => item.isExpired && !item.isRevoked).length,
    [qrHistory],
  );
  const selectedCameraPhoto = useMemo(
    () => cameraPhotos.find((photo) => photo.id === photoPreviewId) ?? null,
    [cameraPhotos, photoPreviewId],
  );
  const pagedQrHistory = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(qrHistory.length / QR_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, qrPage), totalPages);
    const start = (safePage - 1) * QR_PAGE_SIZE;
    return qrHistory.slice(start, start + QR_PAGE_SIZE);
  }, [qrHistory, qrPage]);
  const qrTotalPages = useMemo(
    () => Math.max(1, Math.ceil(qrHistory.length / QR_PAGE_SIZE)),
    [qrHistory.length],
  );
  const uploaderOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const photo of cameraPhotos) {
      const name = photo.uploaderName.trim();
      if (name) unique.add(name);
    }
    return ["all", ...Array.from(unique)];
  }, [cameraPhotos]);
  const filteredCameraPhotos = useMemo(() => {
    if (photoUploaderFilter === "all") return cameraPhotos;
    return cameraPhotos.filter((photo) => photo.uploaderName === photoUploaderFilter);
  }, [cameraPhotos, photoUploaderFilter]);
  const pagedCameraPhotos = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredCameraPhotos.length / PHOTO_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, photoPage), totalPages);
    const start = (safePage - 1) * PHOTO_PAGE_SIZE;
    return filteredCameraPhotos.slice(start, start + PHOTO_PAGE_SIZE);
  }, [filteredCameraPhotos, photoPage]);
  const photoTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredCameraPhotos.length / PHOTO_PAGE_SIZE)),
    [filteredCameraPhotos.length],
  );
  const activeQrActionsItem = useMemo(
    () => (qrActionsMenu ? qrHistory.find((item) => item.id === qrActionsMenu.id) ?? null : null),
    [qrActionsMenu, qrHistory],
  );
  const qrCenterTitlePreview = useMemo(
    () => (settings.cameraEventDisplayTitle.trim() || "Red & Jess").slice(0, 26),
    [settings.cameraEventDisplayTitle],
  );

  const renderQrDataUrl = useCallback(async (url: string, width: number) => {
    const scriptFontFamilyRaw =
      typeof window !== "undefined"
        ? window.getComputedStyle(document.documentElement).getPropertyValue("--font-script").trim()
        : "";
    const scriptFontFamily = scriptFontFamilyRaw || `"Great Vibes", "Times New Roman", serif`;

    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.ready.catch(() => undefined);
    }

    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, url, {
      width,
      margin: 1,
      errorCorrectionLevel: "H",
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });

    const centerTitle = qrCenterTitlePreview;
    if (!centerTitle) {
      return canvas.toDataURL("image/png");
    }

    const context = canvas.getContext("2d");
    if (!context) return canvas.toDataURL("image/png");

    const baseFontSize = Math.max(14, Math.round(canvas.width * 0.058));
    context.font = `400 ${baseFontSize}px ${scriptFontFamily}`;
    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.load(`400 ${baseFontSize}px ${scriptFontFamily}`).catch(() => undefined);
      context.font = `400 ${baseFontSize}px ${scriptFontFamily}`;
    }
    const textMetrics = context.measureText(centerTitle);
    const badgeHorizontalPadding = Math.round(baseFontSize * 0.9);
    const badgeWidth = Math.min(
      Math.round(canvas.width * 0.62),
      Math.max(Math.round(canvas.width * 0.28), Math.round(textMetrics.width + badgeHorizontalPadding * 2)),
    );
    const badgeHeight = Math.round(baseFontSize * 1.75);
    const badgeX = Math.round((canvas.width - badgeWidth) / 2);
    const badgeY = Math.round((canvas.height - badgeHeight) / 2);

    drawRoundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, Math.round(badgeHeight * 0.35));
    context.fillStyle = "rgba(255,255,255,0.97)";
    context.fill();
    context.lineWidth = Math.max(1, Math.round(canvas.width * 0.004));
    context.strokeStyle = "rgba(84,56,42,0.18)";
    context.stroke();

    context.fillStyle = "#54382a";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `400 ${baseFontSize}px ${scriptFontFamily}`;
    context.fillText(centerTitle, canvas.width / 2, canvas.height / 2 + 1.5);

    return canvas.toDataURL("image/png");
  }, [qrCenterTitlePreview]);

  const clearActiveQrSession = useCallback(
    (options?: { showExpiredToast?: boolean }) => {
      setQrUrl("");
      setQrImageDataUrl("");
      setQrSessionCode("");
      setQrExpiresAt("");
      if (options?.showExpiredToast) {
        toast("QR expired", {
          description: "Generate a new guest QR to continue sharing camera access.",
        });
      }
    },
    [],
  );

  const applyQrToPreview = useCallback(async (item: CameraQrHistoryItem) => {
    if (!item.url.trim()) return;

    try {
      const qrDataUrl = await renderQrDataUrl(item.url, 520);
      setQrUrl(item.url);
      setQrImageDataUrl(qrDataUrl);
      setQrSessionCode(item.tableCode || "GENERAL");
      setQrExpiresAt(item.expiresAt);
      setQrEventId(item.eventId || "RJ2026");
      setQrTableCode(item.tableCode === "GENERAL" ? "" : item.tableCode);
    } catch {
      toast.error("Unable to render QR", {
        description: "Try selecting another QR entry.",
      });
    }
  }, [renderQrDataUrl]);

  const openQrModalFromHistory = useCallback(
    async (item: CameraQrHistoryItem) => {
      if (!item.url.trim()) return;

      setQrModalItem(item);
      setQrModalLoading(true);
      try {
        const qrDataUrl = await renderQrDataUrl(item.url, 900);
        setQrModalImageDataUrl(qrDataUrl);
        await applyQrToPreview(item);
      } catch {
        toast.error("Unable to render QR", {
          description: "Try selecting another QR entry.",
        });
        setQrModalItem(null);
        setQrModalImageDataUrl("");
      } finally {
        setQrModalLoading(false);
      }
    },
    [applyQrToPreview, renderQrDataUrl],
  );

  useEffect(() => {
    return () => {
      if (coverPreviewObjectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(coverPreviewObjectUrl);
      }
    };
  }, [coverPreviewObjectUrl]);

  useEffect(() => {
    const onWindowPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-qr-actions-trigger='true']")) return;
      if (target.closest("[data-qr-actions-menu='true']")) return;
      if (target.closest("[data-qr-bulk-trigger='true']")) return;
      if (target.closest("[data-qr-bulk-menu='true']")) return;
      setQrActionsMenu(null);
      setQrBulkMenuOpen(false);
    };

    const onWindowScroll = () => {
      setQrActionsMenu(null);
    };

    window.addEventListener("mousedown", onWindowPointer);
    window.addEventListener("scroll", onWindowScroll, true);
    window.addEventListener("resize", onWindowScroll);
    return () => {
      window.removeEventListener("mousedown", onWindowPointer);
      window.removeEventListener("scroll", onWindowScroll, true);
      window.removeEventListener("resize", onWindowScroll);
    };
  }, []);

  const loadCameraData = useCallback(
    async (adminToken: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setRefreshing(true);
      }

      try {
        const settingsResult = await fetchJsonWithRetry(
          "/api/admin/camera/settings",
          {
            headers: { "x-admin-token": adminToken },
          },
          { maxAttempts: 3, baseDelayMs: 900 },
        );
        const photosResult = await fetchJsonWithRetry(
          "/api/camera/list",
          {
            headers: { "x-admin-token": adminToken },
          },
          { maxAttempts: 3, baseDelayMs: 900 },
        );
        const qrHistoryResult = await fetchJsonWithRetry(
          "/api/admin/camera/qr?limit=300",
          {
            headers: { "x-admin-token": adminToken },
          },
          { maxAttempts: 3, baseDelayMs: 900 },
        );

        const settingsResponse = settingsResult.response;
        const settingsPayload = settingsResult.payload as JsonRecord;
        const photosResponse = photosResult.response;
        const photosPayload = photosResult.payload as JsonRecord;
        const qrHistoryResponse = qrHistoryResult.response;
        const qrHistoryPayload = qrHistoryResult.payload as JsonRecord;

        if (
          settingsResponse.status === 401 ||
          photosResponse.status === 401 ||
          qrHistoryResponse.status === 401
        ) {
          clearStoredAdminSession();
          setConnected(false);
          setToken("");
          toast.error("Session expired", {
            description: "Please reconnect with your admin token.",
          });
          return;
        }

        if (!settingsResponse.ok) {
          const details =
            typeof settingsPayload.details === "string" ? ` (${settingsPayload.details})` : "";
          const message =
            typeof settingsPayload.error === "string"
              ? settingsPayload.error
              : "Unable to load camera settings.";
          toast.error("Load failed", {
            description: `${message}${details}`,
          });
          return;
        }

        if (!photosResponse.ok) {
          const details =
            typeof photosPayload.details === "string" ? ` (${photosPayload.details})` : "";
          const message =
            typeof photosPayload.error === "string"
              ? photosPayload.error
              : "Unable to load camera uploads.";
          toast.error("Load failed", {
            description: `${message}${details}`,
          });
          return;
        }

        if (!qrHistoryResponse.ok) {
          const details =
            typeof qrHistoryPayload.details === "string" ? ` (${qrHistoryPayload.details})` : "";
          const message =
            typeof qrHistoryPayload.error === "string"
              ? qrHistoryPayload.error
              : "Unable to load QR history.";
          toast.error("Load failed", {
            description: `${message}${details}`,
          });
          return;
        }

        const loadedSettings = (settingsPayload.settings as JsonRecord | undefined) ?? {};

        setSettings({
          cameraEnabled: Boolean(loadedSettings.cameraEnabled),
          cameraRequireApproval: Boolean(
            loadedSettings.cameraRequireApproval,
          ),
          cameraGalleryUnlockDate: (loadedSettings.cameraGalleryUnlockDate as string | undefined) ?? "",
          cameraGalleryUnlockTime: (loadedSettings.cameraGalleryUnlockTime as string | undefined) ?? "",
          cameraMaxUploadMb: Number(loadedSettings.cameraMaxUploadMb ?? 3),
          cameraShotLimitPerInvite: Number(loadedSettings.cameraShotLimitPerInvite ?? 27),
          cameraLandingEnabled:
            typeof loadedSettings.cameraLandingEnabled === "boolean"
              ? Boolean(loadedSettings.cameraLandingEnabled)
              : true,
          cameraEventTitle: (loadedSettings.cameraEventTitle as string | undefined) ?? "Guest Camera",
          cameraEventSubtitle:
            (loadedSettings.cameraEventSubtitle as string | undefined) ??
            "Capture moments from our celebration.",
          cameraEventDisplayTitle:
            (loadedSettings.cameraEventDisplayTitle as string | undefined) ?? "Red & Jess",
          cameraEventHashtag:
            (loadedSettings.cameraEventHashtag as string | undefined) ?? "#soaferRED-ynasiJESS",
          cameraEventTagline:
            (loadedSettings.cameraEventTagline as string | undefined) ?? "Welcome to our Forever!",
          cameraCoverImageUrl: (loadedSettings.cameraCoverImageUrl as string | undefined) ?? "",
          cameraStartButtonLabel: (loadedSettings.cameraStartButtonLabel as string | undefined) ?? "Start Camera",
          countdownDays:
            typeof loadedSettings.countdownDays === "number"
              ? Number(loadedSettings.countdownDays ?? 0)
              : null,
        });

        setCameraPhotos(Array.isArray(photosPayload.items) ? (photosPayload.items as CameraPhotoItem[]) : []);

        const qrItems = Array.isArray(qrHistoryPayload.items)
          ? (qrHistoryPayload.items as CameraQrHistoryItem[])
          : [];
        setQrHistory(qrItems);

        const fallbackActiveQr = qrItems.find((item) => item.isActive);
        if (fallbackActiveQr) {
          await applyQrToPreview(fallbackActiveQr);
          setQrEventId(fallbackActiveQr.eventId || "RJ2026");
          setQrTableCode(fallbackActiveQr.tableCode === "GENERAL" ? "" : fallbackActiveQr.tableCode);
        } else {
          clearActiveQrSession();
        }

        const attemptsUsed = Math.max(
          settingsResult.attempts,
          photosResult.attempts,
          qrHistoryResult.attempts,
        );
        if (!silent && attemptsUsed > 1) {
          toast("Recovered after retry", {
            description: `Google API was busy. Loaded successfully on attempt ${attemptsUsed}.`,
          });
        }
      } catch {
        toast.error("Network error", {
          description: "Unable to load camera studio data right now.",
        });
      } finally {
        if (!silent) {
          setRefreshing(false);
        }
      }
    },
    [applyQrToPreview, clearActiveQrSession],
  );

  async function connectWithToken(adminToken: string) {
    setLoading(true);
    try {
      const { response, payload } = await fetchJsonWithRetry(
        "/api/admin/camera/settings",
        {
          headers: { "x-admin-token": adminToken },
        },
        { maxAttempts: 3, baseDelayMs: 800 },
      );
      const parsed = payload as JsonRecord;

      if (!response.ok) {
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        const message = typeof parsed.error === "string" ? parsed.error : "Unauthorized.";
        toast.error("Connect failed", {
          description: `${message}${details}`,
        });
        return;
      }

      writeStoredAdminSession(adminToken);
      setConnected(true);
      setToken(adminToken);
      toast.success("Connected", { description: "Camera Studio is ready." });
      await loadCameraData(adminToken, { silent: true });
    } catch {
      toast.error("Network error", {
        description: "Unable to connect right now.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function onConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    await connectWithToken(token.trim());
  }

  function disconnect() {
    clearStoredAdminSession();
    setConnected(false);
    setToken("");
    setCameraPhotos([]);
    setQrHistory([]);
    setQrActionsMenu(null);
    setQrBulkMenuOpen(false);
    closeQrModal();
    closePhotoPreviewModal();
    clearActiveQrSession();
    toast("Disconnected", { description: "Camera admin session cleared." });
  }

  async function onSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setSaving(true);
    try {
      const { response, payload, attempts } = await fetchJsonWithRetry(
        "/api/admin/camera/settings",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            cameraEnabled: settings.cameraEnabled,
            cameraRequireApproval: settings.cameraRequireApproval,
            cameraGalleryUnlockDate: settings.cameraGalleryUnlockDate.trim(),
            cameraGalleryUnlockTime: settings.cameraGalleryUnlockTime.trim(),
            cameraMaxUploadMb: settings.cameraMaxUploadMb,
            cameraShotLimitPerInvite: settings.cameraShotLimitPerInvite,
            cameraLandingEnabled: settings.cameraLandingEnabled,
            cameraEventTitle: settings.cameraEventTitle.trim(),
            cameraEventSubtitle: settings.cameraEventSubtitle.trim(),
            cameraEventDisplayTitle: settings.cameraEventDisplayTitle.trim(),
            cameraEventHashtag: settings.cameraEventHashtag.trim(),
            cameraEventTagline: settings.cameraEventTagline.trim(),
            cameraCoverImageUrl: settings.cameraCoverImageUrl.trim(),
            cameraStartButtonLabel: settings.cameraStartButtonLabel.trim(),
          }),
        },
        { maxAttempts: 4, baseDelayMs: 900 },
      );
      const parsed = payload as JsonRecord;
      const payloadSettings = (parsed.settings as JsonRecord | undefined) ?? {};

      if (!response.ok) {
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        const message =
          typeof parsed.error === "string" ? parsed.error : "Unable to save settings.";
        toast.error("Save failed", {
          description: `${message}${details}`,
        });
        return;
      }

      setSettings((current) => ({
        ...current,
        cameraEnabled: Boolean(payloadSettings.cameraEnabled),
        cameraRequireApproval: Boolean(payloadSettings.cameraRequireApproval),
        cameraGalleryUnlockDate: (payloadSettings.cameraGalleryUnlockDate as string | undefined) ?? "",
        cameraGalleryUnlockTime: (payloadSettings.cameraGalleryUnlockTime as string | undefined) ?? "",
        cameraMaxUploadMb: Number(payloadSettings.cameraMaxUploadMb ?? 3),
        cameraShotLimitPerInvite: Number(payloadSettings.cameraShotLimitPerInvite ?? 27),
        cameraLandingEnabled:
          typeof payloadSettings.cameraLandingEnabled === "boolean"
            ? Boolean(payloadSettings.cameraLandingEnabled)
            : current.cameraLandingEnabled,
        cameraEventTitle: (payloadSettings.cameraEventTitle as string | undefined) ?? current.cameraEventTitle,
        cameraEventSubtitle:
          (payloadSettings.cameraEventSubtitle as string | undefined) ?? current.cameraEventSubtitle,
        cameraEventDisplayTitle:
          (payloadSettings.cameraEventDisplayTitle as string | undefined) ?? current.cameraEventDisplayTitle,
        cameraEventHashtag:
          (payloadSettings.cameraEventHashtag as string | undefined) ?? current.cameraEventHashtag,
        cameraEventTagline:
          (payloadSettings.cameraEventTagline as string | undefined) ?? current.cameraEventTagline,
        cameraCoverImageUrl: (payloadSettings.cameraCoverImageUrl as string | undefined) ?? current.cameraCoverImageUrl,
        cameraStartButtonLabel:
          (payloadSettings.cameraStartButtonLabel as string | undefined) ?? current.cameraStartButtonLabel,
      }));

      const description =
        attempts > 1
          ? `Camera settings updated after ${attempts} attempts.`
          : "Camera settings updated.";
      toast.success("Saved", { description });
    } catch {
      toast.error("Network error", {
        description: "Unable to save camera settings right now.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onUploadCoverImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file || !token) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Invalid file", { description: "Please choose an image file." });
      return;
    }

    const localPreviewUrl = URL.createObjectURL(file);
    setCoverPreviewObjectUrl((current) => {
      if (current.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return localPreviewUrl;
    });

    setCoverUploading(true);
    try {
      const preparedFile = await prepareCoverUploadFile(file);
      const form = new FormData();
      form.set("file", preparedFile, preparedFile.name);

      const { response, payload, attempts } = await fetchJsonWithRetry(
        "/api/admin/camera/cover",
        {
          method: "POST",
          headers: {
            "x-admin-token": token,
          },
          body: form,
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
      );
      const parsed = payload as JsonRecord;
      const cover = (parsed.cover as JsonRecord | undefined) ?? {};
      const uploadedUrl = (cover.url as string | undefined) ?? "";

      if (!response.ok || !uploadedUrl) {
        const payloadEmpty = !parsed || Object.keys(parsed).length === 0;
        if (response.status === 413) {
          toast.error("Upload failed", {
            description:
              "Image is too large for Vercel upload limit. Please use a smaller image.",
          });
          return;
        }
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        const hint = typeof parsed.hint === "string" ? ` ${parsed.hint}` : "";
        const message =
          typeof parsed.error === "string"
            ? parsed.error
            : payloadEmpty
              ? `Unable to upload cover image. HTTP ${response.status}.`
              : "Unable to upload cover image.";
        toast.error("Upload failed", {
          description: `${message}${details}${hint}`,
        });
        return;
      }

      setSettings((current) => ({
        ...current,
        cameraCoverImageUrl: uploadedUrl,
      }));
      setCoverPreviewObjectUrl("");

      const description =
        attempts > 1
          ? `Cover uploaded after ${attempts} attempts. Click Save Camera Settings to apply.`
          : "Cover uploaded. Click Save Camera Settings to apply.";
      toast.success("Cover ready", { description });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to upload cover image right now.";
      toast.error("Network error", {
        description: message,
      });
    } finally {
      setCoverUploading(false);
    }
  }

  async function moderatePhoto(
    id: string,
    action: "approve" | "hide" | "reject",
  ) {
    if (!token) return;
    const rejectionReason =
      action === "reject" ? window.prompt("Optional rejection reason:", "") ?? "" : "";

    setCameraActionLoadingId(id);
    try {
      const response = await fetch("/api/admin/camera/photo", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ id, action, rejectionReason }),
      });

      const payload = await response.json();
      if (!response.ok) {
        const details = payload.details ? ` (${payload.details})` : "";
        toast.error("Update failed", {
          description: `${payload.error ?? "Unable to update photo."}${details}`,
        });
        return;
      }

      toast.success("Photo updated", {
        description: `Status: ${payload.photo?.status ?? action}`,
      });
      await loadCameraData(token, { silent: true });
    } catch {
      toast.error("Network error", {
        description: "Unable to moderate photo right now.",
      });
    } finally {
      setCameraActionLoadingId("");
    }
  }

  async function deletePhoto(id: string) {
    if (!token) return;
    const confirmed = window.confirm(
      "Delete this photo permanently? This will remove it from Google Drive and Camera sheet.",
    );
    if (!confirmed) return;

    setCameraActionLoadingId(id);
    try {
      const response = await fetch("/api/admin/camera/photo", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const details = payload.details ? ` (${payload.details})` : "";
        toast.error("Delete failed", {
          description: `${payload.error ?? "Unable to delete photo."}${details}`,
        });
        return;
      }

      toast.success("Photo deleted", {
        description: "Removed from Drive and gallery records.",
      });
      if (photoPreviewId === id) {
        setPhotoPreviewId("");
      }
      await loadCameraData(token, { silent: true });
    } catch {
      toast.error("Network error", {
        description: "Unable to delete photo right now.",
      });
    } finally {
      setCameraActionLoadingId("");
    }
  }

  async function generateCameraQr() {
    if (!token) return;
    setQrGenerating(true);
    try {
      const { response, payload, attempts } = await fetchJsonWithRetry(
        "/api/admin/camera/qr",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            eventId: qrEventId.trim() || "RJ2026",
            tableCode: qrTableCode.trim() || "GENERAL",
            expiresInHours: Number.parseInt(qrExpiresHours, 10) || 48,
          }),
        },
        { maxAttempts: 4, baseDelayMs: 1200 },
      );
      const parsed = payload as JsonRecord;

      if (!response.ok) {
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        toast.error("QR generation failed", {
          description: `${(parsed.error as string | undefined) ?? "Unable to generate QR."}${details}`,
        });
        return;
      }

      const payloadQr = (parsed.qr as JsonRecord | undefined) ?? {};
      const generatedUrl = (payloadQr.url as string | undefined) ?? "";
      const resolvedEventId = ((payloadQr.eventId as string | undefined) ?? qrEventId).trim() || "RJ2026";
      const resolvedTableCode = ((payloadQr.tableCode as string | undefined) ?? qrTableCode).trim() || "GENERAL";
      const resolvedExpiresAt =
        typeof payloadQr.expiresAt === "string" ? payloadQr.expiresAt : "";
      const resolvedGeneratedAt =
        typeof payloadQr.generatedAt === "string"
          ? payloadQr.generatedAt
          : new Date().toISOString();
      const resolvedId =
        typeof payloadQr.id === "string"
          ? payloadQr.id
          : `live-${resolvedGeneratedAt}-${Math.random().toString(36).slice(2, 8)}`;
      if (!generatedUrl) {
        toast.error("QR generation failed", {
          description: "Generated link is empty. Please try again.",
        });
        return;
      }

      const qrDataUrl = await renderQrDataUrl(generatedUrl, 520);

      setQrUrl(generatedUrl);
      setQrImageDataUrl(qrDataUrl);
      setQrSessionCode(resolvedTableCode);
      setQrExpiresAt(resolvedExpiresAt);
      setQrEventId(resolvedEventId);
      setQrHistory((current) => [
        {
          id: resolvedId,
          createdAt: resolvedGeneratedAt,
          eventId: resolvedEventId,
          tableCode: resolvedTableCode,
          expiresAt: resolvedExpiresAt,
          url: generatedUrl,
          isExpired: false,
          isRevoked: false,
          isActive: true,
        },
        ...current,
      ]);

      const description =
        attempts > 1
          ? `Session code: ${resolvedTableCode}. Recovered after ${attempts} attempts.`
          : `Session code: ${resolvedTableCode}`;
      toast.success("QR generated", { description });
    } catch {
      toast.error("Network error", {
        description: "Unable to generate QR right now.",
      });
    } finally {
      setQrGenerating(false);
    }
  }

  async function copyQrUrl(urlValue?: string) {
    const resolvedUrl = (urlValue ?? qrUrl).trim();
    if (!resolvedUrl) return;
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      toast.success("Copied", { description: "Guest camera link copied." });
    } catch {
      toast.error("Copy failed", { description: "Please copy the link manually." });
    }
  }

  async function revokeQrHistoryItem(item: CameraQrHistoryItem) {
    if (!token) return;
    if (item.isRevoked) return;

    setQrActionsMenu(null);
    setQrHistoryActionLoadingId(item.id);
    try {
      const { response, payload } = await fetchJsonWithRetry(
        "/api/admin/camera/qr",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            id: item.id,
            action: "revoke",
          }),
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
      );
      const parsed = payload as JsonRecord;

      if (!response.ok) {
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        toast.error("Revoke failed", {
          description: `${(parsed.error as string | undefined) ?? "Unable to revoke QR."}${details}`,
        });
        return;
      }

      setQrHistory((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                isRevoked: true,
                isActive: false,
              }
            : entry,
        ),
      );

      if (qrUrl.trim() && qrUrl.trim() === item.url.trim()) {
        clearActiveQrSession();
      }

      toast.success("QR revoked", {
        description: `${item.eventId} / ${item.tableCode || "GENERAL"} has been revoked.`,
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to revoke this QR right now.",
      });
    } finally {
      setQrHistoryActionLoadingId("");
    }
  }

  async function shareQrUrl(urlValue: string, label?: string) {
    const resolvedUrl = (urlValue ?? "").trim();
    if (!resolvedUrl) return;

    const resolvedLabel = label?.trim() || "Guest Camera QR";

    try {
      if (navigator.share) {
        await navigator.share({
          title: resolvedLabel,
          text: `Use this QR link for camera access: ${resolvedLabel}`,
          url: resolvedUrl,
        });
        toast.success("Shared", { description: "QR link shared successfully." });
        return;
      }

      await copyQrUrl(resolvedUrl);
      toast("Share not supported", {
        description: "Link copied instead. Paste it into your sharing app.",
      });
    } catch {
      // User can cancel native share sheet; keep this non-blocking.
    }
  }

  function toggleQrActionsMenu(event: ReactMouseEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setQrBulkMenuOpen(false);
    setQrActionsMenu((current) => {
      if (current?.id === id) return null;
      const width = 188;
      return {
        id,
        top: rect.bottom + 6,
        left: Math.max(12, rect.right - width),
      };
    });
  }

  function closePhotoPreviewModal() {
    setPhotoPreviewId("");
  }

  function openPhotoPreviewModal(photoId: string) {
    setPhotoPreviewId(photoId);
  }

  async function downloadQrImage(dataUrl: string, fileName: string) {
    try {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast.error("Download failed", {
        description: "Unable to download QR image right now.",
      });
    }
  }

  function openPrintWindowWithHtml(params: {
    html: string;
    width: number;
    height: number;
    blockedMessage: string;
  }) {
    const printWindow = window.open("", "_blank", `width=${params.width},height=${params.height}`);
    if (!printWindow) {
      toast.error("Print blocked", {
        description: params.blockedMessage,
      });
      return null;
    }

    printWindow.document.open();
    printWindow.document.write(params.html);
    printWindow.document.close();
    return printWindow;
  }

  async function printQrImage(params: {
    eventId: string;
    tableCode: string;
    expiresAt: string;
    url: string;
    dataUrl: string;
  }) {
    const printCodeTitle = escapeHtml(settings.cameraEventDisplayTitle.trim() || "Red & Jess");
    const printCodeSubtitle = escapeHtml(settings.cameraEventTagline.trim() || "Welcome to our Forever!");
    const printHashtag = escapeHtml(formatEventHashtag(settings.cameraEventHashtag));
    const photoRevealAt = escapeHtml(
      formatPhotoRevealTimestamp(settings.cameraGalleryUnlockDate, settings.cameraGalleryUnlockTime),
    );
    const imageSrc = escapeHtml(params.dataUrl);

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Camera QR</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,400&family=Great+Vibes&display=swap" />
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            .card { max-width: 700px; margin: 0 auto; text-align: center; }
            .code-wrap { margin: 4px 0 16px; }
            .code-title { margin-top: 2px; font-family: "Great Vibes", "Times New Roman", serif; font-size: 42px; line-height: 1.1; color: #54382a; }
            .code-subtitle {
              margin: 12px 0 0;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 22px;
              line-height: 1.2;
              color: #2f1f17;
              font-style: italic;
              font-weight: 400;
            }
            .hash-tag {
              margin-top: 2px;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 22px;
              font-style: italic;
              font-weight: 400;
              line-height: 1.2;
              color: #5d463b;
            }
            .reveal { margin: 14px 0 0; font-size: 14px; color: #333; }
            img { width: 360px; max-width: 100%; border: 1px solid #ddd; padding: 10px; background: #fff; }
          </style>
          <script>
            (() => {
              let printed = false;
              const runPrint = () => {
                if (printed) return;
                printed = true;
                setTimeout(() => {
                  window.focus();
                  window.print();
                }, 300);
              };
              const waitForAssets = () => {
                if (document.fonts && document.fonts.ready) {
                  document.fonts.ready.then(runPrint).catch(runPrint);
                } else {
                  runPrint();
                }
              };
              window.addEventListener("load", waitForAssets);
              setTimeout(runPrint, 1600);
            })();
          </script>
        </head>
        <body>
          <div class="card">
            <div class="code-wrap">
              <div class="code-title">${printCodeTitle}</div>
              <div class="hash-tag">${printHashtag}</div>
            </div>
            <img src="${imageSrc}" alt="Guest camera QR code" />
            <p class="code-subtitle">${printCodeSubtitle}</p>
            <p class="reveal"><strong>Photo Reveal at:</strong> ${photoRevealAt}</p>
          </div>
        </body>
      </html>
    `;

    openPrintWindowWithHtml({
      html,
      width: 900,
      height: 1100,
      blockedMessage: "Please allow pop-ups to print the QR.",
    });
  }

  function closeQrModal() {
    setQrModalItem(null);
    setQrModalImageDataUrl("");
    setQrModalLoading(false);
  }

  async function downloadQrFromModal() {
    if (!qrModalItem || !qrModalImageDataUrl) return;

    const fileName = buildQrExportFileName(qrModalItem.eventId, qrModalItem.tableCode);
    await downloadQrImage(qrModalImageDataUrl, fileName);
  }

  async function printQrFromModal() {
    if (!qrModalItem || !qrModalImageDataUrl) return;
    await printQrImage({
      eventId: qrModalItem.eventId,
      tableCode: qrModalItem.tableCode || "GENERAL",
      expiresAt: qrModalItem.expiresAt,
      url: qrModalItem.url,
      dataUrl: qrModalImageDataUrl,
    });
  }

  async function downloadCurrentQr() {
    if (!qrImageDataUrl || !qrUrl.trim()) return;
    const fileName = buildQrExportFileName(qrEventId || "RJ2026", qrSessionCode || "GENERAL");
    await downloadQrImage(qrImageDataUrl, fileName);
  }

  async function printCurrentQr() {
    if (!qrImageDataUrl || !qrUrl.trim()) return;
    await printQrImage({
      eventId: qrEventId || "RJ2026",
      tableCode: qrSessionCode || "GENERAL",
      expiresAt: qrExpiresAt,
      url: qrUrl,
      dataUrl: qrImageDataUrl,
    });
  }

  async function printQrA4Sheet(params: {
    eventId: string;
    tableCode: string;
    expiresAt: string;
    url: string;
    dataUrl: string;
    copies?: number;
    layout?: "cards" | "poster";
  }) {
    const titleText = escapeHtml(settings.cameraEventDisplayTitle.trim() || "Red & Jess");
    const subtitleText = escapeHtml(settings.cameraEventTagline.trim() || "Welcome to our Forever!");
    const hashtagText = escapeHtml(formatEventHashtag(settings.cameraEventHashtag));
    const photoRevealAt = escapeHtml(
      formatPhotoRevealTimestamp(settings.cameraGalleryUnlockDate, settings.cameraGalleryUnlockTime),
    );
    const imageSrc = escapeHtml(params.dataUrl);
    const layout = params.layout ?? "cards";
    const copies = Math.min(12, Math.max(2, Math.round(params.copies ?? A4_QR_COPIES_PER_PAGE)));
    const cards = Array.from({ length: copies }, (_, index) => {
      return `
        <article class="card">
          <div class="meta-top">
            <div class="title">${titleText}</div>
            <div class="hash-tag">${hashtagText}</div>
          </div>
          <img src="${imageSrc}" alt="Guest camera QR code" />
          <div class="meta-bottom">
            <div class="subtitle">${subtitleText}</div>
            <div class="reveal">Photo Reveal at: ${photoRevealAt}</div>
            <div class="copy-index">Copy ${index + 1}</div>
          </div>
        </article>
      `;
    }).join("");

    const bodyMarkup =
      layout === "poster"
        ? `
          <section class="poster">
            <p class="poster-title">${titleText}</p>
            <p class="poster-hash">${hashtagText}</p>
            <img src="${imageSrc}" alt="Guest camera QR code" />
            <p class="poster-subtitle">${subtitleText}</p>
            <p class="poster-exp">Photo Reveal at: ${photoRevealAt}</p>
          </section>
        `
        : `<section class="grid">${cards}</section>`;

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Camera QR A4 ${layout === "poster" ? "Poster" : "Sheet"}</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,400&family=Great+Vibes&display=swap" />
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              color: #111;
              background: #fff;
            }
            .grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 8mm;
            }
            .card {
              border: 1px dashed #b7b7b7;
              border-radius: 8px;
              padding: 8mm;
              text-align: center;
              break-inside: avoid;
            }
            .meta-top .title {
              margin-top: 1mm;
              font-family: "Great Vibes", "Times New Roman", serif;
              font-size: 13mm;
              line-height: 1.05;
              color: #54382a;
            }
            .meta-top .hash-tag {
              margin-top: 1mm;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 5.3mm;
              font-style: italic;
              font-weight: 400;
              line-height: 1.2;
              color: #5d463b;
            }
            img {
              width: 58mm;
              height: 58mm;
              object-fit: contain;
              border: 1px solid #ddd;
              padding: 3mm;
              background: #fff;
              margin: 4mm auto;
            }
            .meta-bottom .reveal {
              font-size: 10px;
              color: #444;
            }
            .meta-bottom .subtitle {
              margin-bottom: 1.2mm;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 5.5mm;
              line-height: 1.2;
              color: #2f1f17;
              font-style: italic;
              font-weight: 400;
            }
            .meta-bottom .copy-index {
              margin-top: 2mm;
              font-size: 9px;
              color: #8a8a8a;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .poster {
              min-height: 277mm;
              border: 1px solid #d9d9d9;
              border-radius: 8px;
              padding: 16mm 14mm;
              text-align: center;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
            }
            .poster-title {
              margin: 0;
              font-family: "Great Vibes", "Times New Roman", serif;
              font-size: 28mm;
              line-height: 1.02;
              color: #54382a;
            }
            .poster-subtitle {
              margin: 4mm 0 0;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 9.5mm;
              line-height: 1.2;
              color: #2f1f17;
              font-style: italic;
              font-weight: 400;
            }
            .poster-hash {
              margin: 2mm 0 7mm;
              font-family: "Cormorant Garamond", "Times New Roman", serif;
              font-size: 10mm;
              font-style: italic;
              font-weight: 400;
              line-height: 1.15;
              color: #5d463b;
            }
            .poster img {
              width: 120mm;
              height: 120mm;
              object-fit: contain;
              border: 1px solid #ddd;
              padding: 4mm;
              background: #fff;
            }
            .poster-exp {
              margin: 6mm 0 0;
              font-size: 12px;
              color: #444;
            }
          </style>
          <script>
            (() => {
              let printed = false;
              const runPrint = () => {
                if (printed) return;
                printed = true;
                setTimeout(() => {
                  window.focus();
                  window.print();
                }, 350);
              };
              window.addEventListener("load", runPrint);
              setTimeout(runPrint, 1800);
            })();
          </script>
        </head>
        <body>
          ${bodyMarkup}
        </body>
      </html>
    `;

    openPrintWindowWithHtml({
      html,
      width: 1100,
      height: 1400,
      blockedMessage: "Please allow pop-ups to print the A4 QR sheet.",
    });
  }

  async function printQrA4FromModal() {
    if (!qrModalItem || !qrModalImageDataUrl) return;
    await printQrA4Sheet({
      eventId: qrModalItem.eventId,
      tableCode: qrModalItem.tableCode || "GENERAL",
      expiresAt: qrModalItem.expiresAt,
      url: qrModalItem.url,
      dataUrl: qrModalImageDataUrl,
    });
  }

  async function printCurrentQrA4() {
    if (!qrImageDataUrl || !qrUrl.trim()) return;
    await printQrA4Sheet({
      eventId: qrEventId || "RJ2026",
      tableCode: qrSessionCode || "GENERAL",
      expiresAt: qrExpiresAt,
      url: qrUrl,
      dataUrl: qrImageDataUrl,
    });
  }

  async function printCurrentQrPoster() {
    if (!qrImageDataUrl || !qrUrl.trim()) return;
    await printQrA4Sheet({
      eventId: qrEventId || "RJ2026",
      tableCode: qrSessionCode || "GENERAL",
      expiresAt: qrExpiresAt,
      url: qrUrl,
      dataUrl: qrImageDataUrl,
      layout: "poster",
    });
  }

  async function printQrPosterFromModal() {
    if (!qrModalItem || !qrModalImageDataUrl) return;
    await printQrA4Sheet({
      eventId: qrModalItem.eventId,
      tableCode: qrModalItem.tableCode || "GENERAL",
      expiresAt: qrModalItem.expiresAt,
      url: qrModalItem.url,
      dataUrl: qrModalImageDataUrl,
      layout: "poster",
    });
  }

  async function deleteQrHistoryItem(item: CameraQrHistoryItem) {
    if (!token) return;
    if (item.isActive && !item.isRevoked) {
      toast.error("Delete blocked", {
        description: "Revoke this active QR first before deleting it from history.",
      });
      return;
    }

    setQrActionsMenu(null);
    const confirmed = window.confirm(
      `Delete QR for ${item.eventId} / ${item.tableCode || "GENERAL"}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setQrHistoryActionLoadingId(item.id);
    try {
      const { response, payload } = await fetchJsonWithRetry(
        "/api/admin/camera/qr",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({ id: item.id }),
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
      );
      const parsed = payload as JsonRecord;

      if (!response.ok) {
        const details = typeof parsed.details === "string" ? ` (${parsed.details})` : "";
        toast.error("Delete failed", {
          description: `${(parsed.error as string | undefined) ?? "Unable to delete QR."}${details}`,
        });
        return;
      }

      setQrHistory((current) => current.filter((entry) => entry.id !== item.id));
      if (qrUrl.trim() && qrUrl.trim() === item.url.trim()) {
        clearActiveQrSession();
      }
      toast.success("QR deleted", {
        description: `${item.eventId} / ${item.tableCode || "GENERAL"} removed from list.`,
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to delete this QR right now.",
      });
    } finally {
      setQrHistoryActionLoadingId("");
    }
  }

  async function revokeAllExpiredQrs() {
    if (!token) return;
    setQrBulkMenuOpen(false);

    const targets = qrHistory.filter((item) => item.isExpired && !item.isRevoked);
    if (targets.length === 0) {
      toast("No expired active QR", {
        description: "All expired QRs are already revoked.",
      });
      return;
    }

    setQrBulkActionLoading("revoke-expired");
    const updatedIds = new Set<string>();
    let failedCount = 0;

    try {
      for (const item of targets) {
        const { response } = await fetchJsonWithRetry(
          "/api/admin/camera/qr",
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-admin-token": token,
            },
            body: JSON.stringify({
              id: item.id,
              action: "revoke",
            }),
          },
          { maxAttempts: 2, baseDelayMs: 900 },
        );

        if (response.ok) {
          updatedIds.add(item.id);
        } else {
          failedCount += 1;
        }
      }

      if (updatedIds.size > 0) {
        setQrHistory((current) =>
          current.map((entry) =>
            updatedIds.has(entry.id)
              ? {
                  ...entry,
                  isRevoked: true,
                  isActive: false,
                }
              : entry,
          ),
        );
      }

      const activeModalDeleted = qrModalItem && updatedIds.has(qrModalItem.id);
      if (activeModalDeleted) {
        setQrModalItem((current) =>
          current
            ? {
                ...current,
                isRevoked: true,
                isActive: false,
              }
            : null,
        );
      }

      toast.success("Bulk revoke complete", {
        description:
          failedCount > 0
            ? `${updatedIds.size} revoked, ${failedCount} failed.`
            : `${updatedIds.size} expired QR(s) revoked.`,
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to complete bulk revoke right now.",
      });
    } finally {
      setQrBulkActionLoading("");
    }
  }

  async function deleteAllExpiredQrs() {
    if (!token) return;
    setQrBulkMenuOpen(false);

    const targets = qrHistory.filter((item) => item.isExpired);
    if (targets.length === 0) {
      toast("No expired QR", {
        description: "There are no expired QR entries to delete.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Delete ${targets.length} expired QR entr${targets.length === 1 ? "y" : "ies"}?`,
    );
    if (!confirmed) return;

    setQrBulkActionLoading("delete-expired");
    const deletedIds = new Set<string>();
    let failedCount = 0;

    try {
      for (const item of targets) {
        const { response } = await fetchJsonWithRetry(
          "/api/admin/camera/qr",
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "x-admin-token": token,
            },
            body: JSON.stringify({ id: item.id }),
          },
          { maxAttempts: 2, baseDelayMs: 900 },
        );

        if (response.ok) {
          deletedIds.add(item.id);
        } else {
          failedCount += 1;
        }
      }

      if (deletedIds.size > 0) {
        setQrHistory((current) => current.filter((entry) => !deletedIds.has(entry.id)));
      }

      if (qrModalItem && deletedIds.has(qrModalItem.id)) {
        closeQrModal();
      }

      toast.success("Bulk delete complete", {
        description:
          failedCount > 0
            ? `${deletedIds.size} deleted, ${failedCount} failed.`
            : `${deletedIds.size} expired QR entr${deletedIds.size === 1 ? "y" : "ies"} deleted.`,
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to complete bulk delete right now.",
      });
    } finally {
      setQrBulkActionLoading("");
    }
  }

  async function runCameraHealthCheck() {
    if (!token) return;
    setHealthChecking(true);
    try {
      const response = await fetch("/api/admin/camera/health", {
        headers: {
          "x-admin-token": token,
        },
      });
      const payload = await response.json();
      setHealthReportJson(JSON.stringify(payload, null, 2));

      if (!response.ok || !payload.ok) {
        toast.error("Health check found issues", {
          description: "Open the diagnostics panel below for exact failing checks.",
        });
        return;
      }

      toast.success("Health check passed", {
        description: "Drive + Sheets + env checks are all healthy.",
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to run camera health check right now.",
      });
    } finally {
      setHealthChecking(false);
    }
  }

  useEffect(() => {
    if (!qrUrl || !qrExpiresAt) return;

    const expiresAtMs = Date.parse(qrExpiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const timeoutId = window.setTimeout(() => {
      clearActiveQrSession({ showExpiredToast: true });
    }, Math.max(0, expiresAtMs - Date.now()) + 250);

    return () => window.clearTimeout(timeoutId);
  }, [clearActiveQrSession, qrExpiresAt, qrUrl]);

  useEffect(() => {
    const stored = readStoredAdminSession();
    if (!stored) return;
    const timeoutId = window.setTimeout(() => {
      void connectWithToken(stored);
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--ink-deep)] sm:text-4xl">
            Camera Studio
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Dedicated admin workspace for QR disposable camera settings and moderation.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
            <Link
              href="/"
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 hover:bg-[var(--surface-2)]"
            >
              Back To Home
            </Link>
            <span>Security: uses the same `ADMIN_TOKEN` gate.</span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {!connected ? (
        <form
          onSubmit={onConnect}
          className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row"
        >
          <input
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
            type="password"
            placeholder="Enter ADMIN_TOKEN"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--ink-deep)] px-4 py-2 text-[var(--background)] disabled:opacity-50 sm:w-auto"
            disabled={loading || !token.trim()}
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>
      ) : (
        <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--success-border)] bg-[var(--success-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--success-text)]">
              Camera Studio Connected
            </p>
            <p className="text-xs text-[var(--success-text)]">Session: Active (tab only)</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--success-border)] px-4 py-2 text-sm text-[var(--success-text)] sm:w-auto"
              onClick={() => void loadCameraData(token)}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="w-full rounded-lg bg-[var(--ink-deep)] px-4 py-2 text-sm text-[var(--background)] sm:w-auto"
              onClick={disconnect}
            >
              Disconnect
            </button>
          </div>
        </section>
      )}

      {connected ? (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total Uploads" value={cameraPhotos.length} />
            <StatCard label="Pending" value={pendingCount} />
            <StatCard label="Approved" value={approvedCount} />
            <StatCard label="Hidden" value={hiddenCount} />
            <StatCard label="Rejected" value={rejectedCount} />
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink-deep)]">
                  Camera Diagnostics
                </h2>
                <p className="text-xs text-[var(--ink-soft)]">
                  Run this when uploads fail in Vercel preview. It checks env, Drive access, and Sheets access.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg bg-[var(--ink-deep)] px-4 py-2 text-sm text-[var(--background)] disabled:opacity-50"
                onClick={() => void runCameraHealthCheck()}
                disabled={healthChecking}
              >
                {healthChecking ? "Checking..." : "Run Health Check"}
              </button>
            </div>
            {healthReportJson ? (
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-deep)]">
                {healthReportJson}
              </pre>
            ) : null}
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--info-border)] bg-[var(--info-soft)] p-4">
            <h2 className="text-lg font-semibold text-[var(--info-text)]">Camera Settings</h2>
            <p className="mt-1 text-xs text-[var(--info-text)]">
              `cameraMaxUploadMb=0` means no app-level cap. Platform upload limits still apply.
            </p>
            <form
              onSubmit={onSaveSettings}
              className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              <label className="flex items-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--info-text)]">
                <input
                  className="h-4 w-4"
                  type="checkbox"
                  checked={settings.cameraEnabled}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEnabled: event.target.checked,
                    }))
                  }
                />
                <span>Enable guest camera</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--info-text)]">
                <input
                  className="h-4 w-4"
                  type="checkbox"
                  checked={settings.cameraRequireApproval}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraRequireApproval: event.target.checked,
                    }))
                  }
                />
                <span>Require approval</span>
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)]">
                <span>Gallery Unlock Date</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  type="date"
                  value={settings.cameraGalleryUnlockDate}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraGalleryUnlockDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)]">
                <span>Gallery Unlock Time</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  type="time"
                  value={settings.cameraGalleryUnlockTime}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraGalleryUnlockTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)]">
                <span>Max Upload (MB)</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  type="number"
                  min={0}
                  max={100}
                  value={String(settings.cameraMaxUploadMb)}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraMaxUploadMb: Number.parseInt(event.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)]">
                <span>Shot Limit Per Invite/Session</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  type="number"
                  min={0}
                  max={500}
                  value={String(settings.cameraShotLimitPerInvite)}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraShotLimitPerInvite:
                        Number.parseInt(event.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--info-text)] sm:col-span-2 xl:col-span-3">
                <input
                  className="h-4 w-4"
                  type="checkbox"
                  checked={settings.cameraLandingEnabled}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraLandingEnabled: event.target.checked,
                    }))
                  }
                />
                <span>Show landing page before opening camera</span>
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)] sm:col-span-2 xl:col-span-3">
                <span>Landing Event Title</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraEventTitle}
                  maxLength={120}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEventTitle: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)] sm:col-span-2 xl:col-span-3">
                <span>Landing Subtitle</span>
                <textarea
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraEventSubtitle}
                  maxLength={240}
                  rows={3}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEventSubtitle: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)] sm:col-span-2">
                <span>Event Display Title (QR + Camera)</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraEventDisplayTitle}
                  maxLength={80}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEventDisplayTitle: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)] sm:col-span-2">
                <span>Event Tagline (QR + Camera)</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraEventTagline}
                  maxLength={120}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEventTagline: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)] sm:col-span-2 xl:col-span-3">
                <span>Event Hashtag (QR + Camera)</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraEventHashtag}
                  maxLength={80}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraEventHashtag: event.target.value,
                    }))
                  }
                  placeholder="#soaferRED-ynasiJESS"
                />
              </label>
              <div className="flex w-full flex-col gap-2 text-sm text-[var(--info-text)] sm:col-span-2 xl:col-span-3">
                <span>Landing Cover Image</span>
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--surface)] p-3">
                  <input
                    className="rounded-lg border border-[var(--info-border)] bg-[var(--surface-2)] px-3 py-2"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void onUploadCoverImage(event)}
                    disabled={coverUploading}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--info-border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs disabled:opacity-50"
                      onClick={() => {
                        setCoverPreviewObjectUrl((current) => {
                          if (current.startsWith("blob:")) {
                            URL.revokeObjectURL(current);
                          }
                          return "";
                        });
                        setSettings((current) => ({
                          ...current,
                          cameraCoverImageUrl: "",
                        }));
                      }}
                      disabled={
                        coverUploading ||
                        (!settings.cameraCoverImageUrl && !coverPreviewObjectUrl)
                      }
                    >
                      Remove Cover
                    </button>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {coverUploading
                        ? "Uploading cover image..."
                        : "Upload first, then click Save Camera Settings."}
                    </p>
                  </div>
                  <input
                    className="rounded-lg border border-[var(--info-border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-soft)]"
                    value={settings.cameraCoverImageUrl}
                    placeholder="No cover image uploaded yet."
                    onChange={(event) => {
                      setCoverPreviewObjectUrl((current) => {
                        if (current.startsWith("blob:")) {
                          URL.revokeObjectURL(current);
                        }
                        return "";
                      });
                      setSettings((current) => ({
                        ...current,
                        cameraCoverImageUrl: event.target.value,
                      }));
                    }}
                  />
                  <div className="rounded-xl border border-[var(--info-border)] bg-[var(--surface-2)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-[var(--ink-deep)]">
                        Landing Page Preview
                      </p>
                      <span className="text-[10px] text-[var(--ink-soft)]">
                        {settings.cameraLandingEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="mx-auto mt-3 w-full max-w-[320px]">
                      <div className="relative aspect-[9/16] overflow-hidden rounded-[1.5rem] border border-white/20 bg-black">
                        {landingCoverPreviewSrc ? (
                          <img
                            src={landingCoverPreviewSrc}
                            alt="Landing cover preview"
                            className="absolute inset-0 h-full w-full object-cover object-[50%_22%]"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#565656_0%,_#1f1f1f_48%,_#080808_100%)]" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/40 to-black/75" />

                        <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/20 bg-black/55 p-4 backdrop-blur-sm">
                          <p className="text-2xl font-semibold leading-tight text-white">
                            {settings.cameraEventTitle.trim() || "Guest Camera"}
                          </p>
                          <p className="mt-2 text-sm text-white/85">
                            {settings.cameraEventSubtitle.trim() ||
                              "Capture moments from our celebration."}
                          </p>
                          <p
                            className="mt-3 text-3xl leading-tight text-white"
                            style={{ fontFamily: "'Great Vibes', var(--font-script), 'Times New Roman', serif" }}
                          >
                            {settings.cameraEventDisplayTitle.trim() || "Red & Jess"}
                          </p>
                          <p
                            className="mt-1 text-base italic text-white/90"
                            style={{ fontFamily: "'Cormorant Garamond', var(--font-display), 'Times New Roman', serif" }}
                          >
                            {settings.cameraEventTagline.trim() || "Welcome to our Forever!"}
                          </p>
                          <p
                            className="mt-1 text-sm italic text-white/80"
                            style={{ fontFamily: "'Cormorant Garamond', var(--font-display), 'Times New Roman', serif" }}
                          >
                            {formatEventHashtag(settings.cameraEventHashtag)}
                          </p>
                          <button
                            type="button"
                            className="mt-4 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-black"
                            disabled
                          >
                            {settings.cameraStartButtonLabel.trim() || "Start Camera"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <label className="flex w-full flex-col gap-1 text-sm text-[var(--info-text)]">
                <span>Landing Start Button Label</span>
                <input
                  className="rounded-lg border border-[var(--info-border)] bg-[var(--surface)] px-3 py-2"
                  value={settings.cameraStartButtonLabel}
                  maxLength={40}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraStartButtonLabel: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-[var(--background)] disabled:opacity-50 sm:col-span-2 xl:col-span-3"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Camera Settings"}
              </button>
            </form>
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-lg font-semibold text-[var(--ink-deep)]">Guest QR Generator</h2>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Share this QR with guests. It opens `/cam` and does not expose admin access.
            </p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Leave code blank for one universal event QR (recommended).
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft)]">
                <span>Event ID</span>
                <input
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                  value={qrEventId}
                  onChange={(event) => setQrEventId(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft)]">
                <span>Table/Guest Code (optional)</span>
                <input
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                  value={qrTableCode}
                  onChange={(event) => setQrTableCode(event.target.value)}
                  placeholder="GENERAL"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft)]">
                <span>Expires In (hours)</span>
                <input
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                  type="number"
                  min={1}
                  max={720}
                  value={qrExpiresHours}
                  onChange={(event) => setQrExpiresHours(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="w-full rounded-lg bg-[var(--ink-deep)] px-4 py-2 text-sm text-[var(--background)] disabled:opacity-50"
                  onClick={() => void generateCameraQr()}
                  disabled={qrGenerating}
                >
                  {qrGenerating ? "Generating..." : "Generate QR"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
              QR center title now follows Event Display Title from Camera Settings.
            </p>

            {qrUrl ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <p className="text-xs uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                    Guest Camera URL
                  </p>
                  <p className="mt-2 break-all text-xs text-[var(--ink-deep)]">{qrUrl}</p>
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">
                    Session code: {qrSessionCode || "GENERAL"}
                  </p>
                  {qrExpiresAtLabel ? (
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      Expires: {qrExpiresAtLabel}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void copyQrUrl()}
                    >
                      Copy Link
                    </button>
                    <a
                      href={qrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                    >
                      Open Link
                    </a>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void shareQrUrl(qrUrl, `${qrEventId} / ${qrSessionCode || "GENERAL"}`)}
                    >
                      Share Link
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void downloadCurrentQr()}
                      disabled={!qrImageDataUrl}
                    >
                      Download QR
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void printCurrentQr()}
                      disabled={!qrImageDataUrl}
                    >
                      Print QR
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void printCurrentQrA4()}
                      disabled={!qrImageDataUrl}
                    >
                      Print Table Cards (2x4)
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                      onClick={() => void printCurrentQrPoster()}
                      disabled={!qrImageDataUrl}
                    >
                      Print Entrance Poster
                    </button>
                  </div>
                </div>
                {qrImageDataUrl ? (
                  <img
                    src={qrImageDataUrl}
                    alt="Guest camera QR code"
                    className="h-44 w-44 rounded-xl border border-[var(--border)] bg-white p-2"
                  />
                ) : null}
              </div>
            ) : null}

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--ink-deep)]">Generated QR List</h3>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-[var(--ink-soft)]">
                    {qrHistory.length} item(s) | Expired: {qrExpiredCount}
                  </p>
                  <div className="relative">
                    <button
                      type="button"
                      data-qr-bulk-trigger="true"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)]"
                      onClick={() => {
                        setQrActionsMenu(null);
                        setQrBulkMenuOpen((current) => !current);
                      }}
                    >
                      Bulk Actions
                    </button>
                    {qrBulkMenuOpen ? (
                      <div
                        data-qr-bulk-menu="true"
                        className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm"
                      >
                        <button
                          type="button"
                          className="w-full rounded-md border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--warn-text)] disabled:opacity-50"
                          onClick={() => void revokeAllExpiredQrs()}
                          disabled={qrBulkActionLoading === "revoke-expired" || qrExpiredUnrevokedCount === 0}
                        >
                          {qrBulkActionLoading === "revoke-expired"
                            ? "Revoking Expired..."
                            : `Revoke All Expired (${qrExpiredUnrevokedCount})`}
                        </button>
                        <button
                          type="button"
                          className="mt-1 w-full rounded-md border border-[var(--error-border)] bg-[var(--error-soft)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--error-text)] disabled:opacity-50"
                          onClick={() => void deleteAllExpiredQrs()}
                          disabled={qrBulkActionLoading === "delete-expired" || qrExpiredCount === 0}
                        >
                          {qrBulkActionLoading === "delete-expired"
                            ? "Deleting Expired..."
                            : `Delete All Expired (${qrExpiredCount})`}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              {qrHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-soft)]">
                  No generated QR yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                  <table className="min-w-full divide-y divide-[var(--border)] text-xs">
                    <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-soft)]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Event</th>
                        <th className="px-3 py-2 font-medium">Table/Code</th>
                        <th className="px-3 py-2 font-medium">Generated</th>
                        <th className="px-3 py-2 font-medium">Expires</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                      {pagedQrHistory.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-medium text-[var(--ink-deep)]">{item.eventId}</td>
                          <td className="px-3 py-2 text-[var(--ink-soft)]">{item.tableCode || "GENERAL"}</td>
                          <td className="px-3 py-2 text-[var(--ink-soft)]">{formatTimestamp(item.createdAt)}</td>
                          <td className="px-3 py-2 text-[var(--ink-soft)]">{formatTimestamp(item.expiresAt)}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                              {item.isRevoked ? "revoked" : item.isExpired ? "expired" : "active"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              data-qr-actions-trigger="true"
                              className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)]"
                              onClick={(event) => toggleQrActionsMenu(event, item.id)}
                            >
                              Actions
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {qrHistory.length > 0 ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => setQrPage((current) => Math.max(1, current - 1))}
                    disabled={qrPage <= 1}
                  >
                    Prev
                  </button>
                  <span className="text-xs text-[var(--ink-soft)]">
                    Page {Math.min(qrPage, qrTotalPages)} / {qrTotalPages}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => setQrPage((current) => Math.min(qrTotalPages, current + 1))}
                    disabled={qrPage >= qrTotalPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink-deep)]">
                Camera Upload Moderation
              </h2>
              <p className="text-xs text-[var(--ink-soft)]">
                {cameraPhotos.length} upload(s) total
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
                <span>Uploader</span>
                <select
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--ink-deep)]"
                  value={photoUploaderFilter}
                  onChange={(event) => {
                    setPhotoUploaderFilter(event.target.value);
                    setPhotoPage(1);
                  }}
                >
                  {uploaderOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All" : option}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[var(--ink-soft)]">
                Showing {filteredCameraPhotos.length} item(s)
              </p>
            </div>
            {cameraPhotos.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-soft)]">
                No camera uploads yet.
              </div>
            ) : filteredCameraPhotos.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-soft)]">
                No uploads for selected uploader.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="min-w-full divide-y divide-[var(--border)] text-xs">
                  <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-soft)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Photo</th>
                      <th className="px-3 py-2 font-medium">Uploader</th>
                      <th className="px-3 py-2 font-medium">Invite</th>
                      <th className="px-3 py-2 font-medium">Uploaded</th>
                      <th className="px-3 py-2 font-medium">Visible At</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                    {pagedCameraPhotos.map((photo) => (
                      <tr key={photo.id}>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 hover:bg-[var(--surface)]"
                            onClick={() => openPhotoPreviewModal(photo.id)}
                            title="Preview photo"
                            aria-label="Preview photo"
                          >
                            <img
                              src={photo.imageUrl}
                              alt={`Camera upload by ${photo.uploaderName}`}
                              className="h-12 w-12 rounded object-cover"
                              loading="lazy"
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 font-medium text-[var(--ink-deep)]">{photo.uploaderName}</td>
                        <td className="px-3 py-2 text-[var(--ink-soft)]">{photo.inviteCode || "-"}</td>
                        <td className="px-3 py-2 text-[var(--ink-soft)]">{formatTimestamp(photo.createdAt)}</td>
                        <td className="px-3 py-2 text-[var(--ink-soft)]">{formatTimestamp(photo.visibilityAt)}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                            {photo.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] disabled:opacity-50"
                              onClick={() => void moderatePhoto(photo.id, "approve")}
                              disabled={cameraActionLoadingId === photo.id}
                              title="Approve photo"
                              aria-label="Approve photo"
                            >
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                                <path d="M7.7 13.2 4.5 10l-1.4 1.4 4.6 4.6L17 6.7l-1.4-1.4z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn-text)] disabled:opacity-50"
                              onClick={() => void moderatePhoto(photo.id, "hide")}
                              disabled={cameraActionLoadingId === photo.id}
                              title="Hide photo"
                              aria-label="Hide photo"
                            >
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                                <path d="M10 4c4.5 0 7.8 3.4 9 6-1.2 2.6-4.5 6-9 6s-7.8-3.4-9-6c1.2-2.6 4.5-6 9-6Zm0 2c-3.2 0-5.9 2.2-6.9 4 .9 1.8 3.6 4 6.9 4 3.2 0 5.9-2.2 6.9-4-.9-1.8-3.6-4-6.9-4Zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--error-border)] bg-[var(--error-soft)] text-[var(--error-text)] disabled:opacity-50"
                              onClick={() => void moderatePhoto(photo.id, "reject")}
                              disabled={cameraActionLoadingId === photo.id}
                              title="Reject photo"
                              aria-label="Reject photo"
                            >
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                                <path d="m11.4 10 4.3-4.3-1.4-1.4-4.3 4.3-4.3-4.3-1.4 1.4L8.6 10l-4.3 4.3 1.4 1.4 4.3-4.3 4.3 4.3 1.4-1.4z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--error-border)] bg-[var(--surface)] text-[var(--error-text)] disabled:opacity-50"
                              onClick={() => void deletePhoto(photo.id)}
                              disabled={cameraActionLoadingId === photo.id}
                              title="Delete photo"
                              aria-label="Delete photo"
                            >
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                                <path d="M7 2h6l1 2h4v2H2V4h4l1-2Zm-2 6h10l-.7 9.2A2 2 0 0 1 12.3 19H7.7a2 2 0 0 1-2-1.8L5 8Zm3 2v6h2v-6H8Zm4 0v6h2v-6h-2Z" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredCameraPhotos.length > 0 ? (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs disabled:opacity-50"
                  onClick={() => setPhotoPage((current) => Math.max(1, current - 1))}
                  disabled={photoPage <= 1}
                >
                  Prev
                </button>
                <span className="text-xs text-[var(--ink-soft)]">
                  Page {Math.min(photoPage, photoTotalPages)} / {photoTotalPages}
                </span>
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs disabled:opacity-50"
                  onClick={() => setPhotoPage((current) => Math.min(photoTotalPages, current + 1))}
                  disabled={photoPage >= photoTotalPages}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {qrActionsMenu && activeQrActionsItem ? (
        <div
          data-qr-actions-menu="true"
          className="fixed z-30 flex w-44 flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm"
          style={{ top: qrActionsMenu.top, left: qrActionsMenu.left }}
        >
          <button
            type="button"
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)] disabled:opacity-50"
            onClick={() => {
              setQrActionsMenu(null);
              void openQrModalFromHistory(activeQrActionsItem);
            }}
            disabled={activeQrActionsItem.isRevoked || qrHistoryActionLoadingId === activeQrActionsItem.id}
          >
            Show QR
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)] disabled:opacity-50"
            onClick={() => {
              setQrActionsMenu(null);
              void copyQrUrl(activeQrActionsItem.url);
            }}
            disabled={!activeQrActionsItem.url.trim() || qrHistoryActionLoadingId === activeQrActionsItem.id}
          >
            Copy Link
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)] disabled:opacity-50"
            onClick={() => {
              setQrActionsMenu(null);
              void shareQrUrl(
                activeQrActionsItem.url,
                `${activeQrActionsItem.eventId} / ${activeQrActionsItem.tableCode || "GENERAL"}`,
              );
            }}
            disabled={!activeQrActionsItem.url.trim() || qrHistoryActionLoadingId === activeQrActionsItem.id}
          >
            Share Link
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--warn-text)] disabled:opacity-50"
            onClick={() => void revokeQrHistoryItem(activeQrActionsItem)}
            disabled={activeQrActionsItem.isRevoked || qrHistoryActionLoadingId === activeQrActionsItem.id}
          >
            {activeQrActionsItem.isRevoked ? "Revoked" : "Revoke"}
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--error-border)] bg-[var(--error-soft)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--error-text)] disabled:opacity-50"
            onClick={() => void deleteQrHistoryItem(activeQrActionsItem)}
            disabled={
              qrHistoryActionLoadingId === activeQrActionsItem.id ||
              (activeQrActionsItem.isActive && !activeQrActionsItem.isRevoked)
            }
          >
            Delete
          </button>
          <a
            href={activeQrActionsItem.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.08em] text-[var(--ink-deep)]"
            onClick={() => setQrActionsMenu(null)}
          >
            Open Link
          </a>
        </div>
      ) : null}

      {qrModalItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeQrModal();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink-deep)]">Guest Camera QR</h3>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  Event: {qrModalItem.eventId} | Table: {qrModalItem.tableCode || "GENERAL"}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  Expires: {formatTimestamp(qrModalItem.expiresAt)}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs"
                onClick={closeQrModal}
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex justify-center">
              {qrModalLoading ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-8 text-xs text-[var(--ink-soft)]">
                  Rendering QR...
                </div>
              ) : qrModalImageDataUrl ? (
                <img
                  src={qrModalImageDataUrl}
                  alt="Selected guest camera QR"
                  className="h-72 w-72 rounded-xl border border-[var(--border)] bg-white p-3"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-8 text-xs text-[var(--ink-soft)]">
                  QR preview unavailable.
                </div>
              )}
            </div>

            <p className="mt-4 break-all rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              {qrModalItem.url}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs disabled:opacity-50"
                onClick={() => void downloadQrFromModal()}
                disabled={!qrModalImageDataUrl || qrModalLoading}
              >
                Download QR
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs disabled:opacity-50"
                onClick={() => void printQrFromModal()}
                disabled={!qrModalImageDataUrl || qrModalLoading}
              >
                Print QR
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs disabled:opacity-50"
                onClick={() => void printQrA4FromModal()}
                disabled={!qrModalImageDataUrl || qrModalLoading}
              >
                Print Table Cards (2x4)
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs disabled:opacity-50"
                onClick={() => void printQrPosterFromModal()}
                disabled={!qrModalImageDataUrl || qrModalLoading}
              >
                Print Entrance Poster
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs"
                onClick={() => void copyQrUrl(qrModalItem.url)}
              >
                Copy Link
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs"
                onClick={() =>
                  void shareQrUrl(
                    qrModalItem.url,
                    `${qrModalItem.eventId} / ${qrModalItem.tableCode || "GENERAL"}`,
                  )
                }
              >
                Share Link
              </button>
              <a
                href={qrModalItem.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs"
              >
                Open Link
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCameraPhoto ? (
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-black/60 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closePhotoPreviewModal();
            }
          }}
        >
          <div className="mx-auto flex h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-lg sm:h-[calc(100dvh-2rem)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-3 sm:px-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--ink-deep)] sm:text-lg">Photo Preview</h3>
                <p className="mt-1 truncate text-[11px] text-[var(--ink-soft)] sm:text-xs">
                  {selectedCameraPhoto.uploaderName} | Invite: {selectedCameraPhoto.inviteCode || "-"}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--ink-soft)] sm:text-xs">
                  {formatTimestamp(selectedCameraPhoto.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] sm:px-3 sm:text-xs"
                onClick={closePhotoPreviewModal}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 px-2 py-2 sm:px-4 sm:py-3">
              <div className="flex h-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                <img
                  src={selectedCameraPhoto.imageUrl}
                  alt={`Camera upload by ${selectedCameraPhoto.uploaderName}`}
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            <aside className="border-t border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 sm:px-4 sm:py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                  Status: {selectedCameraPhoto.status}
                </p>
                {cameraActionLoadingId === selectedCameraPhoto.id ? (
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                    Updating...
                  </p>
                ) : null}
              </div>
              <div className="flex items-center justify-center gap-2 sm:justify-end">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] disabled:opacity-50"
                  onClick={() => void moderatePhoto(selectedCameraPhoto.id, "approve")}
                  disabled={cameraActionLoadingId === selectedCameraPhoto.id}
                  title="Approve photo"
                  aria-label="Approve photo"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="M7.7 13.2 4.5 10l-1.4 1.4 4.6 4.6L17 6.7l-1.4-1.4z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn-text)] disabled:opacity-50"
                  onClick={() => void moderatePhoto(selectedCameraPhoto.id, "hide")}
                  disabled={cameraActionLoadingId === selectedCameraPhoto.id}
                  title="Hide photo"
                  aria-label="Hide photo"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="M10 4c4.5 0 7.8 3.4 9 6-1.2 2.6-4.5 6-9 6s-7.8-3.4-9-6c1.2-2.6 4.5-6 9-6Zm0 2c-3.2 0-5.9 2.2-6.9 4 .9 1.8 3.6 4 6.9 4 3.2 0 5.9-2.2 6.9-4-.9-1.8-3.6-4-6.9-4Zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--error-border)] bg-[var(--error-soft)] text-[var(--error-text)] disabled:opacity-50"
                  onClick={() => void moderatePhoto(selectedCameraPhoto.id, "reject")}
                  disabled={cameraActionLoadingId === selectedCameraPhoto.id}
                  title="Reject photo"
                  aria-label="Reject photo"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="m11.4 10 4.3-4.3-1.4-1.4-4.3 4.3-4.3-4.3-1.4 1.4L8.6 10l-4.3 4.3 1.4 1.4 4.3-4.3 4.3 4.3 1.4-1.4z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--error-border)] bg-[var(--surface)] text-[var(--error-text)] disabled:opacity-50"
                  onClick={() => void deletePhoto(selectedCameraPhoto.id)}
                  disabled={cameraActionLoadingId === selectedCameraPhoto.id}
                  title="Delete photo"
                  aria-label="Delete photo"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="M7 2h6l1 2h4v2H2V4h4l1-2Zm-2 6h10l-.7 9.2A2 2 0 0 1 12.3 19H7.7a2 2 0 0 1-2-1.8L5 8Zm3 2v6h2v-6H8Zm4 0v6h2v-6h-2Z" />
                  </svg>
                </button>
                <a
                  href={selectedCameraPhoto.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-deep)]"
                  title="Open original image"
                  aria-label="Open original image"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="M11 3h6v6h-2V6.4l-5.3 5.3-1.4-1.4L13.6 5H11V3Zm-7 2h5v2H6v8h8v-3h2v5H4V5Z" />
                  </svg>
                </a>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-soft)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[var(--ink-deep)]">{value}</p>
    </div>
  );
}
