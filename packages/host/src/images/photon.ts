import {
  PhotonImage,
  SamplingFilter,
  fliph,
  flipv,
  initSync,
  resize,
} from "@silvia-odwyer/photon/photon_rs.js";
import type { SyncInitInput } from "@silvia-odwyer/photon/photon_rs.js";
import type { ImageLimits, ImageProcessor, PreparedImage } from "@nyte-ai/core";
import { exifOrientation } from "./exif.ts";

const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const JPEG_QUALITIES = [80, 70, 55, 40];

export function photonImages(wasm: SyncInitInput): ImageProcessor {
  initSync({ module: wasm });

  return {
    prepare: (bytes, mimeType, limits) => Promise.resolve(prepare(bytes, mimeType, limits)),
  };
}

function prepare(
  bytes: Uint8Array,
  mimeType: string,
  limits: ImageLimits,
): PreparedImage | undefined {
  const orientation = exifOrientation(bytes);
  let image: PhotonImage | undefined;

  try {
    image = PhotonImage.new_from_byteslice(bytes);

    if (
      INLINE_IMAGE_TYPES.has(mimeType) &&
      orientation === 1 &&
      image.get_width() <= limits.maxWidth &&
      image.get_height() <= limits.maxHeight &&
      base64Length(bytes.byteLength) <= limits.maxBase64Bytes
    )
      return { data: bytes.toBase64(), mimeType };

    if (orientation >= 5) {
      const upright = transposed(image, orientation);
      image.free();
      image = undefined;
      image = new PhotonImage(upright.pixels, upright.width, upright.height);
    } else if (orientation !== 1) {
      if (orientation !== 4) fliph(image);

      if (orientation !== 2) flipv(image);
    }

    const width = image.get_width();
    const height = image.get_height();
    const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height);

    let target = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };

    for (;;) {
      const encoded = encodeWithin(image, target, limits.maxBase64Bytes, mimeType === "image/jpeg");

      if (encoded !== undefined)
        return target.width === width && target.height === height
          ? encoded
          : { ...encoded, resized: { from: { width, height }, to: target } };

      if (target.width === 1 && target.height === 1) return undefined;
      target = {
        width: Math.max(1, Math.floor(target.width * 0.75)),
        height: Math.max(1, Math.floor(target.height * 0.75)),
      };
    }
  } catch {
    return undefined;
  } finally {
    image?.free();
  }
}

function encodeWithin(
  image: PhotonImage,
  size: { readonly width: number; readonly height: number },
  maxBase64Bytes: number,
  jpegFirst: boolean,
): { readonly data: string; readonly mimeType: string } | undefined {
  const same = size.width === image.get_width() && size.height === image.get_height();
  const scaled = same ? image : resize(image, size.width, size.height, SamplingFilter.Lanczos3);

  try {
    const png = { mimeType: "image/png", encode: () => scaled.get_bytes() };

    const jpegs = JPEG_QUALITIES.map((quality) => ({
      mimeType: "image/jpeg",
      encode: () => scaled.get_bytes_jpeg(quality),
    }));

    for (const candidate of jpegFirst ? [...jpegs, png] : [png, ...jpegs]) {
      const encoded = candidate.encode();

      if (base64Length(encoded.byteLength) <= maxBase64Bytes)
        return { data: encoded.toBase64(), mimeType: candidate.mimeType };
    }

    return undefined;
  } finally {
    if (!same) scaled.free();
  }
}

function transposed(image: PhotonImage, orientation: number) {
  const width = image.get_width();
  const height = image.get_height();
  const source = image.get_raw_pixels();
  const pixels = new Uint8Array(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outX = orientation === 5 || orientation === 8 ? y : height - 1 - y;
      const outY = orientation === 5 || orientation === 6 ? x : width - 1 - x;
      const from = (y * width + x) * 4;
      pixels.set(source.subarray(from, from + 4), (outY * height + outX) * 4);
    }
  }

  return { pixels, width: height, height: width };
}

function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}
