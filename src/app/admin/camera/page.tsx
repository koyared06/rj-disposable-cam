"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

const ADMIN_SESSION_KEY = "rj_admin_session_v1";
const COVER_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const COVER_UPLOAD_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const COVER_UPLOAD_MAX_DIMENSION = 2048;
const COVER_JPEG_QUALITIES = [0.88, 0.8, 0.72, 0.64] as const;

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
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthReportJson, setHealthReportJson] = useState("");
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

  useEffect(() => {
    return () => {
      if (coverPreviewObjectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(coverPreviewObjectUrl);
      }
    };
  }, [coverPreviewObjectUrl]);

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

        const settingsResponse = settingsResult.response;
        const settingsPayload = settingsResult.payload as JsonRecord;
        const photosResponse = photosResult.response;
        const photosPayload = photosResult.payload as JsonRecord;

        if (settingsResponse.status === 401 || photosResponse.status === 401) {
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

        setSettings({
          cameraEnabled: Boolean((settingsPayload.settings as JsonRecord | undefined)?.cameraEnabled),
          cameraRequireApproval: Boolean(
            (settingsPayload.settings as JsonRecord | undefined)?.cameraRequireApproval,
          ),
          cameraGalleryUnlockDate:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraGalleryUnlockDate as
              | string
              | undefined) ?? "",
          cameraGalleryUnlockTime:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraGalleryUnlockTime as
              | string
              | undefined) ?? "",
          cameraMaxUploadMb: Number(
            (settingsPayload.settings as JsonRecord | undefined)?.cameraMaxUploadMb ?? 3,
          ),
          cameraShotLimitPerInvite: Number(
            (settingsPayload.settings as JsonRecord | undefined)?.cameraShotLimitPerInvite ?? 27,
          ),
          cameraLandingEnabled:
            typeof (settingsPayload.settings as JsonRecord | undefined)?.cameraLandingEnabled ===
            "boolean"
              ? Boolean(
                  (settingsPayload.settings as JsonRecord | undefined)?.cameraLandingEnabled,
                )
              : true,
          cameraEventTitle:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraEventTitle as
              | string
              | undefined) ?? "Guest Camera",
          cameraEventSubtitle:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraEventSubtitle as
              | string
              | undefined) ??
            "Capture moments from our celebration.",
          cameraCoverImageUrl:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraCoverImageUrl as
              | string
              | undefined) ?? "",
          cameraStartButtonLabel:
            ((settingsPayload.settings as JsonRecord | undefined)?.cameraStartButtonLabel as
              | string
              | undefined) ?? "Start Camera",
          countdownDays:
            typeof (settingsPayload.settings as JsonRecord | undefined)?.countdownDays === "number"
              ? Number(
                  (settingsPayload.settings as JsonRecord | undefined)?.countdownDays ?? 0,
                )
              : null,
        });

        setCameraPhotos(Array.isArray(photosPayload.items) ? (photosPayload.items as CameraPhotoItem[]) : []);

        const attemptsUsed = Math.max(settingsResult.attempts, photosResult.attempts);
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
    [],
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

  async function generateCameraQr() {
    if (!token) return;
    setQrGenerating(true);
    try {
      const response = await fetch("/api/admin/camera/qr", {
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
      });

      const payload = await response.json();
      if (!response.ok) {
        const details = payload.details ? ` (${payload.details})` : "";
        toast.error("QR generation failed", {
          description: `${payload.error ?? "Unable to generate QR."}${details}`,
        });
        return;
      }

      const generatedUrl = payload.qr?.url ?? "";
      setQrUrl(generatedUrl);
      const qrDataUrl = await QRCode.toDataURL(generatedUrl, {
        width: 520,
        margin: 1,
      });
      setQrImageDataUrl(qrDataUrl);
      toast.success("QR generated", {
        description: `Session code: ${(payload.qr?.tableCode ?? qrTableCode) || "GENERAL"}`,
      });
    } catch {
      toast.error("Network error", {
        description: "Unable to generate QR right now.",
      });
    } finally {
      setQrGenerating(false);
    }
  }

  async function copyQrUrl() {
    if (!qrUrl) return;
    try {
      await navigator.clipboard.writeText(qrUrl);
      toast.success("Copied", { description: "Guest camera link copied." });
    } catch {
      toast.error("Copy failed", { description: "Please copy the link manually." });
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

            {qrUrl ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <p className="text-xs uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                    Guest Camera URL
                  </p>
                  <p className="mt-2 break-all text-xs text-[var(--ink-deep)]">{qrUrl}</p>
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
            {cameraPhotos.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-soft)]">
                No camera uploads yet.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cameraPhotos.map((photo) => (
                  <article
                    key={photo.id}
                    className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
                  >
                    <img
                      src={photo.imageUrl}
                      alt={`Camera upload by ${photo.uploaderName}`}
                      className="h-44 w-full object-cover"
                      loading="lazy"
                    />
                    <div className="space-y-2 px-3 py-3">
                      <p className="text-sm font-semibold text-[var(--ink-deep)]">
                        {photo.uploaderName}
                      </p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        Invite: {photo.inviteCode || "-"}
                      </p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        Uploaded: {formatTimestamp(photo.createdAt)}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                          {photo.status}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-[var(--success-border)] bg-[var(--success-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--success-text)] disabled:opacity-50"
                            onClick={() => void moderatePhoto(photo.id, "approve")}
                            disabled={cameraActionLoadingId === photo.id}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--warn-text)] disabled:opacity-50"
                            onClick={() => void moderatePhoto(photo.id, "hide")}
                            disabled={cameraActionLoadingId === photo.id}
                          >
                            Hide
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--error-border)] bg-[var(--error-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--error-text)] disabled:opacity-50"
                            onClick={() => void moderatePhoto(photo.id, "reject")}
                            disabled={cameraActionLoadingId === photo.id}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
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
