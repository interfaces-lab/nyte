import { Type } from "typebox";
import { SdkError } from "./errors.ts";
import type { Decoded } from "./schema.ts";

/** How a text file's bytes encode its text. UTF-8 keeps a byte order mark in the text; UTF-16 always writes one, since without it the file wouldn't read back as text. */
export const TextEncodingType = Type.Enum(["utf8", "utf-16le", "utf-16be", "windows-1252"]);

export type TextEncoding = Decoded<typeof TextEncodingType>;

const WINDOWS_1252_HIGH = [
  0x20_ac, 0x81, 0x20_1a, 0x1_92, 0x20_1e, 0x20_26, 0x20_20, 0x20_21, 0x2_c6, 0x20_30, 0x1_60,
  0x20_39, 0x1_52, 0x8d, 0x1_7d, 0x8f, 0x90, 0x20_18, 0x20_19, 0x20_1c, 0x20_1d, 0x20_22, 0x20_13,
  0x20_14, 0x2_dc, 0x21_22, 0x1_61, 0x20_3a, 0x1_53, 0x9d, 0x1_7e, 0x1_78,
];

const WINDOWS_1252_BYTES = new Map(WINDOWS_1252_HIGH.map((unit, index) => [unit, 0x80 + index]));

const CHUNK = 0x20_00;

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

    for (let index = 0; index < units.length; index += 1) {
      units[index] = view.getUint16(2 + index * 2, utf16 === "utf-16le");
    }

    return units.includes(0) ? null : { contents: fromUnits(units), encoding: utf16 };
  }

  if (bytes.includes(0)) return null;

  try {
    return {
      contents: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      encoding: "utf8",
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
  if (encoding === "utf8") return contents;

  if (encoding === "windows-1252") {
    const bytes = new Uint8Array(contents.length);

    for (let index = 0; index < contents.length; index += 1) {
      const unit = contents.charCodeAt(index);
      const byte =
        unit < 0x80 || (unit >= 0xa0 && unit <= 0xff) ? unit : WINDOWS_1252_BYTES.get(unit);

      if (byte === undefined) {
        throw new SdkError(
          "invalid",
          `“${String.fromCodePoint(contents.codePointAt(index) ?? unit)}” can't be saved in Windows-1252.`,
        );
      }
      bytes[index] = byte;
    }

    return bytes;
  }
  const bytes = new Uint8Array(2 + contents.length * 2);
  const view = new DataView(bytes.buffer);
  const little = encoding === "utf-16le";
  view.setUint16(0, 0xfe_ff, little);

  for (let index = 0; index < contents.length; index += 1) {
    view.setUint16(2 + index * 2, contents.charCodeAt(index), little);
  }

  return bytes;
}

function fromUnits(units: Uint16Array): string {
  return Array.from({ length: Math.ceil(units.length / CHUNK) }, (_, index) =>
    String.fromCharCode(...units.subarray(index * CHUNK, (index + 1) * CHUNK)),
  ).join("");
}
