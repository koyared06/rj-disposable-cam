import { NextRequest, NextResponse } from "next/server";
import { downloadDriveFile } from "@/lib/drive-camera";
import { verifyCameraCoverSignature } from "@/lib/camera-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectImageMimeType(bytes: Buffer) {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }
  }

  if (bytes.length >= 3) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
  }

  if (bytes.length >= 6) {
    const ascii = bytes.subarray(0, 6).toString("ascii");
    if (ascii === "GIF87a" || ascii === "GIF89a") {
      return "image/gif";
    }
  }

  if (bytes.length >= 12) {
    const riff = bytes.subarray(0, 4).toString("ascii");
    const webp = bytes.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }

  if (bytes.length >= 12) {
    const ftyp = bytes.subarray(4, 8).toString("ascii");
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (ftyp === "ftyp" && (brand === "avif" || brand === "avis")) {
      return "image/avif";
    }
  }

  return "application/octet-stream";
}

export async function GET(request: NextRequest) {
  try {
    const fileId = (request.nextUrl.searchParams.get("id") ?? "").trim();
    const signature = (request.nextUrl.searchParams.get("sig") ?? "").trim();

    if (!fileId || !signature) {
      return NextResponse.json({ error: "Missing cover image parameters." }, { status: 400 });
    }

    if (!verifyCameraCoverSignature(fileId, signature)) {
      return NextResponse.json({ error: "Invalid cover image signature." }, { status: 401 });
    }

    const bytes = await downloadDriveFile(fileId);
    const mimeType = detectImageMimeType(bytes);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Camera cover fetch error:", error);
    const details = error instanceof Error ? error.message : "Unknown cover fetch error.";
    return NextResponse.json(
      {
        error: "Unable to load landing cover image right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

