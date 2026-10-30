import { queryOptions } from "@tanstack/react-query";
import type { ByteReader } from "@nyte-ai/sdk";
import type { DeferredRuntimes } from "../../lib/deferred-entries.ts";
import { releaseWithQuery } from "../../lib/query-release.ts";

/** The document closes when the cache drops the query or a later read of the same version lands. */
export function pdfQuery(
  path: string,
  version: string,
  read: () => Promise<ByteReader>,
  openPdf: DeferredRuntimes["pdf"]["openPdf"],
) {
  return queryOptions({
    queryKey: ["files", "pdf", path, version],
    queryFn: async (context) => {
      await using reader = await read();
      const chunks: Uint8Array<ArrayBuffer>[] = [];

      for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));

      return openPdf(await new Blob(chunks).bytes(), (close) => releaseWithQuery(context, close));
    },
  });
}
