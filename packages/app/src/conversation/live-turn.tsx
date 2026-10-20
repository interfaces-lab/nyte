import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { conversation } from "../theme/schema.stylex.ts";
import { motion } from "@nyte-ai/ui/styles/vars.stylex";
import type { ToolCallDensity } from "../preferences/index.ts";
import { StepGroupView } from "./step-group.tsx";

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
