import { extname } from "node:path";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const EBML = "\x1a\x45\xdf\xa3";

const VIDEO_BRANDS = new Map([
  ["qt  ", "video/quicktime"],
  ["3gp4", "video/3gpp"],
  ["3gp5", "video/3gpp"],
  ["3gp6", "video/3gpp"],
  ["3g2a", "video/3gpp2"],
  ...["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "mmp4", "MSNV"].map(
    (brand) => [brand, "video/mp4"] as const,
  ),
  ...["M4V ", "M4VH", "M4VP"].map((brand) => [brand, "video/x-m4v"] as const),
]);

export interface FileClass {
  readonly kind: "text" | "image" | "video" | "pdf" | "binary";
  readonly mime: string;
}

export function classifyFile(path: string, head: Buffer): FileClass {
  const signature = head.toString("latin1", 0, 12);

  if (head.subarray(0, 8).equals(PNG)) return { kind: "image", mime: "image/png" };

  if (signature.startsWith("\xff\xd8\xff")) return { kind: "image", mime: "image/jpeg" };

  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a"))
    return { kind: "image", mime: "image/gif" };

  if (signature.startsWith("RIFF") && signature.slice(8) === "WEBP")
    return { kind: "image", mime: "image/webp" };

  if (signature.startsWith("BM") && signature.slice(6, 10) === "\0\0\0\0")
    return { kind: "image", mime: "image/bmp" };

  if (signature.startsWith("\0\0\x01\0")) return { kind: "image", mime: "image/x-icon" };

  if (signature.slice(4, 8) === "ftyp" && /avi[fs]/u.test(head.toString("latin1", 8, 32)))
    return { kind: "image", mime: "image/avif" };

  const video =
    signature.slice(4, 8) === "ftyp"
      ? VIDEO_BRANDS.get(signature.slice(8, 12))
      : signature.startsWith(EBML) && head.toString("latin1", 0, 64).includes("webm")
        ? "video/webm"
        : undefined;

  if (video !== undefined) return { kind: "video", mime: video };

  if (signature.startsWith("%PDF-")) return { kind: "pdf", mime: "application/pdf" };

  if (extname(path).toLowerCase() === ".svg") return { kind: "image", mime: "image/svg+xml" };

  return looksLikeText(head)
    ? { kind: "text", mime: "text/plain" }
    : { kind: "binary", mime: "application/octet-stream" };
}

function looksLikeText(head: Buffer): boolean {
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);

  return utf16 || !head.includes(0);
}
