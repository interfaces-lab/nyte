/** A child's or job's report: `reportRow` title and tone, head/tail body; click opens the task. */
import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, RESULT_PREVIEW_LINES, RESULT_TAIL_LINES } from "../../lib/constants.ts";
import { reportRow } from "../../lib/tasks.ts";
import { toolOutputPreview } from "../../lib/tool-card.ts";
import type { ReportMessage } from "../../lib/view-helpers.ts";
import { Markdown } from "./markdown.tsx";
import { useTranscript } from "./scope.tsx";

export function ReportBlock(props: { readonly message: ReportMessage }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();
  const row = createMemo(() => reportRow(props.message, scope.tasks()));

  const body = createMemo(() =>
    toolOutputPreview(row().body, scope.model().toolOutput === "expanded", {
      kind: "head-tail",
      head: RESULT_PREVIEW_LINES,
      tail: RESULT_TAIL_LINES,
    }),
  );

  return (
    <box id={`report:${props.message.id}`} flexDirection="column" width="100%">
      <text
        wrapMode="none"
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
      </text>
      <Show when={body() !== ""}>
        <Markdown messageId={props.message.id} content={body()} streaming={false} subtle />
      </Show>
    </box>
  );
}
