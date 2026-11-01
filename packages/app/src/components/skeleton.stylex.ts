import { create, keyframes } from "@stylexjs/stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

/** A load that finishes within this never shows a skeleton, so a fast one doesn't flash. */
const HOLD_MS = 150;

const PULSE_MS = 1600;

const hold = keyframes({
  from: { visibility: "hidden" },
  to: { visibility: "hidden" },
});

const pulse = keyframes({
  "0%, 100%": { opacity: 0.55 },
  "50%": { opacity: 1 },
});

/**
 * One look for every skeleton. `bone` fills a shape the caller sizes; `pulse` holds it hidden
 * briefly, then pulses. Put `pulse` on the group when there is one, so its bones share a phase.
 */
export const skeletonStyles = create({
  bone: { backgroundColor: role.bgMutedTranslucent },
  pulse: {
    animationName: {
      default: `${hold}, ${pulse}`,
      "@media (prefers-reduced-motion: reduce)": hold,
    },
    animationDuration: `${String(HOLD_MS)}ms, ${String(PULSE_MS)}ms`,
    animationDelay: `0ms, ${String(HOLD_MS)}ms`,
    animationIterationCount: "1, infinite",
    animationTimingFunction: "linear, ease-in-out",
  },
});
