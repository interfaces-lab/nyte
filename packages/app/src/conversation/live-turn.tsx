/**
 * The run's indicator below the transcript: while the head works and the
 * last drawn turn does not already end in a step group, a working line holds
 * the place its next step will take. Live parts are the turn's own messages.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../theme/schema.stylex.ts";
import { motion } from "@nyte-ai/ui/styles/vars.stylex";
import type { ToolCallDensity } from "../preferences/index.ts";
import { StepGroupView } from "./step-group.tsx";

/** Dimmed while core still holds the message behind a live run; full weight once it lands. */
const PENDING_OPACITY = 0.6;

const pendingIn = keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: PENDING_OPACITY, transform: "translateY(0)" },
});

export const liveTurnStyles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
  /**
   * A message waiting on a live run, drawn where its turn will be: muted so
   * it reads as sent without pretending the run already answered it.
   */
  pending: {
    opacity: PENDING_OPACITY,
    animationName: {
      default: pendingIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "180ms",
    animationTimingFunction: motion.easeOut,
  },
});

export function LiveTurn({
  working,
  settledWork,
  cwd,
  density,
}: {
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement | null {
  if (!working || settledWork) return null;

  return (
    <div {...props(liveTurnStyles.root)}>
      <StepGroupView messages={[]} cwd={cwd} added={0} removed={0} running density={density} />
    </div>
  );
}
