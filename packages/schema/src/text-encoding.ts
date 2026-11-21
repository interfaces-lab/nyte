import { Type } from "typebox";
import { SdkError } from "./errors.ts";
import type { Decoded } from "./schema.ts";

/** How a text file's bytes encode its text. UTF-8 keeps a byte order mark in the text; UTF-16 always writes one, since without it the file wouldn't read back as text. */
export const TextEncodingType = Type.Enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"]);

export type TextEncoding = Decoded<typeof TextEncodingType>;

const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

const WINDOWS_1252_BYTES = new Map(WINDOWS_1252_HIGH.map((unit, index) => [unit, 0x80 + index]));

const CHUNK = 0x2000;

/**
 * Reads bytes as text the way an editor would: UTF-16 by its byte order mark, then UTF-8, then Windows-1252, which
 * reads any bytes back exactly. Null bytes, or an odd-length UTF-16 file, mean the file isn't text.
 */
export function decodeTextFile(
  bytes: Uint8Array,
): { readonly contents: string; readonly encoding: TextEncoding } | null {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : undefined;

  if (utf16 !== undefined) {
    if (bytes.length % 2 !== 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const units = new Uint16Array(bytes.length / 2 - 1);

    for (let index = 0; index < units.length; index += 1)
      units[index] = view.getUint16(2 + index * 2, utf16 === "utf-16le");

    return units.includes(0) ? null : { contents: fromUnits(units), encoding: utf16 };
  }

  if (bytes.includes(0)) return null;

  try {
    return {
      contents: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    const units = new Uint16Array(bytes);

    for (let index = 0; index < units.length; index += 1) {
      const byte = units[index] ?? 0;

      if (byte >= 0x80 && byte < 0xa0) units[index] = WINDOWS_1252_HIGH[byte - 0x80] ?? byte;
    }

    return { contents: fromUnits(units), encoding: "windows-1252" };
  }
}

/** Encodes text as `decodeTextFile` read it. UTF-8 stays a string, which every files API writes as UTF-8. Throws when Windows-1252 has no byte for a character. */
export function encodeTextFile(contents: string, encoding: TextEncoding): string | Uint8Array {
  if (encoding === "utf-8") return contents;

  if (encoding === "windows-1252") {
    const bytes = new Uint8Array(contents.length);

    for (let index = 0; index < contents.length; index += 1) {
      const unit = contents.charCodeAt(index);
      const byte =
        unit < 0x80 || (unit >= 0xa0 && unit <= 0xff) ? unit : WINDOWS_1252_BYTES.get(unit);

      if (byte === undefined)
        throw new SdkError(
          "invalid",
          `“${String.fromCodePoint(contents.codePointAt(index) ?? unit)}” can't be saved in Windows-1252.`,
        );
      bytes[index] = byte;
    }

    return bytes;
  }
  const bytes = new Uint8Array(2 + contents.length * 2);
  const view = new DataView(bytes.buffer);
  const little = encoding === "utf-16le";
  view.setUint16(0, 0xfeff, little);

  for (let index = 0; index < contents.length; index += 1)
    view.setUint16(2 + index * 2, contents.charCodeAt(index), little);

  return bytes;
}

function fromUnits(units: Uint16Array): string {
  return Array.from({ length: Math.ceil(units.length / CHUNK) }, (_, index) =>
    String.fromCharCode(...units.subarray(index * CHUNK, (index + 1) * CHUNK)),
  ).join("");
}
