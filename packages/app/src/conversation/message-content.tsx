import type { ReactElement } from "react";
import type { UserContent } from "@nyte-ai/sdk";
import { ComposerReadOnly } from "./composer-surface.tsx";

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

export function userMessageText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content
    .flatMap((part) =>
      part.kind === "text" ? [part.text] : part.kind === "reference" ? [`@${part.path}`] : [],
    )
    .join("");
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
