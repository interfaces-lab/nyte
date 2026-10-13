/** "N running in background" / "a background task needs your answer"; click opens the task list. */
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { ScreenModel } from "../../model/screen.ts";

export function TasksLine(): JSX.Element {
  const app = useApp();

  return (
    <Show when={app.screen().tasksLine}>
      {(line: Accessor<NonNullable<ScreenModel["tasksLine"]>>) => (
        <text
          id="task-status"
          height={1}
          flexShrink={0}
          marginLeft={3}
          marginRight={2}
          wrapMode="none"
          truncate
          selectable={false}
          fg={line().attention ? app.kit.theme().warning : app.kit.theme().dim}
          onMouseUp={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            app.dispatch({
              kind: "open",
              dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
            });
          }}
        >
          {line().text}
        </text>
      )}
    </Show>
  );
}
