import { createHash } from "node:crypto";

/** Returns the SHA-256 hex digest of a string's UTF-8 bytes or of bytes. */
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
