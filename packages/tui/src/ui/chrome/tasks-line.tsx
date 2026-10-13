/** "● N running in background" / "● a background task needs your answer" · "↓ view"; click opens the task list. */
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { keycap } from "../../lib/constants.ts";
import { statusMark } from "../../lib/tasks.ts";
import type { ScreenModel } from "../../model/screen.ts";

export function TasksLine(): JSX.Element {
  const app = useApp();
  const theme = () => app.kit.theme();

  return (
    <Show when={app.screen().tasksLine}>
      {(line: Accessor<NonNullable<ScreenModel["tasksLine"]>>) => {
        // A background child waiting on the user outranks the count: it is the one thing to act on.
        const mark = () => statusMark(line().attention ? "waiting" : "running");

        return (
          <text
            id="task-status"
            height={1}
            flexShrink={0}
            marginLeft={3}
            marginRight={2}
            wrapMode="none"
            truncate
            selectable={false}
            onMouseUp={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              app.dispatch({
                kind: "open",
                dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
              });
            }}
          >
            <span style={{ fg: theme()[mark().tone] }}>{`${mark().glyph} `}</span>
            <span style={{ fg: theme().foreground }}>{line().text}</span>
            <span style={{ fg: theme().dim }}>
              {` · ${keycap("chat.history.next", "symbol")} view`}
            </span>
          </text>
        );
      }}
    </Show>
  );
}
