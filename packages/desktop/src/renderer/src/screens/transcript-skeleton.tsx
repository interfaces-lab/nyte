/**
 * The transcript's shape while a session's snapshot is still on its way:
 * a user card, a work row, and a prose block at the transcript's row gaps so
 * the real rows land in place without a shift. Local sessions resolve in a
 * frame or two and never show it; cloud sessions do.
 */
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

const pulse = stylex.keyframes({
  "0%": { opacity: 0.55 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.55 },
});

const styles = stylex.create({
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    animationName: pulse,
    animationDuration: {
      default: "1.6s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  turn: { display: "flex", flexDirection: "column", gap: conversation.rowGap },
  card: {
    boxSizing: "border-box",
    height: 58,
    marginTop: 10,
    borderRadius: t.radiusXl,
    backgroundColor: t.fillGhostHover,
  },
  line: (width: string) => ({
    width,
    height: 12,
    borderRadius: t.radiusFull,
    backgroundColor: t.fillGhostHover,
  }),
  row: { display: "flex", flexDirection: "column", gap: 10, paddingBlock: 6 },
});

/** Placeholder rows; the caller supplies the transcript's measure and gutter. */
export function TranscriptSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Loading chat" {...stylex.props(styles.rows)}>
      <div {...stylex.props(styles.turn)}>
        <div {...stylex.props(styles.card)} />
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.line("28%"))} />
          <div {...stylex.props(styles.line("92%"))} />
          <div {...stylex.props(styles.line("84%"))} />
          <div {...stylex.props(styles.line("61%"))} />
        </div>
      </div>
      <div {...stylex.props(styles.turn)}>
        <div {...stylex.props(styles.card)} />
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.line("36%"))} />
          <div {...stylex.props(styles.line("88%"))} />
          <div {...stylex.props(styles.line("47%"))} />
        </div>
      </div>
    </div>
  );
}
