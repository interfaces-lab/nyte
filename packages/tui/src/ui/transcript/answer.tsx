import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { AnswerMessage } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { useTranscript } from "./scope.tsx";

/** Where a late answer reached the agent: one quiet line, since the part it answers shows the answer. */
export function AnswerBlock(props: { readonly message: AnswerMessage }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();

  const held = createMemo(
    () => props.message.status.kind !== "landed" && scope.model().reportsHeld,
  );

  return (
    <text id={`answer:${props.message.id}`} wrapMode="none" truncate selectable={false}>
      <span style={{ fg: app.kit.theme().dim }}>{`${GLYPHS.report} Answered `}</span>
      <span style={{ fg: app.kit.theme().foreground }}>{props.message.source.label}</span>
      <span style={{ fg: app.kit.theme().dim }}>{"  after the agent moved on"}</span>
      <Show when={held()}>
        <span style={{ fg: app.kit.theme().warning }}>{"  held · send a message to deliver"}</span>
      </Show>
    </text>
  );
}
