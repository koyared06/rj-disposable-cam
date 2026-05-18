"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type CameraSessionSettings = {
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
  weddingDate: string;
  weddingTime: string;
};

type CameraGalleryItem = {
  id: string;
  createdAt: string;
  inviteCode: string;
  uploaderName: string;
  status: "pending" | "approved" | "hidden" | "rejected" | string;
  isOwnPhoto: boolean;
  visibilityAt: string;
  imageUrl: string;
};

type CameraUsage = {
  shotsUsed: number;
  shotsLimit: number;
  shotsLeft: number | null;
};
type LocalShotStatus = "draft" | "queued" | "uploading" | "failed";
type LocalShot = {
  id: string;
  file: File;
  previewUrl: string;
  selected: boolean;
  status: LocalShotStatus;
  createdAt: number;
};
type CameraFacing = "environment" | "user";
type GalleryFilterMode = "all" | "mine" | "capturer";

const ADMIN_SESSION_KEY = "rj_admin_session_v1";
const MANILA_TIMEZONE = "Asia/Manila";
const LOCAL_SHOTS_DB_NAME = "rj-camera-local-shots-v1";
const LOCAL_SHOTS_STORE_NAME = "shots";
const WATERMARK_JPEG_QUALITIES = [0.92, 0.86, 0.8, 0.74, 0.68] as const;

const DEFAULT_SETTINGS: CameraSessionSettings = {
  cameraEnabled: false,
  cameraRequireApproval: true,
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
  weddingDate: "",
  weddingTime: "",
};

function makeDeviceStorageKey(eventId: string) {
  return `rj_camera_device_${eventId}`;
}

function makeGuestNameStorageKey(eventId: string) {
  return `rj_camera_guest_name_${eventId}`;
}

function readOrCreateDeviceId(eventId: string) {
  const key = makeDeviceStorageKey(eventId);
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, created);
  return created;
}

function resolveGalleryUnlockMessage(settings: CameraSessionSettings) {
  const date = settings.cameraGalleryUnlockDate.trim();
  const time = settings.cameraGalleryUnlockTime.trim();
  if (!date) return "";

  const iso = `${date}T${time || "00:00"}:00`;
  const unlockAt = new Date(iso);
  if (Number.isNaN(unlockAt.getTime())) return "";

  const formatted = unlockAt.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: MANILA_TIMEZONE,
  });

  if (unlockAt.getTime() <= Date.now()) {
    return `Gallery unlock is active since ${formatted}.`;
  }
  return `Gallery photos unlock on ${formatted}.`;
}

function formatManilaDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: MANILA_TIMEZONE,
  });
}

function formatEventHashtag(value: string, fallback = "#soaferRED-ynasiJESS") {
  const trimmed = (value ?? "").trim();
  const resolved = trimmed || fallback;
  if (!resolved) return "";
  return resolved.startsWith("#") ? resolved : `#${resolved}`;
}

function formatEventDateLabel(weddingDate: string, weddingTime: string) {
  const date = (weddingDate ?? "").trim();
  if (!date) return "";
  const time = (weddingTime ?? "").trim() || "00:00";
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: MANILA_TIMEZONE,
  });
}

function formatShotTimeLabel(shotAt: Date) {
  return shotAt.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: MANILA_TIMEZONE,
  });
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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

type PersistedLocalShot = {
  id: string;
  scope: string;
  fileName: string;
  fileType: string;
  blob: Blob;
  selected: boolean;
  status: LocalShotStatus;
  createdAt: number;
};

function buildLocalShotScope(eventId: string, deviceId: string) {
  return `${eventId}::${deviceId}`;
}

function openLocalShotsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(LOCAL_SHOTS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_SHOTS_STORE_NAME)) {
        const store = db.createObjectStore(LOCAL_SHOTS_STORE_NAME, { keyPath: "id" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local shots DB."));
  });
}

async function listPersistedLocalShotsByScope(scope: string): Promise<PersistedLocalShot[]> {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  const db = await openLocalShotsDb();
  try {
    return await new Promise<PersistedLocalShot[]>((resolve, reject) => {
      const tx = db.transaction(LOCAL_SHOTS_STORE_NAME, "readonly");
      const store = tx.objectStore(LOCAL_SHOTS_STORE_NAME);
      const index = store.index("scope");
      const request = index.getAll(scope);
      request.onsuccess = () => resolve((request.result ?? []) as PersistedLocalShot[]);
      request.onerror = () =>
        reject(request.error ?? new Error("Unable to read local persisted shots."));
    });
  } finally {
    db.close();
  }
}

async function putPersistedLocalShot(row: PersistedLocalShot) {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const db = await openLocalShotsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_SHOTS_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Unable to save local shot."));
      tx.objectStore(LOCAL_SHOTS_STORE_NAME).put(row);
    });
  } finally {
    db.close();
  }
}

async function deletePersistedLocalShot(id: string) {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const db = await openLocalShotsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_SHOTS_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Unable to delete local shot."));
      tx.objectStore(LOCAL_SHOTS_STORE_NAME).delete(id);
    });
  } finally {
    db.close();
  }
}

function trackSupportsTorch(track: MediaStreamTrack | null | undefined) {
  if (!track) return false;
  const withCaps = track as MediaStreamTrack & {
    getCapabilities?: () => unknown;
    getSettings?: () => MediaTrackSettings;
  };
  const capabilities = (withCaps.getCapabilities?.() ?? {}) as Record<string, unknown>;
  if (capabilities.torch === true) return true;
  if ("torch" in capabilities) return true;
  const settings = withCaps.getSettings?.();
  return typeof settings?.torch === "boolean";
}

