import { motion, useAnimationFrame, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { discCells, moonLevel, type MoonState } from "./dither";

/* TUI dark theme roles: the lab page paints on the terminal's ground. */
export const STATE_COLOR = {
  working: "#08c0ef",
  thinking: "#9d6afb",
  retrying: "#ffca00",
  compacting: "#d4d4d4",
  waiting: "#ffca00",
  done: "#07c480",
  failed: "#ff2e3f",
  stopped: "#737373",
} as const satisfies Readonly<Record<MoonState, string>>;

/** Dither frames step like the TUI spinner rather than tweening between them. */
const FRAME_MS = 80;

/** One Bayer rank per step: the whole disc turns over in 16 steps. */
const DISSOLVE_STEP_S = 0.028;

const OPACITY = [0, 0.22, 1] as const;

function useStateClock(state: MoonState) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  const since = useRef({ state, at: 0 });

  useAnimationFrame((time) => {
    if (since.current.state !== state) since.current = { state, at: time };
    if (reduced) return;
    const next = Math.floor((time - since.current.at) / FRAME_MS);
    if (next !== frame) setFrame(next);
  });

  return (frame * FRAME_MS) / 1000;
}

export function Moon({
  state,
  cells,
  pitch,
  gap = 1,
}: {
  readonly state: MoonState;
  readonly cells: number;
  readonly pitch: number;
  readonly gap?: number;
}) {
  const disc = useMemo(() => discCells(cells), [cells]);
  const t = useStateClock(state);
  const size = cells * pitch;
  const color = STATE_COLOR[state];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      {disc.map((cell) => (
        <motion.rect
          key={`${cell.x}:${cell.y}`}
          x={cell.x * pitch}
          y={cell.y * pitch}
          width={pitch - gap}
          height={pitch - gap}
          initial={false}
          animate={{ opacity: OPACITY[moonLevel(state, cell, t, cells)], fill: color }}
          transition={{
            // A new state lands in Bayer order; once landed, frames step in place.
            opacity: { duration: 0.09, delay: Math.max(0, cell.order * DISSOLVE_STEP_S - t) },
            fill: { duration: 0.12, delay: cell.order * DISSOLVE_STEP_S },
          }}
        />
      ))}
    </svg>
  );
}

const DOTS = [
  [0x1, 0x8],
  [0x2, 0x10],
  [0x4, 0x20],
  [0x40, 0x80],
] as const;

const FULL_DISC = discCells(4);

/** Two braille columns carry a 4 by 4 disc: the TUI's one-row status glyph. */
export function brailleMoon(state: MoonState, t: number): string {
  const codes = [0, 0];

  for (const cell of FULL_DISC) {
    // Braille has no half tone, so a moon with no light shows its outline instead.
    const shown = state === "stopped" || moonLevel(state, cell, t, 4) === 2;
    if (shown) codes[cell.x >> 1] |= DOTS[cell.y][cell.x & 1];
  }

  return codes.map((code) => String.fromCodePoint(0x2800 + code)).join("");
}

export function BrailleMoon({ state }: { readonly state: MoonState }) {
  const t = useStateClock(state);

  return <span style={{ color: STATE_COLOR[state] }}>{brailleMoon(state, t)}</span>;
}
