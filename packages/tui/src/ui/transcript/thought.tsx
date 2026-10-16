import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import {
  ACTIVITY_THOUGHT_LABEL,
  GLYPHS,
  RESULT_PREVIEW_LINES,
  RESULT_TAIL_LINES,
} from "../../lib/constants.ts";
import { toolOutputPreview } from "../../lib/tool-card.ts";
import type { PartMessage } from "../../lib/view-helpers.ts";
import { hasIncompleteHeadingPrefix } from "./assistant-text.tsx";
import { Markdown } from "./markdown.tsx";

export function Thought(props: {
  readonly message: PartMessage & { readonly state: { readonly markdown: string } };
  readonly expanded: boolean;
}): JSX.Element {
  const { kit } = useApp();
  const live = (): boolean => props.message.status.kind === "live";

  const text = createMemo(() => {
    const { markdown } = props.message.state;

    if (!live()) {
      return toolOutputPreview(markdown, props.expanded, {
        kind: "head-tail",
        head: RESULT_PREVIEW_LINES,
        tail: RESULT_TAIL_LINES,
      });
    }

    return hasIncompleteHeadingPrefix(markdown)
      ? markdown.slice(0, markdown.lastIndexOf("\n") + 1)
      : markdown;
  });

  return (
    <Show when={text().trim() !== ""}>
      <box id={`thought:${props.message.id}`} flexDirection="column" width="100%">
        <Show when={!live()}>
          <text fg={kit.theme().thinking} wrapMode="none" selectable={false}>
            {`${GLYPHS.diamond}${ACTIVITY_THOUGHT_LABEL}`}
          </text>
        </Show>
        <Markdown messageId={props.message.id} content={text()} streaming={live()} subtle />
      </box>
    </Show>
  );
}
