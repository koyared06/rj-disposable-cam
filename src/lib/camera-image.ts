import sharp from "sharp";

type WatermarkOptions = {
  line1: string;
  line2: string;
  capturedBy?: string;
};

export type CameraImageProcessingResult = {
  originalBuffer: Buffer;
  previewBuffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeWatermarkText(value: string, fallback: string, maxLength: number) {
  const cleaned = value.trim();
  const text = cleaned || fallback;
  return text.slice(0, maxLength);
}

function buildWatermarkSvg(width: number, height: number, options: WatermarkOptions) {
  // Keep overlay dimensions <= source image to avoid Sharp composite failures.
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const base = Math.max(12, Math.round(Math.min(safeWidth, safeHeight) * 0.03));
  const pad = Math.max(10, Math.round(base * 0.8));
  const radius = Math.max(8, Math.round(base * 0.7));

  const leftLine1 = escapeXml(normalizeWatermarkText(options.line1, "Red & Jess", 48));
  const leftLine2 = escapeXml(normalizeWatermarkText(options.line2, "#soaferRED-ynasiJESS", 72));
  const capturedByName = normalizeWatermarkText(options.capturedBy ?? "", "Guest", 48);
  const capturedByLabel = escapeXml(`Captured by: ${capturedByName}`);

  const leftLine1Size = Math.max(16, Math.round(base * 1.05));
  const leftLine2Size = Math.max(12, Math.round(base * 0.72));
  const leftGap = Math.max(4, Math.round(base * 0.35));
  const leftBoxHeight = pad * 2 + leftLine1Size + leftLine2Size + leftGap;
  const leftBoxWidth = Math.min(
    Math.round(safeWidth * 0.64),
    Math.max(170, Math.round(safeWidth * 0.48)),
  );
  const leftBoxX = pad;
  const leftBoxY = safeHeight - leftBoxHeight - pad;
  const leftTextX = leftBoxX + pad;
  const leftLine1Y = leftBoxY + pad + leftLine1Size;
  const leftLine2Y = leftLine1Y + leftGap + leftLine2Size;

  const rightTextSize = Math.max(10, Math.round(base * 0.62));
  const rightBoxHeight = pad * 2 + rightTextSize;
  const rightBoxWidth = Math.min(
    Math.round(safeWidth * 0.52),
    Math.max(160, Math.round(capturedByLabel.length * rightTextSize * 0.45) + pad * 2),
  );
  const rightBoxX = safeWidth - rightBoxWidth - pad;
  const rightBoxY = safeHeight - rightBoxHeight - pad;
  const rightTextX = safeWidth - pad * 2;
  const rightTextY = rightBoxY + pad + rightTextSize;

  return `
<svg width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${leftBoxX}" y="${leftBoxY}" width="${leftBoxWidth}" height="${leftBoxHeight}" rx="${radius}" fill="rgba(0,0,0,0.46)" />
  <text x="${leftTextX}" y="${leftLine1Y}" fill="rgba(255,255,255,0.98)" font-size="${leftLine1Size}" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="0.2">${leftLine1}</text>
  <text x="${leftTextX}" y="${leftLine2Y}" fill="rgba(255,255,255,0.90)" font-size="${leftLine2Size}" font-family="Arial, Helvetica, sans-serif" font-weight="500" letter-spacing="0.1">${leftLine2}</text>
  <rect x="${rightBoxX}" y="${rightBoxY}" width="${rightBoxWidth}" height="${rightBoxHeight}" rx="${radius}" fill="rgba(0,0,0,0.46)" />
  <text x="${rightTextX}" y="${rightTextY}" text-anchor="end" fill="rgba(255,255,255,0.95)" font-size="${rightTextSize}" font-family="Arial, Helvetica, sans-serif" font-weight="600" letter-spacing="0.08">${capturedByLabel}</text>
</svg>`;
}

export async function processCameraImage(
  sourceBuffer: Buffer,
  options: WatermarkOptions,
): Promise<CameraImageProcessingResult> {
  try {
    const meta = await sharp(sourceBuffer).rotate().metadata();
    const width = meta.width ?? 1200;
    const height = meta.height ?? 1600;

    const watermarkSvg = buildWatermarkSvg(width, height, options);
    const watermarkedOriginal = await sharp(sourceBuffer)
      .rotate()
      .composite([{ input: Buffer.from(watermarkSvg), top: 0, left: 0 }])
      .jpeg({ quality: 94, mozjpeg: true })
      .toBuffer();

    const previewMaxWidth = 1280;
    const watermarkedPreview = await sharp(watermarkedOriginal)
      .resize({ width: previewMaxWidth, withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    const outputMeta = await sharp(watermarkedOriginal).metadata();

    return {
      originalBuffer: watermarkedOriginal,
      previewBuffer: watermarkedPreview,
      mimeType: "image/jpeg",
      extension: "jpg",
      width: outputMeta.width ?? width,
      height: outputMeta.height ?? height,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    throw new Error(`CAMERA_WATERMARK_PROCESSING_FAILED: ${message}`);
  }
}
