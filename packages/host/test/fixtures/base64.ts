/** Returns chunks of bytes as one base64 string, a slice at a time so a large blob never overflows the argument list. */
export function toBase64(chunks: readonly Uint8Array[]): string {
  let binary = "";

  for (const chunk of chunks)
    for (let offset = 0; offset < chunk.length; offset += 0x8000)
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000));

  return btoa(binary);
}

/** Returns the bytes a base64 string holds. */
export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}
