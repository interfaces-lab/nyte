import { useQuery } from "@tanstack/react-query";
import type { QueryCache, QueryKey } from "@tanstack/react-query";
import type { ByteReader } from "@nyte-ai/sdk";
import { releaseWithQuery } from "./query-release.ts";

async function readBlobUrl(
  open: () => Promise<ByteReader>,
  cache: QueryCache,
  key: QueryKey,
): Promise<string> {
  await using reader = await open();
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));
  const url = URL.createObjectURL(new Blob(chunks, { type: reader.mime ?? "" }));
  releaseWithQuery(cache, key, () => URL.revokeObjectURL(url));

  return url;
}

/** Reads the bytes `open` returns into an object URL under `key`, revoked when the query cache drops the key. */
export function useBlobUrl(key: QueryKey, open: () => Promise<ByteReader>) {
  return useQuery({
    queryKey: key,
    queryFn: (context) => readBlobUrl(open, context.client.getQueryCache(), context.queryKey),
  });
}
