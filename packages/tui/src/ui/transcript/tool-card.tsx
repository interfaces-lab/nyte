/**
 * A tool call. The decision tree (edit patch, changes, unified diff in
 * output, collapsed read, inline vs head/tail preview, delegation, shell) is
 * `toolCard(message, tasks, expanded)` in lib/tool-card.ts, a pure function
 * returning a card model; this component only draws that model.
 */
import type { JSX } from "@opentui/solid";
import { createMemo } from "solid-js";
import { toolCard } from "../../lib/tool-card.ts";
import type { ToolMessage } from "../../lib/view-helpers.ts";
import { CardView } from "./card.tsx";
import { useTranscript } from "./scope.tsx";

export function ToolCard(props: {
  readonly message: ToolMessage;
  readonly expanded: boolean;
}): JSX.Element {
  const scope = useTranscript();
  const card = createMemo(() => toolCard(props.message, scope.tasks(), props.expanded));

  return <CardView id={`tool:${props.message.id}`} card={card()} />;
}
