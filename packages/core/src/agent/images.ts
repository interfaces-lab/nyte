import type { ImageContent, TextContent } from "@nyte-ai/schema/model";
import { IMAGE_LIMITS } from "../contract/host.ts";
import type { ImageProcessor, PreparedImage } from "../contract/host.ts";
import { dev } from "../util/dev-log.ts";

const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function modelImage(
  images: ImageProcessor | null,
  file: { readonly bytes: Uint8Array; readonly mime: string; readonly name: string },
): Promise<readonly (TextContent | ImageContent)[]> {
  const mime = normalizeImageType(file.mime);
  const label = `Image ${file.name}, ${mime}`;

  if (images === null)
    return passThrough(file.bytes, mime, label, "no image processor is configured");
  let prepared: PreparedImage | undefined;

  try {
    prepared = await images.prepare(file.bytes, mime, IMAGE_LIMITS);
  } catch (cause) {
    dev("images", "prepare failed", { name: file.name, mime, cause: String(cause) });

    return passThrough(file.bytes, mime, label, "the image processor failed");
  }

  if (prepared === undefined)
    return [{ type: "text", text: `[${label}: left out, it cannot be prepared for the model]` }];
  const image: ImageContent = { type: "image", data: prepared.data, mimeType: prepared.mimeType };

  if (prepared.resized === undefined) return [image];
  const { from, to } = prepared.resized;

  return [
    image,
    {
      type: "text",
      text: `[${label}: resized from ${from.width}x${from.height} to ${to.width}x${to.height}. Multiply coordinates by ${(from.width / to.width).toFixed(2)} to map them to the original.]`,
    },
  ];
}

function passThrough(
  bytes: Uint8Array,
  mime: string,
  label: string,
  unprepared: string,
): readonly (TextContent | ImageContent)[] {
  const omitted = (reason: string): readonly TextContent[] => [
    { type: "text", text: `[${label}: left out, ${reason} and ${unprepared}]` },
  ];

  if (!INLINE_IMAGE_TYPES.has(mime)) return omitted("the model does not take this format");

  if (Math.ceil(bytes.byteLength / 3) * 4 > IMAGE_LIMITS.maxBase64Bytes)
    return omitted(`${String(bytes.byteLength)} bytes is too large to send`);
  const size = imageDimensions(bytes, mime);

  if (size === undefined) return omitted("its size cannot be read");

  if (size.width > IMAGE_LIMITS.maxWidth || size.height > IMAGE_LIMITS.maxHeight)
    return omitted(
      `${String(size.width)}x${String(size.height)} is larger than ${String(IMAGE_LIMITS.maxWidth)}x${String(IMAGE_LIMITS.maxHeight)}`,
    );

  return [{ type: "image", data: bytes.toBase64(), mimeType: mime }];
}

function normalizeImageType(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";

  return base === "image/jpg" ? "image/jpeg" : base;
}

function imageDimensions(
  bytes: Uint8Array,
  mime: string,
): { readonly width: number; readonly height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  switch (mime) {
    case "image/png":
      return bytes.length < 24
        ? undefined
        : { width: view.getUint32(16), height: view.getUint32(20) };
    case "image/gif":
      return bytes.length < 10
        ? undefined
        : { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    case "image/webp": {
      if (bytes.length < 30) return undefined;
      const chunk = new TextDecoder().decode(bytes.subarray(12, 16));

      if (chunk === "VP8 ")
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        };

      if (chunk === "VP8L") {
        const bits = view.getUint32(21, true);

        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }

      if (chunk === "VP8X") {
        const uint24 = (offset: number): number =>
          view.getUint16(offset, true) + view.getUint8(offset + 2) * 0x10000;

        return { width: uint24(24) + 1, height: uint24(27) + 1 };
      }

      return undefined;
    }

    case "image/jpeg":
      for (let offset = 2; offset + 9 <= bytes.length;) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = view.getUint8(offset + 1);

        if (marker === 0xff) {
          offset++;
          continue;
        }

        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        )
          return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        offset += 2 + view.getUint16(offset + 2);
      }

      return undefined;
    default:
      return undefined;
  }
}
