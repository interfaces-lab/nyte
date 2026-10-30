import { hashKey, useQuery } from "@tanstack/react-query";
import type { QueryCache, QueryKey, UseQueryResult } from "@tanstack/react-query";
import type { BlobId, ByteReader } from "@nyte-ai/sdk";
import { connection } from "./sdk.tsx";

const handedOut = new WeakMap<QueryCache, Map<string, string>>();

function ownedUrls(cache: QueryCache): Map<string, string> {
  const known = handedOut.get(cache);

  if (known !== undefined) return known;
  const urls = new Map<string, string>();
  handedOut.set(cache, urls);
  cache.subscribe((event) => {
    if (event.type !== "removed") return;
    const url = urls.get(event.query.queryHash);

    if (url === undefined) return;
    urls.delete(event.query.queryHash);
    URL.revokeObjectURL(url);
  });

  return urls;
}

async function readObjectUrl(
  open: () => Promise<ByteReader>,
  cache: QueryCache,
  key: QueryKey,
): Promise<string> {
  const reader = await open();
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));
  const url = URL.createObjectURL(new Blob(chunks, { type: reader.mime ?? "" }));
  const urls = ownedUrls(cache);
  const hash = hashKey(key);
  const previous = urls.get(hash);

  if (previous !== undefined) URL.revokeObjectURL(previous);
  urls.set(hash, url);

  return url;
}

/** Reads the bytes `open` streams into an object URL the query cache revokes when it drops the query. */
export function useObjectUrl(
  queryKey: QueryKey,
  open: () => Promise<ByteReader>,
): UseQueryResult<string> {
  return useQuery({
    queryKey,
    queryFn: (context) => readObjectUrl(open, context.client.getQueryCache(), context.queryKey),
  });
}

export function useBlobUrl(blob: BlobId): string | undefined {
  return useObjectUrl(["blob", blob], () => connection().blob(blob)).data;
}
