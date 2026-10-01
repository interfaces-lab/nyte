/** App-specific status marks and time labels, styled on the palette. */
import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, shape } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role } from "@nyte-ai/ui/vars.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { SessionMark } from "@nyte-ai/client";

/** The spinner's disc at full: 5 cells across on a 3px pitch. */
const MOON = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }))
  .filter(({ x, y }) => (x - 2) ** 2 + (y - 2) ** 2 < 6.25)
  .map(({ x, y }) => `M${x * 3} ${y * 3}h2v2h-2z`)
  .join("");

const pulse = keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
});

const styles = create({
  unreadMark: {
    flexShrink: 0,
    width: glyph.box,
    height: glyph.box,
    color: role.contentInteractiveTertiary,
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    // The spinner's loop, so an unread moon breathes at the pace a working one turns.
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
    borderRadius: shape.pill,
    flexShrink: 0,
    pointerEvents: "none",
  },
  statusSpinner: { width: glyph.box, height: glyph.box, color: role.contentSecondary },
  statusWaiting: {
    width: 14,
    height: 14,
    backgroundColor: "transparent",
    color: role.contentSecondary,
  },
  statusFailed: {
    width: 14,
    height: 14,
    backgroundColor: "transparent",
    color: role.contentSecondary,
  },
  statusIdle: { backgroundColor: "transparent" },
  statusUnread: { width: glyph.box, height: glyph.box, backgroundColor: "transparent" },
});

const STATUS_MARK_LABEL = {
  idle: "Idle",
  working: "Running",
  // `sessionMark` reports this only for a run parked on a reply. A run parked on
  // background work reads as running, because nothing is being asked of anyone.
  waiting: "Needs attention",
  retry: "Retrying",
  failed: "Failed",
} as const satisfies Readonly<Record<SessionMark, string>>;

function statusMarkStyle(mark: SessionMark) {
  switch (mark) {
    case "working":
      return [intent.primary, styles.statusSpinner];
    case "retry":
      return [intent.warning, styles.statusSpinner];
    case "waiting":
      return [intent.warning, styles.statusWaiting];
    case "failed":
      return [intent.danger, styles.statusFailed];
    case "idle":
      return styles.statusIdle;
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/**
 * One glyph per row state, distinguished by shape before colour: a spinner
 * while a run works, a question when it needs an answer, a warning when it
 * failed, and a full moon for a completion you have not read.
 */
export function StatusDot({
  mark,
  unread = false,
}: {
  mark: SessionMark;
  unread?: boolean;
}): ReactElement | null {
  if (mark === "idle" && !unread) return null;

  return (
    <span
      role="img"
      aria-label={mark === "idle" ? "Completed, unread" : STATUS_MARK_LABEL[mark]}
      {...props(styles.statusDot, mark === "idle" ? styles.statusUnread : statusMarkStyle(mark))}
    >
      {mark === "idle" && <UnreadMark />}
      {(mark === "working" || mark === "retry") && <Spinner />}
      {mark === "waiting" && <Icon name="bubble-question" size={14} variant="filled" />}
      {mark === "failed" && <Icon name="warning" size={14} variant="filled" />}
    </span>
  );
}

/** The spinner's moon come to full, pulsing: a completion nobody has read yet. */
export function UnreadMark(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 15 15"
      fill="currentColor"
      shapeRendering="crispEdges"
      {...props(surfaceTheme.blue, styles.unreadMark)}
    >
      <path d={MOON} />
    </svg>
  );
}

/** "2m ago" for lists; bare clock time within today. */
export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) return "now";

  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);

  if (days < 7) return `${String(days)}d`;

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