function RollingShotsValue({ value }: { value: number }) {
  const valueRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const node = valueRef.current;
    if (!node) return;
    const animation = node.animate(
      [
        { transform: "translateY(55%)", opacity: 0.45 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
    return () => animation.cancel();
  }, [value]);

  return (
    <span className="relative inline-flex h-[1em] overflow-hidden align-baseline leading-none">
      <span ref={valueRef} className="inline-block">
        {value}
      </span>
    </span>
  );
}

export default function CameraLandingPage() {
  const qrParams = useMemo(() => {
    if (typeof window === "undefined") {
      return { eventId: "", cameraToken: "" };
    }
    const params = new URLSearchParams(window.location.search);
    return {
      eventId: (params.get("e") ?? "").trim(),
      cameraToken: (params.get("t") ?? "").trim(),
    };
  }, []);
  const eventId = qrParams.eventId;
  const cameraToken = qrParams.cameraToken;
  const [deviceId, setDeviceId] = useState("");
  const [settings, setSettings] = useState<CameraSessionSettings>(DEFAULT_SETTINGS);
  const [galleryItems, setGalleryItems] = useState<CameraGalleryItem[]>([]);
  const [usage, setUsage] = useState<CameraUsage>({
    shotsUsed: 0,
    shotsLimit: 27,
    shotsLeft: 27,
  });
  const [uploaderName, setUploaderName] = useState("");
  const [guestNameDraft, setGuestNameDraft] = useState("");
  const [showGuestNameModal, setShowGuestNameModal] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("environment");
  const [cameraTransitioning, setCameraTransitioning] = useState(false);
  const [keepCameraActive, setKeepCameraActive] = useState(true);
  const [cameraPermissionFailed, setCameraPermissionFailed] = useState(false);
  const [showGallerySheet, setShowGallerySheet] = useState(false);
  const [showGalleryLockNotice, setShowGalleryLockNotice] = useState(true);
  const [expandedGalleryImage, setExpandedGalleryImage] = useState<{
    imageUrl: string;
    uploaderName: string;
    createdAt: string;
    blur: boolean;
  } | null>(null);
  const [activeLocalShotId, setActiveLocalShotId] = useState("");
  const [galleryFilterMode, setGalleryFilterMode] = useState<GalleryFilterMode>("all");
  const [selectedCapturer, setSelectedCapturer] = useState("");
  const [downloadingGallery, setDownloadingGallery] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [flashPulse, setFlashPulse] = useState(false);
  const [zoomOptions, setZoomOptions] = useState<number[]>([1]);
  const [selectedZoom, setSelectedZoom] = useState(1);
  const [adminToken] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.sessionStorage.getItem(ADMIN_SESSION_KEY)?.trim() ?? "";
    } catch {
      return "";
    }
  });
  const [guestNameError, setGuestNameError] = useState("");
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localShots, setLocalShots] = useState<LocalShot[]>([]);
  const [localShotsReadyScope, setLocalShotsReadyScope] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedShotsCount, setUploadedShotsCount] = useState(0);
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0);
  const [uploadBatchDone, setUploadBatchDone] = useState(0);
  const [showStartNotice, setShowStartNotice] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [qrImageDataUrl, setQrImageDataUrl] = useState("");
  const [qrRendering, setQrRendering] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadPickerRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localShotsRef = useRef<LocalShot[]>([]);
  const queueProcessingRef = useRef(false);
  const mountedRef = useRef(true);
  const localShotsScopeRef = useRef("");
  const watermarkFontsReadyRef = useRef(false);

  const pendingUploads = localShots.filter(
    (shot) => shot.status === "queued" || shot.status === "uploading",
  ).length;
  const failedShotsCount = localShots.filter((shot) => shot.status === "failed").length;
  const unsentShotsCount = localShots.length;
  const selectedForUploadCount = localShots.filter(
    (shot) =>
      shot.selected && (shot.status === "draft" || shot.status === "failed"),
  ).length;
  const capturedShotsCount = usage.shotsUsed + localShots.length;
  const effectiveShotsLeft =
    usage.shotsLimit > 0
      ? Math.max(0, usage.shotsLimit - capturedShotsCount)
      : null;
  const canCaptureMoreShots =
    usage.shotsLimit <= 0 || effectiveShotsLeft === null || effectiveShotsLeft > 0;
  const uploadBatchPercent =
    uploadBatchTotal > 0 ? Math.round((uploadBatchDone / uploadBatchTotal) * 100) : 0;
  const showLandingFirst = settings.cameraLandingEnabled;
  const showLandingScreen = showLandingFirst && !started;
  const shareableCameraUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (!eventId || !cameraToken) return "";
    const base = window.location.origin;
    const params = new URLSearchParams({ e: eventId, t: cameraToken });
    return `${base}/cam?${params.toString()}`;
  }, [cameraToken, eventId]);
  const latestLocalPreviewUrl =
    localShots.length > 0 ? localShots[localShots.length - 1]?.previewUrl ?? "" : "";
  const normalizedGuestName = uploaderName.trim();
  const isAdminViewer = Boolean(adminToken.trim());

  const stopCamera = useCallback((manualClose = false) => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (manualClose) {
      setKeepCameraActive(false);
    }
    setCameraOpen(false);
  }, []);

  const returnToCameraLanding = useCallback(() => {
    stopCamera(true);
    setStarted(false);
    setShowGallerySheet(false);
    setExpandedGalleryImage(null);
    setActiveLocalShotId("");
    setShowQrSheet(false);
  }, [stopCamera]);

  const loadGallery = useCallback(async () => {
    if (!eventId || !cameraToken || !deviceId) return;
    try {
      const params = new URLSearchParams({
        e: eventId,
        t: cameraToken,
        device: deviceId,
      });
      const response = await fetch(`/api/camera/list?${params.toString()}`, {
        headers: adminToken
          ? {
              "x-admin-token": adminToken,
            }
          : undefined,
      });
      const payload = await response.json();
      if (!response.ok) {
        setFeedback(payload.error ?? "Unable to load gallery.");
        return;
      }

      setGalleryItems(Array.isArray(payload.items) ? payload.items : []);
      if (payload.usage) {
        setUsage({
          shotsUsed: Number(payload.usage.shotsUsed ?? 0),
          shotsLimit: Number(payload.usage.shotsLimit ?? settings.cameraShotLimitPerInvite),
          shotsLeft:
            typeof payload.usage.shotsLeft === "number" || payload.usage.shotsLeft === null
              ? payload.usage.shotsLeft
              : null,
        });
      }
    } catch {
      setFeedback("Unable to load gallery right now.");
    }
  }, [adminToken, cameraToken, deviceId, eventId, settings.cameraShotLimitPerInvite]);

  const saveGuestName = useCallback(
    (inputName: string) => {
      const cleanName = inputName.trim().slice(0, 120);
      if (!cleanName) {
        setGuestNameError("Guest name is required.");
        setFeedback("Please enter your name before taking a photo.");
        return false;
      }

      setGuestNameError("");
      setUploaderName(cleanName);
      setGuestNameDraft(cleanName);
      if (eventId) {
        try {
          window.localStorage.setItem(makeGuestNameStorageKey(eventId), cleanName);
        } catch {
          // Ignore localStorage write errors.
        }
      }
      setShowGuestNameModal(false);
      setFeedback("");
      return true;
    },
    [eventId],
  );

  const ensureGuestName = useCallback(() => {
    if (normalizedGuestName) return true;
    setGuestNameDraft("");
    setGuestNameError("Guest name is required.");
    setShowGuestNameModal(true);
    setFeedback("Please enter your name before taking a photo.");
    return false;
  }, [normalizedGuestName]);

  const ensureWatermarkFontsLoaded = useCallback(async () => {
    if (watermarkFontsReadyRef.current) return;
    if (typeof document === "undefined" || !document.fonts) {
      watermarkFontsReadyRef.current = true;
      return;
    }

    try {
      await Promise.all([
        document.fonts.load(`400 32px "Great Vibes"`),
        document.fonts.load(`italic 400 22px "Cormorant Garamond"`),
      ]);
      await document.fonts.ready;
    } catch {
      // Fallback to system fonts if custom fonts fail to load.
    } finally {
      watermarkFontsReadyRef.current = true;
    }
  }, []);

  const drawShotWatermark = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number, shotAt: Date) => {
      const eventTitle = (settings.cameraEventTitle || "Guest Camera").trim().slice(0, 48);
      const hashtag = formatEventHashtag(settings.cameraEventHashtag).slice(0, 60);
      const eventDate =
        formatEventDateLabel(
          settings.weddingDate || settings.cameraGalleryUnlockDate,
          settings.weddingTime || settings.cameraGalleryUnlockTime,
        ) || "Event Date";
      const shotTime = formatShotTimeLabel(shotAt);

      const pad = Math.max(10, Math.round(width * 0.018));
      const left = Math.max(10, Math.round(width * 0.026));
      const blockBottom = height - Math.max(12, Math.round(height * 0.03));

      const titleSize = Math.max(20, Math.min(46, Math.round(width * 0.048)));
      const hashSize = Math.max(13, Math.min(24, Math.round(width * 0.024)));
      const dateSize = Math.max(11, Math.min(20, Math.round(width * 0.019)));
      const timeSize = Math.max(11, Math.min(20, Math.round(width * 0.02)));

      context.save();
      context.textAlign = "left";
      context.textBaseline = "alphabetic";

      context.font = `400 ${titleSize}px "Great Vibes", "Times New Roman", serif`;
      const titleWidth = context.measureText(eventTitle).width;
      context.font = `italic 400 ${hashSize}px "Cormorant Garamond", "Times New Roman", serif`;
      const hashWidth = context.measureText(hashtag).width;
      context.font = `500 ${dateSize}px Arial, sans-serif`;
      const dateWidth = context.measureText(eventDate).width;

      const blockWidth = Math.max(titleWidth, hashWidth, dateWidth) + pad * 2;
      const lineGap = Math.max(3, Math.round(hashSize * 0.16));
      const line1Height = Math.round(titleSize * 1.02);
      const line2Height = Math.round(hashSize * 1.03);
      const line3Height = Math.round(dateSize * 1.05);
      const blockHeight = pad * 2 + line1Height + lineGap + line2Height + lineGap + line3Height;
      const blockTop = blockBottom - blockHeight;

      drawRoundedRect(
        context,
        left,
        blockTop,
        blockWidth,
        blockHeight,
        Math.max(8, Math.round(blockHeight * 0.11)),
      );
      context.fillStyle = "rgba(0,0,0,0.28)";
      context.fill();

      const textX = left + pad;
      let textY = blockTop + pad + line1Height;

      context.fillStyle = "rgba(255,245,232,0.96)";
      context.shadowColor = "rgba(0,0,0,0.35)";
      context.shadowBlur = Math.max(2, Math.round(width * 0.003));
      context.font = `400 ${titleSize}px "Great Vibes", "Times New Roman", serif`;
      context.fillText(eventTitle, textX, textY);

      textY += lineGap + line2Height;
      context.shadowBlur = Math.max(1, Math.round(width * 0.0025));
      context.font = `italic 400 ${hashSize}px "Cormorant Garamond", "Times New Roman", serif`;
      context.fillStyle = "rgba(246,236,224,0.95)";
      context.fillText(hashtag, textX, textY);

      textY += lineGap + line3Height;
      context.shadowBlur = 0;
      context.font = `500 ${dateSize}px Arial, sans-serif`;
      context.fillStyle = "rgba(255,255,255,0.9)";
      context.fillText(eventDate, textX, textY);

      const timePadX = Math.max(8, Math.round(width * 0.014));
      const timePadY = Math.max(6, Math.round(width * 0.01));
      context.font = `600 ${timeSize}px Arial, sans-serif`;
      const timeWidth = context.measureText(shotTime).width;
      const timeBoxWidth = timeWidth + timePadX * 2;
      const timeBoxHeight = timeSize + timePadY * 2;
      const timeX = width - left - timeBoxWidth;
      const timeY = height - Math.max(10, Math.round(height * 0.026)) - timeBoxHeight;

      drawRoundedRect(
        context,
        timeX,
        timeY,
        timeBoxWidth,
        timeBoxHeight,
        Math.max(8, Math.round(timeBoxHeight * 0.35)),
      );
      context.fillStyle = "rgba(0,0,0,0.3)";
      context.fill();
      context.fillStyle = "rgba(255,255,255,0.92)";
      context.textBaseline = "middle";
      context.fillText(shotTime, timeX + timePadX, timeY + timeBoxHeight / 2 + 0.5);

      context.restore();
    },
    [
      settings.cameraEventHashtag,
      settings.cameraEventTitle,
      settings.weddingDate,
      settings.weddingTime,
      settings.cameraGalleryUnlockDate,
      settings.cameraGalleryUnlockTime,
    ],
  );

  const applyWatermarkToImageFile = useCallback(
    async (file: File) => {
      await ensureWatermarkFontsLoaded();

      const objectUrl = URL.createObjectURL(file);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error("Unable to read selected image."));
          element.src = objectUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        if (!context || canvas.width < 1 || canvas.height < 1) return file;

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        drawShotWatermark(context, canvas.width, canvas.height, new Date());

        const maxBytes =
          settings.cameraMaxUploadMb > 0
            ? settings.cameraMaxUploadMb * 1024 * 1024
            : Number.POSITIVE_INFINITY;

        let bestBlob: Blob | null = null;
        for (const quality of WATERMARK_JPEG_QUALITIES) {
          const blob = await canvasToBlob(canvas, "image/jpeg", quality);
          if (!blob) continue;
          bestBlob = blob;
          if (!Number.isFinite(maxBytes) || blob.size <= maxBytes) break;
        }

        if (!bestBlob) return file;
        if (Number.isFinite(maxBytes) && bestBlob.size > maxBytes) {
          return null;
        }
        return new File([bestBlob], file.name, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [drawShotWatermark, ensureWatermarkFontsLoaded, settings.cameraMaxUploadMb],
  );

  const startCamera = useCallback(
    async (preferredFacing: CameraFacing = cameraFacing) => {
      if (!canCaptureMoreShots) {
        setFeedback("Shot limit reached.");
        return;
      }

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setFeedback("Camera is not supported in this browser. Use upload as fallback.");
        return;
      }

      setCameraTransitioning(true);
      const hadStream = Boolean(streamRef.current);
      stopCamera(false);
      if (hadStream) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }

      const backupFacing: CameraFacing =
        preferredFacing === "environment" ? "user" : "environment";
      const cameraConstraints: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        { video: { facingMode: preferredFacing }, audio: false },
        { video: { facingMode: backupFacing }, audio: false },
        { video: true, audio: false },
      ];

      try {
        let stream: MediaStream | null = null;
        for (const constraints of cameraConstraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch {
            continue;
          }
        }

        if (!stream) {
          setCameraPermissionFailed(true);
          setFeedback("Camera permission blocked or unavailable. Use upload as fallback.");
          setCameraTransitioning(false);
          return;
        }

        streamRef.current = stream;
        setCameraPermissionFailed(false);
        setKeepCameraActive(true);
        setCameraFacing(preferredFacing);
        setCameraOpen(true);
        setFeedback("");
      } catch {
        setCameraPermissionFailed(true);
        setFeedback("Camera permission blocked. Use upload as fallback.");
      } finally {
        setCameraTransitioning(false);
      }
    },
    [cameraFacing, canCaptureMoreShots, stopCamera],
  );

  const switchCameraFacing = useCallback(async () => {
    const nextFacing: CameraFacing =
      cameraFacing === "environment" ? "user" : "environment";
    await startCamera(nextFacing);
  }, [cameraFacing, startCamera]);

  const uploadPhotoNow = useCallback(async (fileToUpload: File) => {
    let timeoutHandle: number | null = null;
    try {
      const abortController = new AbortController();
      timeoutHandle = window.setTimeout(() => abortController.abort(), 45000);
      const formData = new FormData();
      formData.set("eventId", eventId);
      formData.set("cameraToken", cameraToken);
      formData.set("deviceId", deviceId);
      formData.set("uploaderName", normalizedGuestName || "Guest");
      formData.set("file", fileToUpload, fileToUpload.name);

      const response = await fetch("/api/camera/upload", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        const code =
          typeof payload.errorCode === "string" && payload.errorCode
            ? ` [${payload.errorCode}]`
            : "";
        const hint = typeof payload.hint === "string" && payload.hint ? ` ${payload.hint}` : "";
        setFeedback(`${payload.error ?? "Unable to upload."}${code}${hint}`);
        if (payload.usage) {
          setUsage((current) => ({
            shotsUsed: Number(payload.usage.shotsUsed ?? current.shotsUsed),
            shotsLimit: Number(payload.usage.shotsLimit ?? current.shotsLimit),
            shotsLeft:
              typeof payload.usage.shotsLeft === "number" || payload.usage.shotsLeft === null
                ? payload.usage.shotsLeft
                : current.shotsLeft,
          }));
        }
        return false;
      }

      if (payload.usage) {
        setUsage((current) => ({
          shotsUsed: Number(payload.usage.shotsUsed ?? current.shotsUsed),
          shotsLimit: Number(payload.usage.shotsLimit ?? current.shotsLimit),
          shotsLeft:
            typeof payload.usage.shotsLeft === "number" || payload.usage.shotsLeft === null
              ? payload.usage.shotsLeft
              : current.shotsLeft,
        }));
      }

      setFeedback("");
      await loadGallery();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setFeedback("Upload timed out. Check internet then retry selected shots.");
      } else {
        setFeedback("Network error uploading photo.");
      }
      return false;
    } finally {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    }
  }, [cameraToken, deviceId, eventId, loadGallery, normalizedGuestName]);

  useEffect(() => {
    localShotsRef.current = localShots;
  }, [localShots]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!eventId || !deviceId) return;
    let cancelled = false;
    const scope = buildLocalShotScope(eventId, deviceId);
    localShotsScopeRef.current = scope;

    const hydrate = async () => {
      try {
        const persisted = await listPersistedLocalShotsByScope(scope);
        if (cancelled) return;
        const restored = persisted
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((entry) => {
            const file = new File([entry.blob], entry.fileName || `cam-${entry.id}.jpg`, {
              type: entry.fileType || "image/jpeg",
            });
            const previewUrl = URL.createObjectURL(entry.blob);
            const status: LocalShotStatus =
              entry.status === "queued" || entry.status === "uploading"
                ? "draft"
                : entry.status;
            return {
              id: entry.id,
              file,
              previewUrl,
              selected: entry.selected,
              status,
              createdAt: entry.createdAt,
            } satisfies LocalShot;
          });
        setLocalShots((current) => {
          current.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
          return restored;
        });
      } catch {
        // Ignore local persistence load errors and continue with empty in-memory queue.
      } finally {
        if (!cancelled) {
          setLocalShotsReadyScope(scope);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [deviceId, eventId]);

  useEffect(() => {
    const scope = localShotsScopeRef.current;
    if (!scope) return;
    if (localShotsReadyScope !== scope) return;
    let cancelled = false;

    const sync = async () => {
      try {
        const existing = await listPersistedLocalShotsByScope(scope);
        const nextIds = new Set(localShots.map((shot) => shot.id));

        for (const stale of existing) {
          if (!nextIds.has(stale.id)) {
            await deletePersistedLocalShot(stale.id);
          }
        }

        for (const shot of localShots) {
          const persistedStatus: LocalShotStatus =
            shot.status === "uploading" ? "queued" : shot.status;
          await putPersistedLocalShot({
            id: shot.id,
            scope,
            fileName: shot.file.name || `cam-${shot.id}.jpg`,
            fileType: shot.file.type || "image/jpeg",
            blob: shot.file,
            selected: shot.selected,
            status: persistedStatus,
            createdAt: shot.createdAt,
          });
        }
      } catch {
        if (!cancelled) {
          // Ignore sync errors to avoid disrupting camera flow.
        }
      }
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, [localShots, localShotsReadyScope]);

  useEffect(() => {
    if (uploading || queueProcessingRef.current) return;
    const nextQueuedShot = localShots.find((shot) => shot.status === "queued");
    if (!nextQueuedShot) return;

    queueProcessingRef.current = true;
    const nextFile = nextQueuedShot.file;
    const nextId = nextQueuedShot.id;

    const processNext = async () => {
      setLocalShots((current) =>
        current.map((shot) =>
          shot.id === nextId ? { ...shot, status: "uploading" } : shot,
        ),
      );
      setUploading(true);

      let ok = false;
      try {
        ok = await uploadPhotoNow(nextFile);
      } catch {
        ok = false;
      }

      if (ok) {
        setLocalShots((current) => {
          const target = current.find((shot) => shot.id === nextId);
          if (target) {
            URL.revokeObjectURL(target.previewUrl);
          }
          return current.filter((shot) => shot.id !== nextId);
        });
        setUploadedShotsCount((current) => current + 1);
        setUploadBatchDone((current) => current + 1);
      } else {
        setLocalShots((current) =>
          current.map((shot) =>
            shot.id === nextId ? { ...shot, status: "failed" } : shot,
          ),
        );
      }

      queueProcessingRef.current = false;
      if (mountedRef.current) {
        setUploading(false);
      }
    };

    void processNext();
  }, [localShots, uploading, uploadPhotoNow]);

  useEffect(
    () => () => {
      localShotsRef.current.forEach((shot) => {
        URL.revokeObjectURL(shot.previewUrl);
      });
      stopCamera(false);
    },
    [stopCamera],
  );

  function addLocalShot(fileToUpload: File) {
    if (!canCaptureMoreShots) {
      setFeedback("Shot limit reached.");
      return false;
    }

    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const preview = URL.createObjectURL(fileToUpload);
    setLocalShots((current) => [
      ...current,
      {
        id: localId,
        file: fileToUpload,
        previewUrl: preview,
        selected: true,
        status: "draft",
        createdAt: Date.now(),
      },
    ]);
    setFeedback("Shot saved locally. Select and upload when ready.");
    return true;
  }

  function addLocalFilesBatch(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/") && file.size > 0);
    if (imageFiles.length < 1) {
      setFeedback("Please select image files.");
      return;
    }

    let added = 0;
    setLocalShots((current) => {
      const slotsLeft =
        usage.shotsLimit > 0
          ? Math.max(0, usage.shotsLimit - (usage.shotsUsed + current.length))
          : Number.POSITIVE_INFINITY;

      const nextItems: LocalShot[] = [];
      for (const file of imageFiles) {
        if (nextItems.length >= slotsLeft) break;
        const localId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const previewUrl = URL.createObjectURL(file);
        nextItems.push({
          id: localId,
          file,
          previewUrl,
          selected: true,
          status: "draft",
          createdAt: Date.now(),
        });
      }

      added = nextItems.length;
      return [...current, ...nextItems];
    });

    if (added < 1) {
      setFeedback("Shot limit reached.");
      return;
    }
    setFeedback(`${added} photo${added === 1 ? "" : "s"} added to your upload queue.`);
  }

  function openUploadPicker() {
    if (!ensureGuestName()) return;
    uploadPickerRef.current?.click();
  }

  async function onUploadPickerChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (selected.length < 1) return;
    setFeedback("Applying watermark...");
    const processed: File[] = [];
    let skippedCount = 0;
    for (const file of selected) {
      const item = await applyWatermarkToImageFile(file);
      if (!item) {
        skippedCount += 1;
        continue;
      }
      processed.push(item);
    }
    if (processed.length < 1) {
      setFeedback(
        skippedCount > 0
          ? `Selected file(s) are unsupported or exceed ${settings.cameraMaxUploadMb} MB.`
          : "No valid image files to add.",
      );
      return;
    }
    if (skippedCount > 0) {
      setFeedback(
        `${processed.length} photo(s) added. ${skippedCount} skipped (unsupported or exceeds ${settings.cameraMaxUploadMb} MB).`,
      );
    }
    addLocalFilesBatch(processed);
  }

  function toggleLocalShotSelection(id: string) {
    setLocalShots((current) =>
      current.map((shot) =>
        shot.id === id ? { ...shot, selected: !shot.selected } : shot,
      ),
    );
  }

  function removeLocalShot(id: string) {
    setLocalShots((current) => {
      const target = current.find((shot) => shot.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((shot) => shot.id !== id);
    });
    if (activeLocalShotId === id) {
      setActiveLocalShotId("");
    }
  }

  function queueSelectedShotsForUpload() {
    if (selectedForUploadCount < 1) {
      setFeedback("Select at least one shot to upload.");
      return;
    }
    const targetCount = selectedForUploadCount;

    setLocalShots((current) =>
      current.map((shot) =>
        shot.selected && (shot.status === "draft" || shot.status === "failed")
          ? { ...shot, status: "queued" }
          : shot,
      ),
    );
    setUploadBatchTotal(targetCount);
    setUploadBatchDone(0);
    setFeedback("");
  }

  function queueSingleShotForUpload(id: string) {
    let queued = false;
    setLocalShots((current) =>
      current.map((shot) => {
        if (shot.id !== id) return shot;
        if (shot.status === "draft" || shot.status === "failed") {
          queued = true;
          return { ...shot, selected: true, status: "queued" };
        }
        return shot;
      }),
    );

    if (!queued) {
      setFeedback("This shot is already queued or uploading.");
      return;
    }

    setUploadBatchTotal(1);
    setUploadBatchDone(0);
    setFeedback("");
    setActiveLocalShotId("");
  }

  function retryFailedShots() {
    if (failedShotsCount < 1) {
      setFeedback("No failed shots to retry.");
      return;
    }

    const retryCount = localShots.filter((shot) => shot.status === "failed").length;
    setLocalShots((current) =>
      current.map((shot) =>
        shot.status === "failed"
          ? { ...shot, status: "queued", selected: true }
          : shot,
      ),
    );
    setUploadBatchTotal(retryCount);
    setUploadBatchDone(0);
    setFeedback("");
  }

  async function captureShot() {
    if (!ensureGuestName()) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!video || !canvas || !cameraOpen) {
      setFeedback("Camera is not ready.");
      return;
    }

    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (width < 1 || height < 1) {
      setFeedback("Unable to capture frame.");
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setFeedback("Unable to process camera frame.");
      return;
    }

    const canTryHardwareTorch = Boolean(
      flashEnabled && track && cameraFacing === "environment",
    );
    let torchEnabled = false;
    let useScreenFlashPulse = false;

    if (flashEnabled) {
      if (canTryHardwareTorch && track) {
        try {
          await track.applyConstraints({
            advanced: [{ torch: true } as MediaTrackConstraintSet],
          });
          torchEnabled = true;
          if (!torchSupported) {
            setTorchSupported(true);
          }
          await new Promise((resolve) => window.setTimeout(resolve, 110));
        } catch {
          // Hardware torch may fail on some browsers/devices; continue with software flash.
          torchEnabled = false;
          useScreenFlashPulse = true;
          await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
      } else {
        useScreenFlashPulse = true;
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
    }

    if (useScreenFlashPulse) {
      setFlashPulse(true);
    }

    if (flashEnabled && !torchEnabled) {
      context.filter = "brightness(1.16) contrast(1.06)";
    } else {
      context.filter = "none";
    }
    await ensureWatermarkFontsLoaded();
    const shotCapturedAt = new Date();
    context.drawImage(video, 0, 0, width, height);
    drawShotWatermark(context, width, height, shotCapturedAt);
    context.filter = "none";

    if (torchEnabled && track) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: false } as MediaTrackConstraintSet],
        });
      } catch {
        // Ignore torch reset failures.
      }
    }
    if (useScreenFlashPulse) {
      window.setTimeout(() => setFlashPulse(false), 150);
    }

    const maxBytes =
      settings.cameraMaxUploadMb > 0
        ? settings.cameraMaxUploadMb * 1024 * 1024
        : Number.POSITIVE_INFINITY;
    let blob: Blob | null = null;
    for (const quality of WATERMARK_JPEG_QUALITIES) {
      const candidate = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!candidate) continue;
      blob = candidate;
      if (!Number.isFinite(maxBytes) || candidate.size <= maxBytes) break;
    }
    if (!blob) {
      setFeedback("Unable to capture photo.");
      return;
    }
    if (Number.isFinite(maxBytes) && blob.size > maxBytes) {
      setFeedback(
        `Captured photo is too large for upload (${settings.cameraMaxUploadMb} MB max). Try again.`,
      );
      return;
    }

    const fileToUpload = new File([blob], `cam-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    addLocalShot(fileToUpload);
  }

  async function openQrSheet() {
    if (!shareableCameraUrl) {
      setFeedback("Missing camera share link.");
      return;
    }
    setShowQrSheet(true);
    if (qrImageDataUrl || qrRendering) return;

    setQrRendering(true);
    try {
      const dataUrl = await QRCode.toDataURL(shareableCameraUrl, {
        width: 520,
        margin: 1,
      });
      setQrImageDataUrl(dataUrl);
    } catch {
      setFeedback("Unable to render QR code right now.");
    } finally {
      setQrRendering(false);
    }
  }

  async function shareCameraLink() {
    if (!shareableCameraUrl) {
      setFeedback("Missing camera share link.");
      return;
    }

    try {
      setSharing(true);
      const shareTitle =
        settings.cameraEventDisplayTitle || settings.cameraEventTitle || "Guest Camera";
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: shareTitle,
          text: `Join ${shareTitle} camera`,
          url: shareableCameraUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(shareableCameraUrl);
      setFeedback("Camera link copied. You can paste and share it.");
    } catch {
      setFeedback("Sharing cancelled or not available on this device.");
    } finally {
      setSharing(false);
    }
  }

  async function applyZoomLevel(level: number) {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks?.()[0];
    if (!track || !Number.isFinite(level)) return;

    try {
      const capabilities = (
        track as MediaStreamTrack & {
          getCapabilities?: () => unknown;
        }
      ).getCapabilities?.();

      const zoomCapability = (capabilities as Record<string, unknown> | undefined)?.[
        "zoom"
      ] as
        | { min?: number; max?: number; step?: number }
        | undefined;
      if (!zoomCapability || typeof zoomCapability.min !== "number" || typeof zoomCapability.max !== "number") {
        return;
      }

      const clamped = Math.max(zoomCapability.min, Math.min(level, zoomCapability.max));
      await track.applyConstraints({
        advanced: [{ zoom: clamped } as MediaTrackConstraintSet],
      });
      setSelectedZoom(level);
    } catch {
      setZoomOptions((current) => {
        const next = current.filter((zoom) => zoom !== level);
        if (next.length < 1) return [1];
        return next;
      });
      setSelectedZoom((current) => (current === level ? 1 : current));
    }
  }

  function toggleFlashOption() {
    setFlashEnabled((current) => !current);
  }

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      if (!eventId || !cameraToken) {
        if (!cancelled) {
          setError("Missing camera QR parameters.");
          setLoading(false);
        }
        return;
      }

      const device = readOrCreateDeviceId(eventId);
      try {
        const sessionParams = new URLSearchParams({ e: eventId, t: cameraToken });
        const response = await fetch(`/api/camera/session?${sessionParams.toString()}`);
        const payload = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            setError(payload.error ?? "Invalid QR session.");
          }
          return;
        }

        if (!cancelled) {
          setDeviceId(device);
          let persistedGuestName = "";
          try {
            persistedGuestName = window.localStorage
              .getItem(makeGuestNameStorageKey(eventId))
              ?.trim() ?? "";
          } catch {
            persistedGuestName = "";
          }
          setSettings({
            cameraEnabled: Boolean(payload.settings?.cameraEnabled),
            cameraRequireApproval: Boolean(payload.settings?.cameraRequireApproval),
            cameraGalleryUnlockDate: payload.settings?.cameraGalleryUnlockDate ?? "",
            cameraGalleryUnlockTime: payload.settings?.cameraGalleryUnlockTime ?? "",
            cameraMaxUploadMb: Number(payload.settings?.cameraMaxUploadMb ?? 3),
            cameraShotLimitPerInvite: Number(payload.settings?.cameraShotLimitPerInvite ?? 27),
            cameraLandingEnabled:
              typeof payload.settings?.cameraLandingEnabled === "boolean"
                ? payload.settings.cameraLandingEnabled
                : true,
            cameraEventTitle: payload.settings?.cameraEventTitle ?? "Guest Camera",
            cameraEventSubtitle:
              payload.settings?.cameraEventSubtitle ??
              "Capture moments from our celebration.",
            cameraEventDisplayTitle:
              payload.settings?.cameraEventDisplayTitle ?? "Red & Jess",
            cameraEventHashtag:
              payload.settings?.cameraEventHashtag ?? "#soaferRED-ynasiJESS",
            cameraEventTagline:
              payload.settings?.cameraEventTagline ?? "Welcome to our Forever!",
            cameraCoverImageUrl: payload.settings?.cameraCoverImageUrl ?? "",
            cameraStartButtonLabel:
              payload.settings?.cameraStartButtonLabel ?? "Start Camera",
            weddingDate: payload.settings?.weddingDate ?? "",
            weddingTime: payload.settings?.weddingTime ?? "",
          });
          setUploaderName(persistedGuestName);
          setGuestNameDraft(persistedGuestName);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to validate camera session.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [cameraToken, eventId]);

  useEffect(() => {
    if (!eventId || !cameraToken || !deviceId || loading || error) return;
    const timer = window.setTimeout(() => {
      void loadGallery();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cameraToken, deviceId, error, eventId, loadGallery, loading]);

  useEffect(() => {
    if (unsentShotsCount < 1) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [unsentShotsCount]);

  useEffect(() => {
    if (showLandingScreen) return;
    if (cameraOpen || uploading || cameraTransitioning) return;
    if (!keepCameraActive || cameraPermissionFailed || !canCaptureMoreShots) return;

    const timer = window.setTimeout(() => {
      void startCamera();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    cameraOpen,
    cameraPermissionFailed,
    cameraTransitioning,
    canCaptureMoreShots,
    keepCameraActive,
    showLandingScreen,
    startCamera,
    uploading,
  ]);

  useEffect(() => {
    if (!cameraOpen) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    const track = stream.getVideoTracks()[0];

    let cancelled = false;
    const attachAndPlay = async () => {
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.srcObject = stream;

      try {
        await video.play();
      } catch {
        // Playback can fail on some browsers until user interacts again.
      }

      try {
        const capabilities = (
          track as MediaStreamTrack & {
            getCapabilities?: () => unknown;
          }
        ).getCapabilities?.();

        setTorchSupported(trackSupportsTorch(track));

        const zoomCap = (capabilities as Record<string, unknown> | undefined)?.["zoom"] as
          | { min?: number; max?: number }
          | undefined;
        if (zoomCap && typeof zoomCap.min === "number" && typeof zoomCap.max === "number") {
          const min = Math.max(1, Math.ceil(zoomCap.min));
          const max = Math.max(min, Math.floor(zoomCap.max));
          const built: number[] = [];
          for (let zoom = min; zoom <= Math.min(max, 3); zoom += 1) {
            built.push(zoom);
          }
          if (!built.includes(1)) {
            built.unshift(1);
          }
          const uniqueSorted = Array.from(new Set(built)).sort((a, b) => a - b);
          setZoomOptions(uniqueSorted);
          const defaultZoom = uniqueSorted.includes(1) ? 1 : uniqueSorted[0];
          setSelectedZoom(defaultZoom);
          if (defaultZoom) {
            const clamped = Math.max(
              zoomCap.min,
              Math.min(defaultZoom, zoomCap.max),
            );
            await track.applyConstraints({
              advanced: [{ zoom: clamped } as MediaTrackConstraintSet],
            });
          }
        } else {
          setZoomOptions([1]);
          setSelectedZoom(1);
        }
      } catch {
        setTorchSupported(false);
        setZoomOptions([1]);
        setSelectedZoom(1);
      }

      window.setTimeout(() => {
        if (cancelled) return;
        if (!video.videoWidth || !video.videoHeight) {
          setFeedback(
            "Camera opened but preview is blocked. Try closing and opening camera again, or use upload fallback.",
          );
        }
      }, 900);
    };

    void attachAndPlay();

    return () => {
      cancelled = true;
    };
  }, [cameraOpen]);

  if (loading) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10 text-center text-sm text-[var(--ink-soft)]">
        Validating camera access...
      </main>
    );
  }

  if (error) {
    const missingQrParams = error === "Missing camera QR parameters.";
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        {missingQrParams ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h1 className="text-xl font-semibold text-[var(--ink-deep)]">
              Camera link required
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              This page needs a QR-generated link with session parameters.
            </p>
            <div className="mt-4 rounded-xl border border-[var(--error-border)] bg-[var(--error-soft)] p-3 text-sm text-[var(--error-text)]">
              Missing camera QR parameters.
            </div>
            <div className="mt-4 space-y-2 text-sm text-[var(--ink-soft)]">
              <p>Use a link that contains both `e` and `t` query params.</p>
              <p>
                Example: <span className="break-all">/cam?e=RJ2026&t=your_signed_token</span>
              </p>
              <p>
                Generate one from{" "}
                <a
                  href="/admin/camera"
                  className="font-medium text-[var(--accent)] underline underline-offset-2"
                >
                  Camera Studio
                </a>{" "}
                using Guest QR Generator.
              </p>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-[var(--error-border)] bg-[var(--error-soft)] p-4 text-sm text-[var(--error-text)]">
            {error}
          </div>
        )}
      </main>
    );
  }

  const galleryUnlockMessage = resolveGalleryUnlockMessage(settings);
  const galleryUnlockAt = (() => {
    const date = settings.cameraGalleryUnlockDate.trim();
    const time = settings.cameraGalleryUnlockTime.trim() || "00:00";
    if (!date) return null;
    const value = new Date(`${date}T${time}:00`);
    if (Number.isNaN(value.getTime())) return null;
    return value;
  })();
  const cameraEndsText = galleryUnlockAt
    ? galleryUnlockAt.toLocaleString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: MANILA_TIMEZONE,
      })
    : "TBA";
  const galleryRevealAtText = galleryUnlockAt
    ? galleryUnlockAt.toLocaleString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: MANILA_TIMEZONE,
      })
    : "TBA";
  const isGalleryLockedForViewer =
    !isAdminViewer &&
    Boolean(galleryUnlockAt && galleryUnlockAt.getTime() > Date.now());
  const capturerOptions = Array.from(
    new Set(
      galleryItems
        .map((item) => item.uploaderName.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const filteredGalleryItems = (() => {
    if (galleryFilterMode === "mine") {
      return galleryItems.filter(
        (item) =>
          item.isOwnPhoto ||
          (normalizedGuestName &&
            item.uploaderName.trim().toLowerCase() ===
              normalizedGuestName.toLowerCase()),
      );
    }
    if (galleryFilterMode === "capturer") {
      const selected = selectedCapturer.trim().toLowerCase();
      if (!selected) return galleryItems;
      return galleryItems.filter(
        (item) => item.uploaderName.trim().toLowerCase() === selected,
      );
    }
    return galleryItems;
  })();
  const featuredGalleryItem = filteredGalleryItems[0] ?? null;
  const shouldBlurFeaturedGalleryItem =
    Boolean(featuredGalleryItem) && isGalleryLockedForViewer;
  const canExportGallery = !isGalleryLockedForViewer || isAdminViewer;
  const localShotsNewestFirst = [...localShots].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const activeLocalShot =
    activeLocalShotId
      ? localShots.find((shot) => shot.id === activeLocalShotId) ?? null
      : null;
  const isGuestNameModalVisible =
    showGuestNameModal || (!showLandingScreen && !normalizedGuestName);

  async function downloadFilteredGallery() {
    if (filteredGalleryItems.length === 0 || downloadingGallery) return;
    setDownloadingGallery(true);

    try {
      const safeEvent = (settings.cameraEventDisplayTitle || settings.cameraEventTitle || "event")
        .replace(/[^a-z0-9-_]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .toLowerCase();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");

      for (let index = 0; index < filteredGalleryItems.length; index += 1) {
        const item = filteredGalleryItems[index];
        const response = await fetch(item.imageUrl);
        if (!response.ok) continue;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const fileName = `${safeEvent || "event"}-${index + 1}-${item.uploaderName
          .replace(/[^a-z0-9-_]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 28)
          .toLowerCase()}-${stamp}.jpg`;

        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        await new Promise((resolve) => window.setTimeout(resolve, 140));
      }
    } finally {
      setDownloadingGallery(false);
    }
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#090909] text-white">
      {showLandingScreen ? (
        <section className="relative flex h-[100dvh] items-end justify-center overflow-hidden px-4 py-10">
          {settings.cameraCoverImageUrl ? (
            <img
              src={settings.cameraCoverImageUrl}
              alt="Event camera cover"
              className="absolute inset-0 h-full w-full object-cover object-[50%_22%]"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#454545_0%,_#121212_52%,_#060606_100%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
          <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/20 bg-black/40 p-5 backdrop-blur-sm">
            <h1 className="mt-2 text-3xl font-semibold">{settings.cameraEventTitle}</h1>
            <p className="mt-2 text-sm text-white/80">{settings.cameraEventSubtitle}</p>
            <button
              type="button"
              className="mt-5 w-full rounded-full bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-black"
              onClick={() => setShowStartNotice(true)}
            >
              {settings.cameraStartButtonLabel}
            </button>
          </div>

          {showStartNotice ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-5">
              <div className="w-full max-w-sm rounded-2xl border border-white/25 bg-black/85 p-4 backdrop-blur-sm">
                <p className="text-base font-semibold text-white">Before you continue</p>
                <p className="mt-2 text-sm leading-relaxed text-white/80">
                  Please use a strong internet connection to make sure your shots upload
                  successfully.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
                  If you close this app while uploads are pending, unsent shots may be lost.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm text-white"
                    onClick={() => setShowStartNotice(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black"
                    onClick={() => {
                      setShowStartNotice(false);
                      setStarted(true);
                      setKeepCameraActive(true);
                      void startCamera();
                    }}
                  >
                    I Understand
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
          <section className="relative h-full overflow-hidden bg-black">
            {cameraOpen ? (
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#3d3d3d_0%,_#141414_52%,_#050505_100%)]" />
            )}

            <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/80 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
            {flashPulse ? (
              <div className="pointer-events-none absolute inset-0 z-[5] bg-white/70 mix-blend-screen" />
            ) : null}

            <div className="relative z-20 flex items-start justify-between p-4">
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white shadow-lg"
                onClick={() => returnToCameraLanding()}
                aria-label="Close camera"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path
                    d="M18.3 5.71a1 1 0 00-1.41 0L12 10.59 7.11 5.7A1 1 0 005.7 7.12L10.58 12l-4.9 4.89a1 1 0 101.42 1.41L12 13.41l4.89 4.9a1 1 0 001.41-1.42L13.42 12l4.9-4.89a1 1 0 00-.02-1.4z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/30 bg-black/45 text-white"
                onClick={() => openUploadPicker()}
                aria-label="Upload photo"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path
                    d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM8.5 11A1.5 1.5 0 1110 9.5 1.5 1.5 0 018.5 11zm3.8 6H5.2l3.3-4.2 2.2 2.7 3.2-3.8L18.8 17h-5.7zM19 8h-2V6h-2V4h2V2h2v2h2v2h-2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-12 z-10 px-6 text-center">
              <p
                className="text-[2.25rem] leading-[1.15] tracking-[0.01em] text-white drop-shadow-lg"
                style={{ fontFamily: "'Great Vibes', var(--font-script), 'Times New Roman', serif" }}
              >
                {settings.cameraEventDisplayTitle}
              </p>
              <p
                className="mt-1 text-[1.75rem] italic leading-[1.1] text-white/90 drop-shadow"
                style={{ fontFamily: "'Cormorant Garamond', var(--font-display), 'Times New Roman', serif" }}
              >
                {formatEventHashtag(settings.cameraEventHashtag)}
              </p>
              <p
                className="mt-1 text-sm italic text-white/80 drop-shadow"
                style={{ fontFamily: "'Cormorant Garamond', var(--font-display), 'Times New Roman', serif" }}
              >
                {settings.cameraEventTagline}
              </p>
              <p className="mt-1 text-xs font-medium text-white/70 drop-shadow">
                Ends on {cameraEndsText}
              </p>
            </div>
            <div className="absolute right-4 top-40 z-10 overflow-hidden rounded-[1.7rem] border border-white/20 bg-black/45 backdrop-blur-sm">
              <button
                type="button"
                className="flex h-14 w-14 items-center justify-center border-b border-white/15 text-white/95"
                onClick={() => void openQrSheet()}
                aria-label="Open QR share"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                  <path
                    d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm13 2h2v2h-2v-2zm-2-2h2v2h-2v-2zm4 4h2v2h-2v-2zm-4 2h2v2h-2v-2zm4-10h3v3h-3v-3z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="flex h-14 w-14 items-center justify-center text-white/95 disabled:opacity-40"
                onClick={() => void shareCameraLink()}
                disabled={sharing}
                aria-label="Share camera link"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                  <path
                    d="M14 3l7 7-7 7-1.4-1.4 4.6-4.6H8a5 5 0 000 10h3v2H8a7 7 0 010-14h9.2l-4.6-4.6L14 3z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>

            {isGuestNameModalVisible ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 px-6">
                <form
                  className="w-full max-w-xs rounded-2xl border border-white/25 bg-black/85 p-4 backdrop-blur-sm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGuestName(guestNameDraft);
                  }}
                >
                  <p className="text-center text-lg font-semibold text-white">Your name</p>
                  <p className="mt-2 text-center text-xs leading-relaxed text-white/80">
                    We will label your captured photos with this name.
                  </p>
                  <label className="mt-4 block text-xs text-white/75">
                    <span>Guest name</span>
                    <input
                      className={`mt-1 w-full rounded-lg bg-black/45 px-3 py-2 text-sm text-white outline-none placeholder:text-white/45 focus:border-white/50 ${
                        guestNameError ? "border border-rose-400/90" : "border border-white/25"
                      }`}
                      value={guestNameDraft}
                      onChange={(event) => {
                        setGuestNameDraft(event.target.value);
                        if (guestNameError) setGuestNameError("");
                      }}
                      onInvalid={(event) =>
                        event.currentTarget.setCustomValidity("Guest name is required.")
                      }
                      onInput={(event) => event.currentTarget.setCustomValidity("")}
                      placeholder="Enter your name"
                      maxLength={120}
                      required
                      autoFocus
                    />
                  </label>
                  {guestNameError ? (
                    <p className="mt-2 text-xs text-rose-300">{guestNameError}</p>
                  ) : null}
                  <button
                    type="submit"
                    className="mt-4 w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black"
                  >
                    Continue
                  </button>
                </form>
              </div>
            ) : null}

            {showQrSheet ? (
              <div className="absolute inset-0 z-40 flex items-end bg-black/50 p-3">
                <div className="w-full rounded-3xl border border-white/20 bg-[#2c2940] p-4 shadow-2xl backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs text-white"
                      onClick={() => setShowQrSheet(false)}
                    >
                      Close
                    </button>
                    <p className="text-sm font-semibold text-white">Share QR Code</p>
                    <div className="w-12" />
                  </div>
                  <p className="mt-2 text-center text-xs text-white/75">
                    Anyone can join this camera by scanning this QR code.
                  </p>

                  <div className="mt-4 rounded-2xl border border-white/20 bg-white/95 p-4">
                    {qrRendering ? (
                      <div className="flex h-56 items-center justify-center text-sm text-black/70">
                        Rendering QR...
                      </div>
                    ) : qrImageDataUrl ? (
                      <img
                        src={qrImageDataUrl}
                        alt="Guest camera QR code"
                        className="mx-auto h-56 w-56 rounded-xl object-contain"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center text-sm text-black/70">
                        QR unavailable.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="mt-4 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                    onClick={() => void shareCameraLink()}
                    disabled={sharing || !shareableCameraUrl}
                  >
                    {sharing ? "Sharing..." : "Share Link"}
                  </button>
                </div>
              </div>
            ) : null}

            {!cameraOpen ? (
              <div className="absolute inset-x-0 bottom-28 z-10 px-6">
                <button
                  type="button"
                  className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-40"
                  onClick={() => void startCamera()}
                  disabled={!canCaptureMoreShots || cameraTransitioning}
                >
                  {cameraTransitioning ? "Switching..." : "Open Camera"}
                </button>
              </div>
            ) : null}

            <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="w-full">
                {feedback ? (
                  <div className="mb-2 px-1 text-center">
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200/35 bg-black/45 px-2 py-1.5 text-xs text-amber-200">
                      <p className="flex-1 text-left">{feedback}</p>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded border border-amber-200/45 text-[10px] text-amber-200/90 hover:bg-amber-200/10"
                        onClick={() => setFeedback("")}
                        aria-label="Dismiss message"
                        title="Dismiss"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="mb-3 grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  <div className="flex justify-start">
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-black/50 text-white disabled:opacity-40"
                      onClick={() => toggleFlashOption()}
                      disabled={!cameraOpen}
                      aria-label="Toggle flash"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                        <path
                          d="M11 2L5 13h5l-1 9 10-13h-6l2-7h-4z"
                          fill={flashEnabled ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="mx-auto flex w-fit items-center rounded-full border border-white/25 bg-black/45 p-1">
                    {zoomOptions.map((zoom) => (
                      <button
                        key={zoom}
                        type="button"
                        className={`h-9 w-12 rounded-full px-0 text-sm font-semibold ${
                          selectedZoom === zoom
                            ? "bg-white text-black"
                            : "text-white/90"
                        }`}
                        onClick={() => void applyZoomLevel(zoom)}
                        disabled={!cameraOpen || cameraTransitioning}
                      >
                        {zoom}x
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-black/50 text-white disabled:opacity-40"
                      onClick={() => void switchCameraFacing()}
                      disabled={!cameraOpen || cameraTransitioning}
                      aria-label="Flip camera"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                        <path
                          d="M7 7h6l-2-2m2 2l-2 2M17 17h-6l2 2m-2-2l2-2M3 8a5 5 0 015-5h8a5 5 0 015 5v8a5 5 0 01-5 5H8a5 5 0 01-5-5V8z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="relative h-[6.2rem]">
                  <div className="absolute bottom-1 left-0 z-10 flex items-end gap-2 pl-0.5">
                    <p className="text-[3.2rem] font-black italic leading-[0.9] text-white tabular-nums">
                      {usage.shotsLimit > 0 ? (
                        <RollingShotsValue value={effectiveShotsLeft ?? 0} />
                      ) : (
                        "∞"
                      )}
                    </p>
                    <div className="pb-1 leading-none">
                      <p className="text-[14px] font-black uppercase italic tracking-[0.04em] text-white/92">
                        Shots
                      </p>
                      <p className="mt-0.5 text-[8px] font-semibold uppercase italic tracking-[0.13em] text-white/78">
                        Remaining
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="absolute bottom-0 left-1/2 z-20 flex h-[5.4rem] w-[5.4rem] -translate-x-1/2 items-center justify-center rounded-full border-[2px] border-[#8a90ff] bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.35)_inset] disabled:opacity-40"
                    onClick={() => void captureShot()}
                    disabled={!cameraOpen || !canCaptureMoreShots || cameraTransitioning}
                    aria-label="Capture shot"
                  >
                    <span className="h-[4.95rem] w-[4.95rem] rounded-full bg-white" />
                  </button>

                  <div className="absolute bottom-0 right-0 z-10 flex justify-end pr-0.5">
                    <button
                      type="button"
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/25 bg-black/35 shadow-xl"
                      onClick={() => {
                        setShowGallerySheet(true);
                        setShowGalleryLockNotice(true);
                      }}
                      aria-label="Open gallery"
                    >
                      {latestLocalPreviewUrl ? (
                        <img
                          src={latestLocalPreviewUrl}
                          alt="Latest shot preview"
                          className={`h-full w-full object-cover transition duration-300 ${
                            uploading ? "scale-105 blur-[2px] opacity-80" : ""
                          }`}
                        />
                      ) : (
                        <span className="relative inline-flex h-full w-full items-center justify-center"><span className="absolute h-10 w-8 translate-x-2 -translate-y-1 rotate-[12deg] rounded-md border border-white/25 bg-white/10" /><span className="absolute h-10 w-8 -translate-x-2 translate-y-1 rotate-[-9deg] rounded-md border border-white/20 bg-white/5" /><span className="absolute h-10 w-8 rounded-md border border-white/30 bg-white/15" /></span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {showGallerySheet ? (
              <div className="absolute inset-0 z-40 flex h-full flex-col bg-black">
                <div className="relative h-56 overflow-hidden">
                  {featuredGalleryItem?.imageUrl ? (
                    <img
                      src={featuredGalleryItem.imageUrl}
                      alt="Gallery cover"
                      className={`h-full w-full object-cover ${
                        shouldBlurFeaturedGalleryItem ? "blur-md brightness-75" : "brightness-75"
                      }`}
                    />
                  ) : (
                    <div className="h-full w-full bg-[radial-gradient(circle_at_top,_#454545_0%,_#121212_52%,_#060606_100%)]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
                  <div className="absolute inset-x-4 top-4 z-20 flex items-center justify-between">
                    <button
                      type="button"
                      className="rounded-full border border-white/35 bg-black/55 px-3 py-1.5 text-sm text-white shadow-lg"
                      onClick={() => {
                        setShowGallerySheet(false);
                        setExpandedGalleryImage(null);
                        setActiveLocalShotId("");
                        setShowGalleryLockNotice(true);
                      }}
                    >
                      Back
                    </button>
                    <span className="text-xs text-white/80">
                      {filteredGalleryItems.length} photo
                      {filteredGalleryItems.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute inset-x-4 bottom-4">
                    <p className="text-3xl font-semibold text-white drop-shadow">
                      {settings.cameraEventDisplayTitle}
                    </p>
                    <p className="mt-1 text-sm text-white/80">
                      {capturerOptions.length} participant
                      {capturerOptions.length === 1 ? "" : "s"}
                    </p>
                    {galleryUnlockMessage ? (
                      <p className="mt-2 text-xs text-white/75">{galleryUnlockMessage}</p>
                    ) : null}
                    <div className="pointer-events-auto mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-emerald-300/40 bg-emerald-300/20 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40"
                        onClick={() => queueSelectedShotsForUpload()}
                        disabled={selectedForUploadCount < 1}
                      >
                        Upload Selected ({selectedForUploadCount})
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/25 bg-white/20 px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => {
                          setShowGallerySheet(false);
                          setExpandedGalleryImage(null);
                          setActiveLocalShotId("");
                          openUploadPicker();
                        }}
                      >
                        Add From Files
                      </button>
                      {canExportGallery ? (
                        <button
                          type="button"
                          className="rounded-full border border-white/25 bg-white/20 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          onClick={() => void downloadFilteredGallery()}
                          disabled={downloadingGallery || filteredGalleryItems.length === 0}
                        >
                          {downloadingGallery ? "Exporting..." : "Export"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
                  {localShotsNewestFirst.length > 0 ? (
                    <section className="mb-4 rounded-2xl border border-white/20 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">My Upload Queue</p>
                          <p className="text-xs text-white/70">
                            Select only the shots you want to upload.
                          </p>
                        </div>
                        <span className="text-xs text-white/75">
                          {localShotsNewestFirst.length} shot
                          {localShotsNewestFirst.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white"
                          onClick={() =>
                            setLocalShots((current) =>
                              current.map((shot) =>
                                shot.status === "draft" || shot.status === "failed"
                                  ? { ...shot, selected: true }
                                  : shot,
                              ),
                            )
                          }
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white"
                          onClick={() =>
                            setLocalShots((current) =>
                              current.map((shot) =>
                                shot.status === "draft" || shot.status === "failed"
                                  ? { ...shot, selected: false }
                                  : shot,
                              ),
                            )
                          }
                        >
                          Clear Selection
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-rose-300/45 bg-rose-300/15 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-40"
                          onClick={() => retryFailedShots()}
                          disabled={failedShotsCount < 1}
                        >
                          Retry Failed ({failedShotsCount})
                        </button>
                      </div>

                      {pendingUploads > 0 ? (
                        <p className="mt-2 text-xs text-rose-200">
                          Uploading {pendingUploads} shot{pendingUploads === 1 ? "" : "s"} in background.
                          Keep this app open.
                        </p>
                      ) : uploadedShotsCount > 0 && unsentShotsCount < 1 ? (
                        <p className="mt-2 text-xs text-emerald-200">
                          All queued shots uploaded ({uploadedShotsCount} total).
                        </p>
                      ) : null}
                      {uploadBatchTotal > 0 ? (
                        <div className="mt-2 w-full max-w-xs">
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                            <div
                              className="h-full rounded-full bg-emerald-300 transition-all duration-300"
                              style={{ width: `${Math.max(0, Math.min(100, uploadBatchPercent))}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-emerald-200">
                            Uploaded {uploadBatchDone}/{uploadBatchTotal}
                          </p>
                        </div>
                      ) : null}
                      {failedShotsCount > 0 ? (
                        <p className="mt-1 text-xs text-rose-300">
                          {failedShotsCount} shot{failedShotsCount === 1 ? "" : "s"} failed to upload.
                          Tap Retry Failed.
                        </p>
                      ) : null}

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {localShotsNewestFirst.map((shot) => (
                          <article
                            key={shot.id}
                            className="overflow-hidden rounded-xl border border-white/15 bg-black/40"
                          >
                            <button
                              type="button"
                              className="relative block h-24 w-full"
                              onClick={() => setActiveLocalShotId(shot.id)}
                            >
                              <img
                                src={shot.previewUrl}
                                alt="Local queued shot preview"
                                className={`h-full w-full object-cover ${
                                  shot.status === "queued" || shot.status === "uploading"
                                    ? "opacity-70"
                                    : ""
                                }`}
                              />
                              <span
                                className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  shot.selected
                                    ? "bg-lime-300 text-black"
                                    : "bg-black/60 text-white"
                                }`}
                              >
                                {shot.selected ? "Selected" : "Preview"}
                              </span>
                            </button>
                            <div className="flex flex-col items-start gap-0.5 px-2 py-1">
                              <span className="text-[10px] text-white/75">
                                {shot.status === "draft"
                                  ? "Ready"
                                  : shot.status === "queued"
                                  ? "Queued"
                                  : shot.status === "uploading"
                                  ? "Uploading"
                                  : "Failed"}
                              </span>
                              <button
                                type="button"
                                className="text-[10px] text-rose-200 disabled:opacity-40"
                                onClick={() => removeLocalShot(shot.id)}
                                disabled={shot.status === "uploading"}
                              >
                                Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {activeLocalShot ? (
                    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/75 p-4">
                      <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-black/85 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">Shot Preview</p>
                          <button
                            type="button"
                            className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs text-white"
                            onClick={() => setActiveLocalShotId("")}
                          >
                            Close
                          </button>
                        </div>
                        <div className="mt-3 overflow-hidden rounded-xl border border-white/15 bg-black/35">
                          <img
                            src={activeLocalShot.previewUrl}
                            alt="Selected local shot preview"
                            className="h-72 w-full object-contain"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              activeLocalShot.selected
                                ? "border-lime-300/55 bg-lime-300/20 text-lime-100"
                                : "border-white/25 bg-white/10 text-white"
                            }`}
                            onClick={() => toggleLocalShotSelection(activeLocalShot.id)}
                            disabled={
                              activeLocalShot.status === "queued" || activeLocalShot.status === "uploading"
                            }
                          >
                            {activeLocalShot.selected ? "Selected" : "Select this shot"}
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-emerald-300/45 bg-emerald-300/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40"
                            onClick={() => queueSingleShotForUpload(activeLocalShot.id)}
                            disabled={
                              activeLocalShot.status === "queued" || activeLocalShot.status === "uploading"
                            }
                          >
                            Upload this shot
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-rose-300/45 bg-rose-300/15 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-40"
                            onClick={() => removeLocalShot(activeLocalShot.id)}
                            disabled={activeLocalShot.status === "uploading"}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {galleryFilterMode === "capturer" ? (
                    <div className="mb-3">
                      <label className="text-xs text-white/70">Choose a POV</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-white/20 bg-black/45 px-3 py-2 text-sm text-white"
                        value={selectedCapturer}
                        onChange={(event) => setSelectedCapturer(event.target.value)}
                      >
                        <option value="">All POVs</option>
                        {capturerOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {filteredGalleryItems.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-white/70">
                      No photos yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {filteredGalleryItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="overflow-hidden rounded-2xl border border-white/10 bg-black/35"
                          onClick={() =>
                            setExpandedGalleryImage({
                              imageUrl: item.imageUrl,
                              uploaderName: item.uploaderName,
                              createdAt: item.createdAt,
                              blur: isGalleryLockedForViewer,
                            })
                          }
                        >
                          <img
                            src={item.imageUrl}
                            alt={`Photo by ${item.uploaderName}`}
                            className={`h-52 w-full object-cover ${
                              isGalleryLockedForViewer
                                ? "blur-md brightness-75"
                                : ""
                            }`}
                            loading="lazy"
                          />
                          <div className="px-3 py-2">
                            <p className="truncate text-xs text-white/85">{item.uploaderName}</p>
                            <p className="truncate text-[10px] text-white/60">
                              {formatManilaDateTime(item.createdAt)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {expandedGalleryImage ? (
                  <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 p-4">
                    <button
                      type="button"
                      className="absolute right-4 top-4 rounded-full border border-white/35 bg-black/70 px-3 py-1 text-sm text-white"
                      onClick={() => setExpandedGalleryImage(null)}
                    >
                      Close
                    </button>
                    <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/20 bg-black/40">
                      <img
                        src={expandedGalleryImage.imageUrl}
                        alt={`Photo by ${expandedGalleryImage.uploaderName}`}
                        className={`max-h-[75dvh] w-full object-contain ${
                          expandedGalleryImage.blur ? "blur-md brightness-75" : ""
                        }`}
                      />
                      <div className="border-t border-white/15 px-3 py-2 text-xs text-white/80">
                        <p className="truncate">{expandedGalleryImage.uploaderName}</p>
                        <p className="truncate text-white/60">
                          {formatManilaDateTime(expandedGalleryImage.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isGalleryLockedForViewer && showGalleryLockNotice ? (
                  <div className="absolute inset-x-4 bottom-20 z-50">
                    <div className="rounded-2xl border border-white/20 bg-black/75 px-4 py-3 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">Photos are developing!</p>
                          <p className="mt-1 text-xs text-white/75">
                            It will be reveal at {galleryRevealAtText}.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-xs text-white"
                          onClick={() => setShowGalleryLockNotice(false)}
                          aria-label="Close gallery lock notice"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 border-t border-white/10 bg-black/90 px-2 py-2 text-sm">
                  <button
                    type="button"
                    className={`rounded-xl px-2 py-2 ${
                      galleryFilterMode === "all"
                        ? "text-lime-300 underline decoration-2 underline-offset-4"
                        : "text-white/70"
                    }`}
                    onClick={() => setGalleryFilterMode("all")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`rounded-xl px-2 py-2 ${
                      galleryFilterMode === "mine"
                        ? "text-lime-300 underline decoration-2 underline-offset-4"
                        : "text-white/70"
                    }`}
                    onClick={() => setGalleryFilterMode("mine")}
                  >
                    My POV
                  </button>
                  <button
                    type="button"
                    className={`rounded-xl px-2 py-2 ${
                      galleryFilterMode === "capturer"
                        ? "text-lime-300 underline decoration-2 underline-offset-4"
                        : "text-white/70"
                    }`}
                    onClick={() => setGalleryFilterMode("capturer")}
                  >
                    Choose a POV
                  </button>
                </div>
              </div>
            ) : null}

            <canvas ref={canvasRef} className="hidden" />
            <input
              ref={uploadPickerRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onUploadPickerChange}
            />
          </section>

        </div>
      )}
    </main>
  );
}






