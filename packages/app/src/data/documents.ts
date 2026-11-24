import { encodeTextFile } from "@nyte-ai/schema";
import type { TextEncoding } from "@nyte-ai/schema";
import type { Document, DocumentsApi, FileVersion, WriteOutcome } from "@nyte-ai/sdk";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { connected } from "./connection.ts";
import { keys, queryClient } from "./query-client.ts";

export async function documentsApi(): Promise<DocumentsApi> {
  return (await connected()).documents;
}

export function useDocument(path: string | undefined) {
  return useQuery({
    queryKey: keys.document(path),
    queryFn:
      path === undefined
        ? skipToken
        : async () => (await documentsApi()).read(path, { as: "document" }),
  });
}

export async function writeDocument(input: {
  readonly path: string;
  readonly contents: string;
  readonly encoding: TextEncoding;
  readonly expect?: FileVersion | "absent";
}): Promise<WriteOutcome> {
  const outcome = await (
    await documentsApi()
  ).write(
    input.path,
    encodeTextFile(input.contents, input.encoding),
    input.expect === undefined ? undefined : { expect: input.expect },
  );

  if (outcome.kind === "saved") {
    queryClient.setQueryData<Document>(keys.document(input.path), (document) =>
      document?.kind === "text"
        ? {
            ...document,
            contents: input.contents,
            encoding: input.encoding,
            version: outcome.version,
          }
        : document,
    );
  }

  return outcome;
}

export function useSaveDocument() {
  return useMutation({ mutationKey: ["documents", "save"], mutationFn: writeDocument });
}
