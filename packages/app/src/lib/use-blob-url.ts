import { queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryFunctionContext, QueryKey } from "@tanstack/react-query";
import type { ByteReader } from "@nyte-ai/sdk";
import { releaseWithQuery } from "./query-release.ts";

async function readBlobUrl(
  open: () => Promise<ByteReader>,
  context: QueryFunctionContext,
): Promise<string> {
  await using reader = await open();
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));
  const url = URL.createObjectURL(new Blob(chunks, { type: reader.mime ?? "" }));
  releaseWithQuery(context, () => URL.revokeObjectURL(url));

  return url;
}

export function blobUrlQuery(key: QueryKey, open: () => Promise<ByteReader>) {
  return queryOptions({
    queryKey: key,
    queryFn: (context) => readBlobUrl(open, context),
  });
}

export function useBlobUrl(key: QueryKey, open: () => Promise<ByteReader>) {
  return useQuery(blobUrlQuery(key, open));
}
