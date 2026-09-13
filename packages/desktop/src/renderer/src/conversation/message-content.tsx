import type { ReactElement } from "react";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import { ComposerReadOnly } from "./composer-surface.tsx";

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

/** The text parts of a message, as the composer would send them again. */
export function userMessageText(content: UserMessage["content"]): string {
  if (!Array.isArray(content)) return content;
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function messageImages(content: UserMessage["content"]): readonly ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => (part.type === "image" ? [part] : []));
}
