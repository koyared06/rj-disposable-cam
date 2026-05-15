import { NextRequest, NextResponse } from "next/server";
import { validateAdmin } from "@/lib/admin-auth";
import { ensureCameraPhotosSheet } from "@/lib/camera-photos";
import { getDriveFileMetadata, resolveCameraDriveFolders } from "@/lib/drive-camera";
import { getDriveCameraEnv, getSettingsSheetName, getSheetsEnv } from "@/lib/env";
import { readRows } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!validateAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checks: {},
    ok: false,
  };

  const checks = report.checks as Record<string, unknown>;

  try {
    const driveEnv = getDriveCameraEnv();
    let sheetsEnvOk = false;
    try {
      const sheetsEnv = getSheetsEnv();
      sheetsEnvOk = Boolean(
        sheetsEnv.serviceAccountEmail && sheetsEnv.privateKey && sheetsEnv.spreadsheetId,
      );
      checks.env = {
        ok:
          sheetsEnvOk &&
          Boolean(driveEnv.folderId) &&
          Boolean(driveEnv.originalsFolderName) &&
          Boolean(driveEnv.previewsFolderName),
        hasGoogleServiceAccountEmail: Boolean(sheetsEnv.serviceAccountEmail),
        hasGooglePrivateKey: Boolean(sheetsEnv.privateKey),
        hasGoogleSpreadsheetId: Boolean(sheetsEnv.spreadsheetId),
        hasGoogleDriveCameraFolderId: Boolean(driveEnv.folderId),
        hasGoogleDriveSharedDriveId: Boolean(driveEnv.sharedDriveId),
        hasLegacyGoogleDriveFolderId: Boolean(
          (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim(),
        ),
      };
    } catch (error) {
      checks.env = {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to read env values.",
      };
    }

    if (driveEnv.folderId) {
      try {
        const rootMeta = await getDriveFileMetadata(driveEnv.folderId);
        checks.driveRootFolder = {
          ok: true,
          id: rootMeta.fileId,
          name: rootMeta.name,
          mimeType: rootMeta.mimeType,
        };
      } catch (error) {
        checks.driveRootFolder = {
          ok: false,
          error: error instanceof Error ? error.message : "Drive root folder check failed.",
        };
      }

      try {
        const folders = await resolveCameraDriveFolders();
        checks.driveSubfolders = {
          ok: true,
          originalsFolderId: folders.originalsFolderId,
          previewsFolderId: folders.previewsFolderId,
        };
      } catch (error) {
        checks.driveSubfolders = {
          ok: false,
          error: error instanceof Error ? error.message : "Drive subfolder resolution failed.",
        };
      }
    } else {
      checks.driveRootFolder = {
        ok: false,
        error: "Missing GOOGLE_DRIVE_CAMERA_FOLDER_ID (or GOOGLE_DRIVE_FOLDER_ID alias).",
      };
    }

    if (sheetsEnvOk) {
      try {
        const sample = await readRows(`${getSettingsSheetName()}!A1:B2`);
        checks.sheetsRead = {
          ok: true,
          settingsSampleRows: sample.length,
        };
      } catch (error) {
        checks.sheetsRead = {
          ok: false,
          error: error instanceof Error ? error.message : "Sheets read check failed.",
        };
      }

      try {
        await ensureCameraPhotosSheet();
        checks.sheetsCameraPhotos = {
          ok: true,
        };
      } catch (error) {
        checks.sheetsCameraPhotos = {
          ok: false,
          error: error instanceof Error ? error.message : "CameraPhotos sheet check failed.",
        };
      }
    } else {
      checks.sheetsRead = {
        ok: false,
        error: "Sheets env missing.",
      };
      checks.sheetsCameraPhotos = {
        ok: false,
        error: "Sheets env missing.",
      };
    }

    const checkEntries = Object.values(checks).filter(
      (value): value is { ok?: boolean } => Boolean(value && typeof value === "object"),
    );
    const allOk = checkEntries.every((value) => value.ok !== false);
    report.ok = allOk;

    return NextResponse.json(report);
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown camera health check error.";
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to run camera health check.",
        details,
      },
      { status: 500 },
    );
  }
}

