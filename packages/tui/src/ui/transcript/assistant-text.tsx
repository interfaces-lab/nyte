import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { Markdown } from "./markdown.tsx";

export function hasIncompleteHeadingPrefix(text: string): boolean {
  const line = text.slice(text.lastIndexOf("\n") + 1);
  let index = 0;

  while (index < 3 && index < line.length && line.charAt(index).trim() === "") index += 1;
  const start = index;

  while (index - start < 7 && line.charAt(index) === "#") index += 1;
  const hashes = index - start;

  return hashes >= 1 && hashes <= 6 && line.slice(index).trim() === "";
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
