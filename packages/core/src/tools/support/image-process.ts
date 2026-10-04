import { convertImageBytesToPng } from "./image-convert.ts";
import { type ImageResizeOptions, resizeImage } from "./image-resize.ts";

export interface ProcessImageOptions {
  /** Whether to resize images to inline provider limits. Default: true */
  autoResizeImages?: boolean;
  /** Optional resize overrides. Uses resizeImage defaults when omitted. */
  resizeOptions?: ImageResizeOptions;
}

export type ProcessImageResult =
  | {
      ok: true;
      data: string;
      mimeType: string;
    }
  | {
      ok: false;
      message: string;
    };

interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: string;
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function normalizeSupportedImageMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case "image/png":
      return "image/png";
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

async function normalizeImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<NormalizedImage | null> {
  const normalizedMimeType = normalizeSupportedImageMimeType(mimeType);
  if (normalizedMimeType) {
    return { bytes, mimeType: normalizedMimeType };
  }

  const pngBytes = await convertImageBytesToPng(bytes);
  if (!pngBytes) {
    return null;
  }

  return {
    bytes: pngBytes,
    mimeType: "image/png",
  };
}

export async function processImage(
  bytes: Uint8Array,
  mimeType: string,
  options?: ProcessImageOptions,
): Promise<ProcessImageResult> {
  const autoResizeImages = options?.autoResizeImages ?? true;
  const normalized = await normalizeImage(bytes, mimeType);
  if (!normalized) {
    return {
      ok: false,
      message: "[Image omitted: could not be converted to a supported inline image format.]",
    };
  }

  if (autoResizeImages) {
    const resized = await resizeImage(
      normalized.bytes,
      normalized.mimeType,
      options?.resizeOptions,
    );
    if (!resized) {
      return {
        ok: false,
        message: "[Image omitted: could not be resized below the inline image size limit.]",
      };
    }

    return {
      ok: true,
      data: resized.data,
      mimeType: resized.mimeType,
    };
  }

  return {
    ok: true,
    data: Buffer.from(normalized.bytes).toString("base64"),
    mimeType: normalized.mimeType,
  };
}
