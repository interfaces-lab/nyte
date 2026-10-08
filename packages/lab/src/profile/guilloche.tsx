/**
 * Security print: two families of sine waves, one a half-phase behind the
 * other, so where they cross the page shows the moiré a forger can't copy.
 */
import type { ReactElement } from "react";

const WIDTH = 400;

const HEIGHT = 320;

const ROWS = 34;

/* DERIVED: a row pitch just under the swing of the waves, so neighbours braid instead of stacking. */
const PITCH = HEIGHT / ROWS;

function wave(row: number, phase: number): string {
  const points = Array.from({ length: WIDTH / 4 + 1 }, (_, step) => {
    const x = step * 4;
    const t = (x / WIDTH) * Math.PI * 2;

    const y =
      row * PITCH +
      7 * Math.sin(t * 1.5 + row * 0.38 + phase) +
      2.5 * Math.sin(t * 5 - row * 0.21 + phase);

    return `${String(x)} ${y.toFixed(1)}`;
  });

  return `M${points.join("L")}`;
}

const LINES = Array.from({ length: ROWS }, (_, row) => `${wave(row, 0)}${wave(row, Math.PI)}`).join(
  "",
);

export function Guilloche(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`0 ${String(-PITCH)} ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
    >
      <path
        d={LINES}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
