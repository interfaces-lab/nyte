import type { Row, RowKey } from "./transcript.ts";

export const WINDOW = { tail: 40, step: 60 } as const;

export type WindowStart =
  | { readonly kind: "tail" }
  | { readonly kind: "from"; readonly key: RowKey; readonly index: number };

export interface MountWindow {
  readonly start: number;
  readonly hidden: number;
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

export function mountWindow(
  rows: readonly Row[],
  weight: (row: Row) => number,
  start: WindowStart,
): MountWindow {
  const tail = tailStart(rows, weight, WINDOW.tail);

  if (start.kind === "tail") return { start: tail, hidden: tail };
  const found = rows.findIndex((row) => row.key === start.key);
  const anchored = Math.min(found === -1 ? start.index : found, tail);
  const first = Math.max(0, anchored);

  return { start: first, hidden: first };
}

export function revealEarlier(
  rows: readonly Row[],
  weight: (row: Row) => number,
  current: MountWindow,
): WindowStart {
  const start = tailStart(rows.slice(0, current.start), weight, WINDOW.step);
  const row = rows[start];

  return row === undefined ? { kind: "tail" } : { kind: "from", key: row.key, index: start };
}

export function anchorAt(rows: readonly Row[], current: MountWindow): WindowStart {
  const row = rows[current.start];

  return row === undefined
    ? { kind: "tail" }
    : { kind: "from", key: row.key, index: current.start };
}
