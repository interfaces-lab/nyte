import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Loader } from "@nyte-ai/ui/loader";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";

const styles = create({
  statusDot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    flexShrink: 0,
    pointerEvents: "none",
  },
  statusSpinner: { width: glyph.md, height: glyph.md, color: role.contentSecondary },
  statusWaiting: {
    width: glyph.sm,
    height: glyph.sm,
    backgroundColor: "transparent",
    color: role.contentSecondary,
  },
  statusBackground: {
    width: glyph.sm,
    height: glyph.sm,
    backgroundColor: "transparent",
    color: role.contentSecondary,
  },
  statusFailed: {
    width: glyph.sm,
    height: glyph.sm,
    backgroundColor: "transparent",
    color: role.contentSecondary,
  },
  statusUnread: { backgroundColor: role.contentAccent },
});

function statusMarkStyle(state: TaskState) {
  switch (state) {
    case "working":
      return [intent.primary, styles.statusSpinner];
    case "retrying":
      return [intent.warning, styles.statusSpinner];
    case "waiting":
      return [intent.warning, styles.statusWaiting];
    case "background":
      return styles.statusBackground;
    case "failed":
      return [intent.danger, styles.statusFailed];
    case "done":
      return [intent.primary, styles.statusUnread];
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/**
 * The one mark for where a task stands, in every list, tab, tray and transcript row: a chat, a
 * subagent or a job. A done task draws nothing unless its reply is unread; screen readers hear
 * the task's word. A job is a process, not AI work, so it runs with a `Loader`, not a `Spinner`.
 */
export function TaskMark({
  state,
  unread = false,
  job = false,
}: {
  readonly state: TaskState;
  readonly unread?: boolean;
  readonly job?: boolean;
}): ReactElement | null {
  if (state === "done" && !unread) return null;

  return (
    <span
      role="img"
      aria-label={state === "done" ? "Unread" : taskLabel(state)}
      {...props(styles.statusDot, statusMarkStyle(state))}
    >
      {(state === "working" || state === "retrying") && (job ? <Loader /> : <Spinner />)}
      {state === "waiting" && <Icon name="bubble-question" size="sm" variant="filled" />}
      {state === "background" && <Icon name="layers" size="sm" />}
      {state === "failed" && <Icon name="warning" size="sm" variant="filled" />}
    </span>
  );
}
