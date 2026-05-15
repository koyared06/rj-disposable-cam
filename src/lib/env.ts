type RequiredEnvKey =
  | "GOOGLE_SERVICE_ACCOUNT_EMAIL"
  | "GOOGLE_PRIVATE_KEY"
  | "GOOGLE_SHEETS_SPREADSHEET_ID";

function getRequiredEnv(name: RequiredEnvKey): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSheetsEnv() {
  return {
    serviceAccountEmail: getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    spreadsheetId: getRequiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
  };
}

export function getGuestsSheetName() {
  return process.env.GOOGLE_SHEETS_GUESTS_TAB ?? "Guests";
}

export function getRsvpsSheetName() {
  return process.env.GOOGLE_SHEETS_RSVPS_TAB ?? "RSVPs";
}

export function getSettingsSheetName() {
  return process.env.GOOGLE_SHEETS_SETTINGS_TAB ?? "Settings";
}

export function getEntourageCategoriesSheetName() {
  return process.env.GOOGLE_SHEETS_ENTOURAGE_CATEGORIES_TAB ?? "EntourageCategories";
}

export function getEntourageMembersSheetName() {
  return process.env.GOOGLE_SHEETS_ENTOURAGE_MEMBERS_TAB ?? "EntourageMembers";
}

export function getCameraPhotosSheetName() {
  return process.env.GOOGLE_SHEETS_CAMERA_PHOTOS_TAB ?? "CameraPhotos";
}

export function getDriveCameraEnv() {
  const primaryCameraFolderId = (process.env.GOOGLE_DRIVE_CAMERA_FOLDER_ID ?? "").trim();
  const legacyCameraFolderId = (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();

  return {
    folderId: primaryCameraFolderId || legacyCameraFolderId,
    sharedDriveId: (process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? "").trim(),
    originalsFolderName:
      (process.env.GOOGLE_DRIVE_CAMERA_ORIGINALS_FOLDER_NAME ?? "").trim() || "originals",
    previewsFolderName:
      (process.env.GOOGLE_DRIVE_CAMERA_PREVIEWS_FOLDER_NAME ?? "").trim() || "previews",
    watermarkLine1: (process.env.CAMERA_WATERMARK_LINE_1 ?? "").trim() || "Red & Jess",
    watermarkLine2:
      (process.env.CAMERA_WATERMARK_LINE_2 ?? "").trim() || "#soaferRED-ynasiJESS",
  };
}
