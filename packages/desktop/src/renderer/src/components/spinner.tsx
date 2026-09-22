/**
 * Based on https://github.com/anomalyco/opencode/blob/bd54dc508f940e71aa07cd07a43ce57889c60a97/packages/ui/src/components/spinner.tsx
 * and packages/ui/src/styles/animations.css. Adapted to React and StyleX.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { glyph } from "../theme/schema.stylex.ts";

const pulse = keyframes({
  "0%": { opacity: 0.4 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.4 },
});

const pulseDim = keyframes({
  "0%": { opacity: 0.15 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 0.15 },
});

const outerIndices = new Set([1, 2, 4, 7, 8, 11, 13, 14]);

const cornerIndices = new Set([0, 3, 12, 15]);

const squares = Array.from({ length: 16 }, (_, index) => ({
  index,
  x: (index % 4) * 4,
  y: Math.floor(index / 4) * 4,
  delay: Math.random() * 1.5,
  duration: 1 + Math.random(),
})).filter((square) => !cornerIndices.has(square.index));

const styles = create({
  root: { flexShrink: 0, width: glyph.box, height: glyph.box, color: "inherit" },
  square: {
    opacity: 0.7,
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationFillMode: "both",
  },
  outer: {
    opacity: 0.25,
    animationName: { default: pulseDim, "@media (prefers-reduced-motion: reduce)": "none" },
  },
  timing: (delay: number, duration: number) => ({
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }),
});

export function Spinner(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 15 15" fill="currentColor" {...props(styles.root)}>
      {squares.map((square) => (
        <rect
          key={square.index}
          x={square.x}
          y={square.y}
          width="3"
          height="3"
          rx="1"
          {...props(
            styles.square,
            outerIndices.has(square.index) && styles.outer,
            styles.timing(square.delay, square.duration),
          )}
        />
      ))}
    </svg>
  );
}
