import { SdkError } from "@nyte-ai/schema";

/** The most bytes one blob holds; every store's `putBlob` refuses a larger one. */
export const BLOB_LIMIT = 32 * 1024 * 1024;

/** Joins a blob's chunks, failing with `SdkError("invalid")` as soon as they pass `BLOB_LIMIT`, before reading the rest. */
export async function collectBlob(bytes: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of bytes) {
    size += chunk.byteLength;

    if (size > BLOB_LIMIT)
      throw new SdkError(
        "invalid",
        `The file is over ${BLOB_LIMIT / 1024 / 1024} MiB, the most a stored file can hold.`,
      );
    chunks.push(chunk);
  }

  const joined = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}
