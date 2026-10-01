import { create, keyframes, props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

import { glyph } from "./schema.stylex.ts";
import { mergeStyleProps, type XStyle } from "./style.ts";

/*
 * The app icon's dithered moon, 5 cells across on a 3px pitch, with the sun
 * orbiting once per loop: new, waxing, full, waning. Unlit cells keep a trace
 * of earthshine so the disc holds its outline through the new moon.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const CELLS = 5;

const PITCH = 3;

const FRAME_COUNT = 16;

const FRAME_MS = 100;

const LOOP_MS = FRAME_COUNT * FRAME_MS;

const DISC = Array.from({ length: CELLS * CELLS }, (_, index) => {
  const x = index % CELLS;
  const y = Math.floor(index / CELLS);
  const nx = (x + 0.5 - CELLS / 2) / (CELLS / 2);
  const ny = (y + 0.5 - CELLS / 2) / (CELLS / 2);

  return { x, y, nx, ny, depth: 1 - nx * nx - ny * ny };
}).filter((cell) => cell.depth > 0);

const square = (cell: { readonly x: number; readonly y: number }) =>
  `M${cell.x * PITCH} ${cell.y * PITCH}h${PITCH - 1}v${PITCH - 1}h-${PITCH - 1}z`;

const OUTLINE = DISC.map(square).join("");

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, frame) => {
  const angle = (frame / FRAME_COUNT) * Math.PI * 2;

  return DISC.filter((cell) => {
    const shade =
      Math.sin(angle) * cell.nx - 0.18 * cell.ny - Math.cos(angle) * Math.sqrt(cell.depth);

    return shade * 16 > BAYER[(cell.y % 4) * 4 + (cell.x % 4)] + 0.5;
  })
    .map(square)
    .join("");
});

/** Shown under reduced motion: the waxing gibbous, which reads as a moon at rest. */
const STILL_FRAME = 6;

// One frame of sixteen is lit at a time.
const lit = keyframes({ "0%": { opacity: 1 }, "6.25%": { opacity: 0 }, "100%": { opacity: 0 } });

const styles = create({
  root: { flexShrink: 0, width: glyph.box, height: glyph.box, color: "inherit" },
  earthshine: { opacity: 0.22 },
  frame: {
    opacity: 0,
    animationName: { default: lit, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: `${LOOP_MS}ms`,
    animationTimingFunction: "step-end",
    animationIterationCount: "infinite",
    animationFillMode: "both",
  },
  still: { opacity: { default: 0, "@media (prefers-reduced-motion: reduce)": 1 } },
  delay: (frame: number) => ({
    animationDelay: `calc(${frame * FRAME_MS - LOOP_MS}ms - var(--moon-sync, 0ms))`,
  }),
});

export interface SpinnerProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

export function Spinner({ className, style, xstyle }: SpinnerProps = {}): ReactElement {
  const root = useRef<SVGSVGElement>(null);

  // Every spinner on screen shows the same phase.
  useLayoutEffect(() => {
    root.current?.style.setProperty("--moon-sync", `${performance.now() % LOOP_MS}ms`);
  }, []);

  return (
    <svg
      ref={root}
      aria-hidden="true"
      viewBox={`0 0 ${CELLS * PITCH} ${CELLS * PITCH}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      {...mergeStyleProps(props(styles.root, xstyle), className, style)}
    >
      <path d={OUTLINE} {...props(styles.earthshine)} />
      {FRAMES.map((d, frame) => (
        <path
          key={frame}
          d={d}
          {...props(styles.frame, frame === STILL_FRAME && styles.still, styles.delay(frame))}
        />
      ))}
    </svg>
  );
}
