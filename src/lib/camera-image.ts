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

export async function processCameraImage(
  sourceBuffer: Buffer,
  _options: WatermarkOptions,
): Promise<CameraImageProcessingResult> {
  try {
    void _options;
    const meta = await sharp(sourceBuffer).rotate().metadata();
    const width = meta.width ?? 1200;
    const height = meta.height ?? 1600;

    const originalImage = await sharp(sourceBuffer)
      .rotate()
      .jpeg({ quality: 94, mozjpeg: true })
      .toBuffer();

    const previewMaxWidth = 1280;
    const previewImage = await sharp(originalImage)
      .resize({ width: previewMaxWidth, withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    const outputMeta = await sharp(originalImage).metadata();

    return {
      originalBuffer: originalImage,
      previewBuffer: previewImage,
      mimeType: "image/jpeg",
      extension: "jpg",
      width: outputMeta.width ?? width,
      height: outputMeta.height ?? height,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    throw new Error(`CAMERA_IMAGE_PROCESSING_FAILED: ${message}`);
  }
}
