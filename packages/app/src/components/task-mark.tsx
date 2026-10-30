import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";

const MOON = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }))
  .filter(({ x, y }) => (x - 2) ** 2 + (y - 2) ** 2 < 6.25)
  .map(({ x, y }) => `M${x * 3 + 1} ${y * 3 + 1}h2v2h-2z`)
  .join("");

const pulse = keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
});

const styles = create({
  unreadMark: {
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    color: role.contentAccent,
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1600ms",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
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
  statusIdle: { backgroundColor: "transparent" },
  statusUnread: { width: glyph.md, height: glyph.md, backgroundColor: "transparent" },
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
      return styles.statusIdle;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/**
 * The one mark for where a task stands, in every list, tab, tray and transcript row: a chat, a
 * subagent or a job. A done task draws nothing unless its reply is unread; screen readers hear
 * the task's word.
 */
export function TaskMark({
  state,
  unread = false,
}: {
  readonly state: TaskState;
  readonly unread?: boolean;
}): ReactElement | null {
  if (state === "done" && !unread) return null;

  return (
    <span
      role="img"
      aria-label={state === "done" ? "Unread" : taskLabel(state)}
      {...props(styles.statusDot, state === "done" ? styles.statusUnread : statusMarkStyle(state))}
    >
      {state === "done" && (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="currentColor"
          shapeRendering="crispEdges"
          {...props(surfaceTheme.blue, styles.unreadMark)}
        >
          <path d={MOON} />
        </svg>
      )}
      {(state === "working" || state === "retrying") && <Spinner />}
      {state === "waiting" && <Icon name="bubble-question" size="sm" variant="filled" />}
      {state === "background" && <Icon name="layers" size="sm" />}
      {state === "failed" && <Icon name="warning" size="sm" variant="filled" />}
    </span>
  );
}
