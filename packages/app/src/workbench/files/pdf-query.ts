import { queryOptions } from "@tanstack/react-query";
import type { ByteReader } from "@nyte-ai/sdk";
import type { DeferredRuntimes } from "../../lib/deferred-entries.ts";
import { releaseWithQuery } from "../../lib/query-release.ts";

/**
 * Each version's document closes as soon as nothing shows that version. While the next version
 * opens, the previous file stays as placeholder data only to keep the viewer mounted, since its
 * document may already be closed.
 */
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
    gcTime: 0,
    placeholderData: (previous) => previous,
  });
}
