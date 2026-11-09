import type { Document, DocumentsApi, FileVersion } from "@nyte-ai/sdk";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connected } from "./connection.ts";
import { keys } from "./query-client.ts";

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
    staleTime: 1_000,
  });
}

export function useSaveDocument() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["documents", "save"],
    mutationFn: async (input: {
      readonly path: string;
      readonly contents: string;
      readonly expect?: FileVersion | "absent";
    }) =>
      (await documentsApi()).write(
        input.path,
        input.contents,
        input.expect === undefined ? undefined : { expect: input.expect },
      ),
    onSuccess: (outcome, input) => {
      if (outcome.kind !== "saved") return;
      client.setQueryData<Document>(keys.document(input.path), (document) =>
        document?.kind === "text"
          ? { ...document, contents: input.contents, version: outcome.version }
          : document,
      );
    },
  });
}
