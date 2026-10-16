import type { JSX } from "@opentui/solid";
import { createMemo } from "solid-js";
import type { Task } from "../../lib/tasks.ts";
import { toolCard } from "../../lib/tool-card.ts";
import type { ToolMessage } from "../../lib/view-helpers.ts";
import { CardView } from "./card.tsx";
import { useTranscript } from "./scope.tsx";

export function ToolCard(props: {
  readonly message: ToolMessage;
  readonly expanded: boolean;
}): JSX.Element {
  const scope = useTranscript();

  const tasks = (): readonly Task[] =>
    props.message.state.class.kind === "delegate" ? scope.tasks() : [];

  const card = createMemo(() => toolCard(props.message, tasks(), props.expanded));

  return <CardView id={`tool:${props.message.id}`} card={card()} />;
}
