export type GuestRow = {
  rowNumber: number;
  id: string;
  inviteCode: string;
  inviteToken: string;
  fullName: string;
  email: string;
  maxGuests: number;
  status: string;
  lastUpdated: string;
  notes: string;
};

export type RsvpRow = {
  rowNumber: number;
  timestamp: string;
  inviteCode: string;
  fullName: string;
  email: string;
  attendance: string;
  guestCount: number;
  dietaryRestrictions: string;
  songRequest: string;
  message: string;
  companionNames: string;
  source: string;
};

export type CameraPhotoStatus = "pending" | "approved" | "hidden" | "rejected";

export type CameraPhotoRow = {
  rowNumber: number;
  id: string;
  createdAt: string;
  inviteCode: string;
  uploaderName: string;
  driveFileId: string;
  previewDriveFileId: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  status: CameraPhotoStatus;
  visibilityAt: string;
  rejectionReason: string;
  hiddenAt: string;
};

export type EntourageSide = "bride" | "groom" | "none";

export type EntourageCategoryRow = {
  rowNumber: number;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EntourageMemberRow = {
  rowNumber: number;
  id: string;
  categoryId: string;
  fullName: string;
  side: EntourageSide;
  memberOrder: number;
  isVisible: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeNumber(value: string | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value: string | undefined, fallback = true) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeEntourageSide(value: string | undefined): EntourageSide {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "bride") return "bride";
  if (normalized === "groom") return "groom";
  return "none";
}

function normalizeCameraPhotoStatus(value: string | undefined): CameraPhotoStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "hidden") return "hidden";
  if (normalized === "rejected") return "rejected";
  return "pending";
}

function cell(row: string[], index: number) {
  return row[index] ?? "";
}

function looksLikeInviteToken(value: string) {
  return /^[a-f0-9]{32}$/i.test((value ?? "").trim());
}

export function toGuestRow(row: string[], rowNumber: number): GuestRow {
  const col2 = cell(row, 2);
  const isNewFormat = looksLikeInviteToken(col2);

  if (!isNewFormat) {
    // Legacy format (without inviteToken column):
    // id, inviteCode, fullName, email, maxGuests, status, lastUpdated, notes
    return {
      rowNumber,
      id: cell(row, 0),
      inviteCode: cell(row, 1),
      inviteToken: "",
      fullName: cell(row, 2),
      email: cell(row, 3),
      maxGuests: normalizeNumber(cell(row, 4), 1),
      status: cell(row, 5) || "pending",
      lastUpdated: cell(row, 6),
      notes: cell(row, 7),
    };
  }

  return {
    rowNumber,
    id: cell(row, 0),
    inviteCode: cell(row, 1),
    inviteToken: cell(row, 2),
    fullName: cell(row, 3),
    email: cell(row, 4),
    maxGuests: normalizeNumber(cell(row, 5), 1),
    status: cell(row, 6) || "pending",
    lastUpdated: cell(row, 7),
    notes: cell(row, 8),
  };
}

export function toRsvpRow(row: string[], rowNumber: number): RsvpRow {
  // Current format (without dietary/song):
  // timestamp,inviteCode,fullName,email,attendance,guestCount,message,companionNames,source
  // Previous format:
  // timestamp,inviteCode,fullName,email,attendance,guestCount,dietaryRestrictions,songRequest,message,companionNames,source
  // Legacy format:
  // timestamp,inviteCode,fullName,email,attendance,guestCount,dietaryRestrictions,songRequest,message,source
  const hasDietaryAndSongColumns = row.length >= 10;
  const hasCompanionColumn = row.length >= 11 || (!hasDietaryAndSongColumns && row.length >= 9);

  return {
    rowNumber,
    timestamp: cell(row, 0),
    inviteCode: cell(row, 1),
    fullName: cell(row, 2),
    email: cell(row, 3),
    attendance: cell(row, 4),
    guestCount: normalizeNumber(cell(row, 5), 0),
    dietaryRestrictions: hasDietaryAndSongColumns ? cell(row, 6) : "",
    songRequest: hasDietaryAndSongColumns ? cell(row, 7) : "",
    message: hasDietaryAndSongColumns ? cell(row, 8) : cell(row, 6),
    companionNames: hasCompanionColumn
      ? hasDietaryAndSongColumns
        ? cell(row, 9)
        : cell(row, 7)
      : "",
    source: hasCompanionColumn
      ? hasDietaryAndSongColumns
        ? cell(row, 10)
        : cell(row, 8)
      : hasDietaryAndSongColumns
        ? cell(row, 9)
        : "",
  };
}

