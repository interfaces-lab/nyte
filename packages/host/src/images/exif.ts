const ORIENTATION_TAG = 0x0112;

export function exifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tiff = tiffStart(bytes, view);

  if (tiff < 0 || tiff + 8 > bytes.length) return 1;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const directory = tiff + view.getUint32(tiff + 4, little);

  if (directory + 2 > bytes.length) return 1;
  const entries = view.getUint16(directory, little);

  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12;

    if (entry + 12 > bytes.length) return 1;

    if (view.getUint16(entry, little) === ORIENTATION_TAG) {
      const value = view.getUint16(entry + 8, little);

      return value >= 1 && value <= 8 ? value : 1;
    }
  }

  return 1;
}

function tiffStart(bytes: Uint8Array, view: DataView): number {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) return -1;
      const marker = view.getUint8(offset + 1);

      if (marker === 0xff) {
        offset++;
        continue;
      }

      if (marker === 0xe1 && startsExif(bytes, offset + 4)) return offset + 10;
      offset += 2 + view.getUint16(offset + 2);
    }

    return -1;
  }

  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);

      if (ascii(bytes, offset, "EXIF"))
        return startsExif(bytes, offset + 8) ? offset + 14 : offset + 8;
      offset += 8 + size + (size % 2);
    }
  }

  return -1;
}

function startsExif(bytes: Uint8Array, offset: number): boolean {
  return ascii(bytes, offset, "Exif") && bytes[offset + 4] === 0 && bytes[offset + 5] === 0;
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index++)
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;

  return true;
}
