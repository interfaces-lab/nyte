export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
