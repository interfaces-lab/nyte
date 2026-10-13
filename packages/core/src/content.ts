import { asId } from "@nyte-ai/schema";
import type { BlobId, Json, ObjectId } from "@nyte-ai/schema";

/** Returns an object's content id: the SHA-256 hex of its canonical JSON, keys sorted recursively. */
export async function objectId(content: Json): Promise<ObjectId> {
  return asId<"object">(await digest(new TextEncoder().encode(canonical(content))));
}

/** Returns a blob's content id: the SHA-256 hex of its bytes. */
export async function blobId(bytes: Uint8Array): Promise<BlobId> {
  return asId<"blob">(await digest(new Uint8Array(bytes)));
}

/** Returns the SHA-256 hex of a text's UTF-8 bytes. */
export async function textDigest(text: string): Promise<string> {
  return digest(new TextEncoder().encode(text));
}

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1));

  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
