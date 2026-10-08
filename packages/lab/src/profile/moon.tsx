/**
 * The moon from `public/icon.svg`, redrawn on its own 12-cell grid so it can
 * take `currentColor`. Each row lists the columns that hold a cell.
 */
import type { ReactElement } from "react";

const LIT = [
  [4, 5, 6],
  [2, 3, 4, 5, 7],
  [1, 2, 3, 4, 5, 6, 7, 8],
  [1, 2, 3, 5, 7],
  [0, 1, 2, 3, 4, 5, 6, 8],
  [0, 1, 3, 5, 7],
  [0, 1, 2, 3, 4, 6, 8],
  [1, 3, 5],
  [1, 2, 4, 6],
  [1],
  [2],
] as const;

const SHADOW = [
  [7],
  [6, 8, 9],
  [9, 10],
  [4, 6, 8, 9, 10],
  [7, 9, 10, 11],
  [2, 4, 6, 8, 9, 10, 11],
  [5, 7, 9, 10, 11],
  [0, 2, 4, 6, 7, 8, 9, 10, 11],
  [3, 5, 7, 8, 9, 10],
  [2, 3, 4, 5, 6, 7, 8, 9, 10],
  [3, 4, 5, 6, 7, 8, 9],
  [4, 5, 6, 7],
] as const;

/* DERIVED: the icon draws a 29.3 cell on a 43.9 pitch. */
const CELL = 2 / 3;

function cells(rows: readonly (readonly number[])[]): string {
  return rows
    .flatMap((columns, row) =>
      columns.map((column) => `M${column} ${row}h${CELL}v${CELL}h-${CELL}z`),
    )
    .join("");
}

const LIT_PATH = cells(LIT);

const SHADOW_PATH = cells(SHADOW);

export function Moon({ size }: { readonly size: number }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${String(11 + CELL)} ${String(11 + CELL)}`}
      fill="currentColor"
    >
      <path d={SHADOW_PATH} opacity={0.22} />
      <path d={LIT_PATH} />
    </svg>
  );
}
