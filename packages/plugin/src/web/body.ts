export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads a response body, throwing once its declared or streamed size passes `limit` bytes. */
export async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);

  if (Number.isSafeInteger(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooLarge(limit);
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;

    if (size > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }

    chunks.push(next.value);
  }

  const body = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function tooLarge(limit: number): Error {
  return new Error(
    `The response is larger than ${limit >= 1024 * 1024 ? `${limit / 1024 / 1024} MiB` : `${limit / 1024} KiB`}.`,
  );
}
