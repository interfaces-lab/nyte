import { hashKey, useQuery } from "@tanstack/react-query";
import type { QueryCache, QueryKey } from "@tanstack/react-query";
import type { ByteReader } from "@nyte-ai/sdk";

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

async function readBlobUrl(
  open: () => Promise<ByteReader>,
  cache: QueryCache,
  key: QueryKey,
): Promise<string> {
  await using reader = await open();
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

/** Reads the bytes `open` returns into an object URL under `key`, revoked when the query cache drops the key. */
export function useBlobUrl(key: QueryKey, open: () => Promise<ByteReader>) {
  return useQuery({
    queryKey: key,
    queryFn: (context) => readBlobUrl(open, context.client.getQueryCache(), context.queryKey),
  });
}
