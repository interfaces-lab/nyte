import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlobId, UserContent } from "@nyte-ai/sdk";
import { connection } from "../sdk.tsx";
import { ComposerReadOnly } from "./composer-surface.tsx";

/** A file a user message carries: an attached image, a document. */
export type MessageFile = Extract<Exclude<UserContent, string>[number], { readonly kind: "file" }>;

/**
 * A sent or queued message, drawn with the chips its text stands for. The
 * text is the provider's; only its presentation is compact.
 */
export function UserMessageText({ text }: { readonly text: string }): ReactElement {
  return text.length > 100_000 ? (
    <>Message is too long to display</>
  ) : (
    <ComposerReadOnly text={text} />
  );
}

/** The text parts of a message, as the composer would send them again; a reference keeps its `@` spelling. */
export function userMessageText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content
    .flatMap((part) =>
      part.kind === "text" ? [part.text] : part.kind === "reference" ? [`@${part.path}`] : [],
    )
    .join("");
}

/** The images a message carries, as blobs on the host. */
export function messageImages(content: UserContent): readonly MessageFile[] {
  if (typeof content === "string") return [];

  return content.flatMap((part) =>
    part.kind === "file" && part.mime.startsWith("image/") ? [part] : [],
  );
}

/** The files a message carries, images included. */
export function messageFiles(content: UserContent): readonly MessageFile[] {
  if (typeof content === "string") return [];

  return content.flatMap((part) => (part.kind === "file" ? [part] : []));
}

/** An object URL for a blob the host holds, read once and kept for the session. */
export function useBlobUrl(blob: BlobId): string | undefined {
  const read = useQuery({
    queryKey: ["blob", blob],
    queryFn: async () => {
      const reader = await connection().blob(blob);
      const chunks: Uint8Array<ArrayBuffer>[] = [];

      for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));

      return URL.createObjectURL(new Blob(chunks, { type: reader.mime ?? "" }));
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return read.data;
}
