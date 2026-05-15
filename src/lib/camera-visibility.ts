import type { CameraPhotoRow } from "@/lib/sheet-models";
import type { WeddingSettings } from "@/lib/wedding-settings";

const MANILA_UTC_OFFSET = "+08:00";

export function resolveCameraVisibilityAt(settings: WeddingSettings, nowIso: string) {
  const unlockDate = settings.cameraGalleryUnlockDate.trim();
  const unlockTime = settings.cameraGalleryUnlockTime.trim() || "00:00";

  if (!unlockDate) return nowIso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(unlockDate)) return nowIso;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(unlockTime)) return nowIso;

  const parsed = new Date(`${unlockDate}T${unlockTime}:00${MANILA_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return nowIso;
  return parsed.toISOString();
}

export function isPhotoVisibleNow(photo: CameraPhotoRow, now: Date) {
  if (photo.status !== "approved") return false;
  if (!photo.visibilityAt) return true;

  const visibleAt = new Date(photo.visibilityAt);
  if (Number.isNaN(visibleAt.getTime())) return true;
  return now.getTime() >= visibleAt.getTime();
}
