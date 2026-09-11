import { Fragment } from "react";
import type { ReactElement } from "react";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import { ComposerChipView } from "./composer-chip.tsx";
import { messageParts } from "./message-references.ts";

/**
 * A sent or queued message, drawn with the chips its text stands for. The
 * text is the provider's; only its presentation is compact.
 */
export function UserMessageText({ text }: { readonly text: string }): ReactElement {
  const parts = messageParts(text.replaceAll(/\n{3,}/gu, "\n\n"), { form: "message" });
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "text") return <Fragment key={index}>{part.text}</Fragment>;
        const next = parts[index + 1];
        // Head sentences sit on their own line; the body that follows starts a new one.
        const separator = !part.source.endsWith("\n\n")
          ? null
          : next?.kind === "text"
            ? "\n"
            : next?.kind === "reference"
              ? " "
              : null;
        return (
          <Fragment key={index}>
            <ComposerChipView reference={part.reference} />
            {separator}
          </Fragment>
        );
      })}
    </>
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
