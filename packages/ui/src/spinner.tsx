import { create, keyframes, props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

import { glyph } from "./styles/schema.stylex.ts";
import { mergeStyleProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const CELLS = 5;

const PITCH = 3;

const SIZE = CELLS * PITCH;

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

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, frame) => frame);

const square = (frame: number) => (cell: { readonly x: number; readonly y: number }) =>
  `M${frame * SIZE + cell.x * PITCH} ${cell.y * PITCH}h${PITCH - 1}v${PITCH - 1}h-${PITCH - 1}z`;

const OUTLINE = FRAMES.flatMap((frame) => DISC.map(square(frame))).join("");

const LIT = FRAMES.flatMap((frame) => {
  const angle = (frame / FRAME_COUNT) * Math.PI * 2;

  return DISC.filter((cell) => {
    const shade =
      Math.sin(angle) * cell.nx - 0.18 * cell.ny - Math.cos(angle) * Math.sqrt(cell.depth);

    return shade * 16 > BAYER[(cell.y % 4) * 4 + (cell.x % 4)] + 0.5;
  }).map(square(frame));
}).join("");

const STILL_FRAME = 6;

const shift = (frame: number) => `translateX(${(-100 * frame) / FRAME_COUNT}%)`;

const phases = keyframes({ from: { transform: shift(0) }, to: { transform: shift(FRAME_COUNT) } });

const styles = create({
  root: {
    display: "inline-block",
    flexShrink: 0,
    width: glyph.box,
    height: glyph.box,
    overflow: "hidden",
    color: "inherit",
  },
  strip: {
    display: "block",
    width: `${FRAME_COUNT * 100}%`,
    height: "100%",
    transform: { default: null, "@media (prefers-reduced-motion: reduce)": shift(STILL_FRAME) },
    animationName: { default: phases, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: `${LOOP_MS}ms`,
    animationTimingFunction: `steps(${FRAME_COUNT})`,
    animationIterationCount: "infinite",
    animationDelay: "calc(0ms - var(--moon-sync, 0ms))",
  },
  sprite: { display: "block", width: "100%", height: "100%" },
  earthshine: { opacity: 0.22 },
});

export interface SpinnerProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"Spinner">;
}

export function Spinner({ className, style, xstyle }: SpinnerProps = {}): ReactElement {
  const root = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    root.current?.style.setProperty("--moon-sync", `${performance.now() % LOOP_MS}ms`);
  }, []);

  return (
    <span
      ref={root}
      aria-hidden="true"
      {...mergeStyleProps(props(styles.root, xstyle), className, style)}
    >
      <span {...props(styles.strip)}>
        <svg
          viewBox={`0 0 ${FRAME_COUNT * SIZE} ${SIZE}`}
          fill="currentColor"
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- React's name for the SVG shape-rendering attribute
          shapeRendering="crispEdges"
          {...props(styles.sprite)}
        >
          <path d={OUTLINE} {...props(styles.earthshine)} />
          <path d={LIT} />
        </svg>
      </span>
    </span>
  );
}
