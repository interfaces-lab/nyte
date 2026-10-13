/**
 * The notice line, and the failure line ("Something failed in <origin>: <message> · <log path>").
 * A failed session watch (`screen().watch`) shows "Session updates stopped · <failure>" with a
 * retry control; clicking it dispatches `retry-watch`.
 */
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { WatchModel } from "../../model/screen.ts";
import type { FailureReport, Notice } from "../../model/state.ts";

export function NoticeLine(): JSX.Element {
  const app = useApp();
  const theme = () => app.kit.theme();

  const toneColor = (tone: Notice["tone"]): string => {
    if (tone === "error") return theme().error;

    if (tone === "ok") return theme().ok;

    return tone === "warning" ? theme().warning : theme().dim;
  };

  return (
    <box id="notice" flexDirection="column" flexShrink={0} marginLeft={3} marginRight={2}>
      <Show when={app.screen().watch}>
        {(watch: Accessor<WatchModel>) => (
          <box id="watch-failed" flexDirection="row" height={1}>
            <text fg={theme().warning} wrapMode="none" flexShrink={1}>
              {watch().failure === null
                ? "Session updates stopped · "
                : `Session updates stopped · ${watch().failure ?? ""} · `}
            </text>
            <text
              id="watch-retry"
              fg={theme().accent}
              flexShrink={0}
              selectable={false}
              onMouseUp={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                app.dispatch({ kind: "retry-watch" });
              }}
            >
              retry
            </text>
          </box>
        )}
      </Show>
      <Show when={app.screen().failure}>
        {(failure: Accessor<FailureReport>) => (
          <text id="failure" fg={theme().error} wrapMode="none">
            {`Something failed in ${failure().origin}: ${failure().message} · ${failure().logPath}`}
          </text>
        )}
      </Show>
      <Show when={app.screen().notice}>
        {(notice: Accessor<Notice>) => (
          <text id="notice-text" fg={toneColor(notice().tone)} wrapMode="none">
            {notice().text}
          </text>
        )}
      </Show>
    </box>
  );
}
