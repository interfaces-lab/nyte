import type { Row, RowKey } from "./transcript.ts";

/**
 * Mount-window budgets, in row weight (a turn weighs its block count). `tail` is mounted while
 * following; `span` bounds the window while browsing history, so layout and re-wrap on resize
 * stay proportional to the viewport; `step` is how far one reveal moves the window.
 */
export const WINDOW = { tail: 40, span: 60, step: 30 } as const;

export type WindowStart =
  | { readonly kind: "tail" }
  | { readonly kind: "from"; readonly key: RowKey; readonly index: number };

/** The mounted rows: `rows.slice(start, end)`. */
export interface MountWindow {
  readonly start: number;
  readonly end: number;
}

function tailStart(rows: readonly Row[], weight: (row: Row) => number, budget: number): number {
  let total = 0;
  let start = rows.length;

  while (start > 0 && total < budget) {
    start -= 1;
    const row = rows[start];
    total += row === undefined ? 0 : weight(row);
  }

  return start;
}

function spanEnd(
  rows: readonly Row[],
  weight: (row: Row) => number,
  start: number,
  budget: number,
): number {
  let total = 0;
  let end = start;

  while (end < rows.length && total < budget) {
    const row = rows[end];
    total += row === undefined ? 0 : weight(row);
    end += 1;
  }

  return end;
}

export function mountWindow(
  rows: readonly Row[],
  weight: (row: Row) => number,
  start: WindowStart,
): MountWindow {
  const tail = tailStart(rows, weight, WINDOW.tail);

  if (start.kind === "tail") return { start: tail, end: rows.length };

  const found =
    rows[start.index]?.key === start.key
      ? start.index
      : rows.findIndex((row) => row.key === start.key);

  const first = Math.max(0, Math.min(found === -1 ? start.index : found, tail));
  const end = spanEnd(rows, weight, first, WINDOW.span);

  return { start: first, end: end >= tail ? rows.length : end };
}

function anchor(rows: readonly Row[], index: number): WindowStart {
  const row = rows[index];

  return row === undefined ? { kind: "tail" } : { kind: "from", key: row.key, index };
}

export function revealEarlier(
  rows: readonly Row[],
  weight: (row: Row) => number,
  current: MountWindow,
): WindowStart {
  return anchor(rows, tailStart(rows.slice(0, current.start), weight, WINDOW.step));
}

export function revealLater(
  rows: readonly Row[],
  weight: (row: Row) => number,
  current: MountWindow,
): WindowStart {
  return anchor(rows, Math.min(spanEnd(rows, weight, current.start, WINDOW.step), current.end));
}

export function anchorAt(rows: readonly Row[], current: MountWindow): WindowStart {
  return anchor(rows, current.start);
}
