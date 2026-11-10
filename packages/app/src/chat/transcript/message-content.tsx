import type { ReactElement } from "react";
import type { UserContent } from "@nyte-ai/sdk";
import { ComposerReadOnly } from "../composer/composer-surface.tsx";
import { ImagePlaceholder, ImagePreview } from "../markdown/image-preview.tsx";
import { useBlobUrl } from "../../lib/use-blob-url.ts";
import { connection } from "../../data/connection.ts";

export type MessageFile = Extract<Exclude<UserContent, string>[number], { readonly kind: "file" }>;

export function UserMessageText({ text }: { readonly text: string }): ReactElement {
  return text.length > 100_000 ? (
    <>Message is too long to display</>
  ) : (
    <ComposerReadOnly text={text} />
  );
}

export function messageImages(content: UserContent): readonly MessageFile[] {
  if (typeof content === "string") return [];

  return content.flatMap((part) =>
    part.kind === "file" && part.mime.startsWith("image/") ? [part] : [],
  );
}

export function messageFiles(content: UserContent): readonly MessageFile[] {
  if (typeof content === "string") return [];

  return content.flatMap((part) => (part.kind === "file" ? [part] : []));
}

export function BlobImage({
  file,
  compact,
}: {
  readonly file: MessageFile;
  readonly compact?: boolean;
}): ReactElement {
  const blob = useBlobUrl(["blob", file.blob], () => connection().blob(file.blob));
  const src = blob.data;

  if (src === undefined)
    return <ImagePlaceholder name={file.name} failed={blob.isError} compact={compact} />;

  return <ImagePreview src={src} name={file.name} compact={compact} />;
}
