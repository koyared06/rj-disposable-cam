import { NextRequest, NextResponse } from "next/server";
import {
  resolveCameraDriveFolders,
  uploadImageToDrive,
} from "@/lib/drive-camera";
import { validateAdmin } from "@/lib/admin-auth";
import { buildCameraCoverUrl } from "@/lib/camera-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildDriveFileName(extension: string) {
  const stamp = Date.now();
  return `camera-cover-${stamp}.${extension}`;
}

function getImageExtension(file: File) {
  const mime = file.type.toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/avif") return "avif";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return "jpg";
}

function classifyError(error: unknown) {
  const responseStatus = Number(
    (error as { response?: { status?: number } } | null)?.response?.status ?? 0,
  );

  if (responseStatus === 403) {
    return {
      hint: "Permission denied on Drive folder/file. Grant service account Editor access.",
    };
  }

  return {
    hint: "Check Drive folder permissions and API logs.",
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are allowed." }, { status: 400 });
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size <= 0 || file.size > maxBytes) {
      return NextResponse.json(
        { error: "Landing cover image must be 1 byte to 10 MB." },
        { status: 400 },
      );
    }

    const driveFolders = await resolveCameraDriveFolders();
    const extension = getImageExtension(file);
    const fileName = buildDriveFileName(extension);
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploaded = await uploadImageToDrive({
      buffer,
      fileName,
      mimeType: file.type || "image/jpeg",
      parentFolderId: driveFolders.previewsFolderId,
    });
    const url = buildCameraCoverUrl(request.nextUrl.origin, uploaded.fileId);

    return NextResponse.json({
      ok: true,
      cover: {
        fileId: uploaded.fileId,
        url,
      },
    });
  } catch (error) {
    console.error("Admin camera cover upload error:", error);
    const details = error instanceof Error ? error.message : "Unknown cover upload error.";
    const classified = classifyError(error);
    return NextResponse.json(
      {
        error: "Unable to upload landing cover image right now.",
        hint: classified.hint,
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
