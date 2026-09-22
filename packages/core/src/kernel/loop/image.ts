/**
 * One image pipeline for every payload that enters history: `read`
 * attachments, tool results from plugins and MCP bridges, and images the user
 * attaches in a client. An oversized image makes the provider reject the whole
 * conversation, not just the turn that carried it, so images are converted and
 * bounded once, as they arrive.
 *
 * Ported from pi's image-process/image-resize-core pair.
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/utils/image-process.ts
 */
import { PhotonImage, SamplingFilter, fliph, flipv, resize, rotate } from "@cf-wasm/photon/node";
import exifr from "exifr";
import type { ImageContent, TextContent } from "@nyte-ai/schema";

export interface ImageLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Budget for the base64 payload, not the raw bytes. */
  readonly maxBase64Bytes: number;
}

/** Pi's bounds: 2,000px per side and 4.5 MiB of base64, below Anthropic's 5 MiB limit. */
export const IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBase64Bytes: 4.5 * 1024 * 1024,
};

/** PNG first keeps screenshots lossless; JPEG quality drops before dimensions do. */
const JPEG_QUALITIES: readonly number[] = [80, 70, 55, 40];

export type ProcessedImage =
  | {
      readonly kind: "image";
      readonly data: string;
      readonly mimeType: string;
      readonly hints: readonly string[];
    }
  | { readonly kind: "omitted"; readonly message: string };

const SUPPORTED_MIME_TYPES = new Map<string, string>([
  ["image/png", "image/png"],
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/gif", "image/gif"],
  ["image/webp", "image/webp"],
]);

function supportedMimeType(mimeType: string): string | undefined {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();

  return SUPPORTED_MIME_TYPES.get(base);
}

interface Candidate {
  readonly data: string;
  readonly mimeType: string;
}

function encodeCandidates(image: PhotonImage, width: number, height: number): Candidate[] {
  const resized = resize(image, width, height, SamplingFilter.Lanczos3);

  try {
    return [
      { data: Buffer.from(resized.get_bytes()).toString("base64"), mimeType: "image/png" },
      ...JPEG_QUALITIES.map((quality) => ({
        data: Buffer.from(resized.get_bytes_jpeg(quality)).toString("base64"),
        mimeType: "image/jpeg",
      })),
    ];
  } finally {
    resized.free();
  }
}

/**
 * Re-encoding drops EXIF, so bake the orientation into the pixels first.
 * Returns the oriented image, which may be the input itself.
 */
async function orient(image: PhotonImage, bytes: Uint8Array): Promise<PhotonImage> {
  const orientation = await exifr.orientation(Buffer.from(bytes)).catch(() => undefined);

  if (orientation === undefined || orientation === 1) return image;
  let oriented = image;

  if (orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8) {
    oriented = rotate(image, orientation <= 6 ? 90 : 270);
    image.free();
  }

  if (orientation === 2 || orientation === 3 || orientation === 5 || orientation === 7) {
    fliph(oriented);
  }

  if (orientation === 3 || orientation === 4) flipv(oriented);

  return oriented;
}

/** The scale factor lets a model map coordinates it reads back to the original. */
function dimensionHint(args: {
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly width: number;
  readonly height: number;
}): string {
  const scale = args.originalWidth / args.width;

  return `[Image: original ${String(args.originalWidth)}x${String(args.originalHeight)}, displayed at ${String(args.width)}x${String(args.height)}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

/**
 * Convert an unsupported format to PNG and bound the result to `IMAGE_LIMITS`.
 * Strategy: orient, scale into the dimension bounds, then at each size try PNG
 * and descending JPEG qualities, shrinking 25% per round until something fits.
 */
export async function processImage(bytes: Uint8Array, mimeType: string): Promise<ProcessedImage> {
  const sourceMimeType = supportedMimeType(mimeType);
  let image: PhotonImage | undefined;

  try {
    image = PhotonImage.new_from_byteslice(bytes);
    const base64Size = Math.ceil(bytes.byteLength / 3) * 4;

    if (
      sourceMimeType !== undefined &&
      image.get_width() <= IMAGE_LIMITS.maxWidth &&
      image.get_height() <= IMAGE_LIMITS.maxHeight &&
      base64Size <= IMAGE_LIMITS.maxBase64Bytes
    ) {
      return {
        kind: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: sourceMimeType,
        hints: [],
      };
    }

    image = await orient(image, bytes);
    const originalWidth = image.get_width();
    const originalHeight = image.get_height();

    const scale = Math.min(
      1,
      IMAGE_LIMITS.maxWidth / originalWidth,
      IMAGE_LIMITS.maxHeight / originalHeight,
    );

    let width = Math.max(1, Math.round(originalWidth * scale));
    let height = Math.max(1, Math.round(originalHeight * scale));

    while (true) {
      for (const candidate of encodeCandidates(image, width, height)) {
        if (candidate.data.length > IMAGE_LIMITS.maxBase64Bytes) continue;
        const hints: string[] = [];

        if (sourceMimeType !== candidate.mimeType) {
          hints.push(`[Image converted from ${mimeType} to ${candidate.mimeType}.]`);
        }

        if (width !== originalWidth || height !== originalHeight) {
          hints.push(dimensionHint({ originalWidth, originalHeight, width, height }));
        }

        return { kind: "image", data: candidate.data, mimeType: candidate.mimeType, hints };
      }

      if (width === 1 && height === 1) break;
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
  } catch {
    // A corrupt or undecodable payload must not be forwarded to the provider.
    return {
      kind: "omitted",
      message: "[Image omitted: could not be converted to a supported inline image format.]",
    };
  } finally {
    image?.free();
  }

  return {
    kind: "omitted",
    message: "[Image omitted: could not be resized below the inline image size limit.]",
  };
}

/**
 * Bound every image block in message or tool-result content, appending each
 * image's hints as a following text block.
 *
 * A block that cannot be processed is kept as it arrived: the producer already
 * decided to send it, and the failure may only mean the image backend is
 * unavailable. Content without images is returned as it came in, so callers
 * can skip rewriting the message.
 */
export async function normalizeImageContent(
  content: readonly (TextContent | ImageContent)[],
): Promise<readonly (TextContent | ImageContent)[]> {
  if (!content.some((block) => block.type === "image")) return content;

  const normalized: (TextContent | ImageContent)[] = [];

  for (const block of content) {
    if (block.type !== "image") {
      normalized.push(block);
      continue;
    }

    const processed = await processImage(Buffer.from(block.data, "base64"), block.mimeType);

    if (processed.kind === "omitted") {
      normalized.push(block);
      continue;
    }

    normalized.push({ ...block, data: processed.data, mimeType: processed.mimeType });

    if (processed.hints.length > 0) {
      normalized.push({ type: "text", text: processed.hints.join("\n") });
    }
  }

  return normalized;
}
