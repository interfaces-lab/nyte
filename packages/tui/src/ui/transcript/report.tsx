import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { ReportMessage } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { reportRow } from "../../lib/tasks.ts";
import { useTranscript } from "./scope.tsx";

export function ReportBlock(props: { readonly message: ReportMessage }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();
  const row = createMemo(() => reportRow(props.message, scope.tasks()));

  const held = createMemo(
    () => props.message.status.kind !== "landed" && scope.model().reportsHeld,
  );

  return (
    <text
      id={`report:${props.message.id}`}
      wrapMode="none"
      truncate
      selectable={false}
      onMouseUp={(event) => {
        const task = row().task;

        if (event.button !== 0 || task === undefined) return;

        if (app.screen().selectionActive) return;
        event.preventDefault();
        event.stopPropagation();
        app.dispatch({ kind: "open", dialog: { kind: "inspector", task: task.id } });
      }}
    >
      <span style={{ fg: app.kit.theme()[row().mark.tone] }}>{`${GLYPHS.report} `}</span>
      <span style={{ fg: app.kit.theme().foreground }}>{row().title}</span>
      <Show when={held()}>
        <span style={{ fg: app.kit.theme().warning }}>{"  held · send a message to deliver"}</span>
      </Show>
    </text>
  );
}