export function toCameraPhotoRow(row: string[], rowNumber: number): CameraPhotoRow {
  return {
    rowNumber,
    id: cell(row, 0),
    createdAt: cell(row, 1),
    inviteCode: cell(row, 2),
    uploaderName: cell(row, 3),
    driveFileId: cell(row, 4),
    previewDriveFileId: cell(row, 5),
    mimeType: cell(row, 6),
    fileSizeBytes: normalizeNumber(cell(row, 7), 0),
    width: normalizeNumber(cell(row, 8), 0),
    height: normalizeNumber(cell(row, 9), 0),
    status: normalizeCameraPhotoStatus(cell(row, 10)),
    visibilityAt: cell(row, 11),
    rejectionReason: cell(row, 12),
    hiddenAt: cell(row, 13),
  };
}

export function guestToArray(guest: Omit<GuestRow, "rowNumber">): string[] {
  return [
    guest.id,
    guest.inviteCode,
    guest.inviteToken,
    guest.fullName,
    guest.email,
    String(guest.maxGuests),
    guest.status,
    guest.lastUpdated,
    guest.notes,
  ];
}

export function cameraPhotoToArray(photo: Omit<CameraPhotoRow, "rowNumber">): string[] {
  return [
    photo.id,
    photo.createdAt,
    photo.inviteCode,
    photo.uploaderName,
    photo.driveFileId,
    photo.previewDriveFileId,
    photo.mimeType,
    String(photo.fileSizeBytes),
    String(photo.width),
    String(photo.height),
    photo.status,
    photo.visibilityAt,
    photo.rejectionReason,
    photo.hiddenAt,
  ];
}

export function toEntourageCategoryRow(
  row: string[],
  rowNumber: number,
): EntourageCategoryRow {
  return {
    rowNumber,
    id: cell(row, 0),
    name: cell(row, 1),
    slug: cell(row, 2),
    sortOrder: normalizeNumber(cell(row, 3), 0),
    isVisible: normalizeBoolean(cell(row, 4), true),
    createdAt: cell(row, 5),
    updatedAt: cell(row, 6),
  };
}

export function toEntourageMemberRow(
  row: string[],
  rowNumber: number,
): EntourageMemberRow {
  return {
    rowNumber,
    id: cell(row, 0),
    categoryId: cell(row, 1),
    fullName: cell(row, 2),
    side: normalizeEntourageSide(cell(row, 3)),
    memberOrder: normalizeNumber(cell(row, 4), 0),
    isVisible: normalizeBoolean(cell(row, 5), true),
    notes: cell(row, 6),
    createdAt: cell(row, 7),
    updatedAt: cell(row, 8),
  };
}

export function entourageCategoryToArray(
  category: Omit<EntourageCategoryRow, "rowNumber">,
): string[] {
  return [
    category.id,
    category.name,
    category.slug,
    String(category.sortOrder),
    category.isVisible ? "TRUE" : "FALSE",
    category.createdAt,
    category.updatedAt,
  ];
}

export function entourageMemberToArray(
  member: Omit<EntourageMemberRow, "rowNumber">,
): string[] {
  return [
    member.id,
    member.categoryId,
    member.fullName,
    member.side,
    String(member.memberOrder),
    member.isVisible ? "TRUE" : "FALSE",
    member.notes,
    member.createdAt,
    member.updatedAt,
  ];
}
