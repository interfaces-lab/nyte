import { hashKey, useQuery } from "@tanstack/react-query";
import type { QueryCache, QueryKey } from "@tanstack/react-query";
import type { BlobId } from "@nyte-ai/sdk";
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

async function readBlobUrl(blob: BlobId, cache: QueryCache, key: QueryKey): Promise<string> {
  const reader = await connection().blob(blob);
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

export function useBlobUrl(blob: BlobId): string | undefined {
  const read = useQuery({
    queryKey: ["blob", blob],
    queryFn: ({ client, queryKey }) => readBlobUrl(blob, client.getQueryCache(), queryKey),
  });

  return read.data;
}
