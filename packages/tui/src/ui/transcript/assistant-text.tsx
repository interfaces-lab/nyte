import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { PartMessage } from "../../lib/view-helpers.ts";
import { Markdown } from "./markdown.tsx";

export function hasIncompleteHeadingPrefix(text: string): boolean {
  const line = text.slice(text.lastIndexOf("\n") + 1);

  return /^\s{0,3}#{1,6}\s*$/u.test(line);
}

export function AssistantText(props: {
  readonly message: PartMessage & { readonly state: { readonly markdown: string } };
}): JSX.Element {
  const live = (): boolean => props.message.status.kind === "live";

  const text = createMemo(() => {
    const { markdown } = props.message.state;

    return live() && hasIncompleteHeadingPrefix(markdown)
      ? markdown.slice(0, markdown.lastIndexOf("\n") + 1)
      : markdown;
  });

  return (
    <Show when={text().trim() !== ""}>
      <Markdown
        id={`text:${props.message.id}`}
        messageId={props.message.id}
        content={text()}
        streaming={live()}
        subtle={false}
      />
    </Show>
  );
}
