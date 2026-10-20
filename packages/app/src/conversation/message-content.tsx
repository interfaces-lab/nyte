import type { ReactElement } from "react";
import type { UserContent } from "@nyte-ai/sdk";
import { ComposerReadOnly } from "./composer-surface.tsx";

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
