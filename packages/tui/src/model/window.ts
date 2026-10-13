/**
 * Bounded mounting without heights. The transcript mounts a tail-first
 * window measured in row weight (a turn costs 1 plus 1 per expanded block),
 * never in estimated terminal rows. Yoga lays out what is mounted; rows
 * outside the window are not in the tree at all, and `viewportCulling` skips
 * drawing mounted rows that are off-screen.
 *
 * The window is anchored by row key, so a note inserted earlier, or a turn
 * removed, never resets the reader's place (it used to snap to the bottom).
 */
import type { Row, RowKey } from "./transcript.ts";

export const WINDOW = { tail: 40, step: 60 } as const;

/**
 * `tail` follows the end; `from` keeps the first mounted row stable while
 * reading history. `index` is where `key` was when the anchor was taken, the
 * fallback when that row has since vanished.
 */
export type WindowStart =
  | { readonly kind: "tail" }
  | { readonly kind: "from"; readonly key: RowKey; readonly index: number };

export interface MountWindow {
  /** Index of the first mounted row. Rows before it are summarised as "↑ N earlier". */
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

/** "Reveal earlier": move the start back by WINDOW.step weight. The Transcript keeps the viewport still. */
export function revealEarlier(
  rows: readonly Row[],
  weight: (row: Row) => number,
  current: MountWindow,
): WindowStart {
  const start = tailStart(rows.slice(0, current.start), weight, WINDOW.step);
  const row = rows[start];

  return row === undefined ? { kind: "tail" } : { kind: "from", key: row.key, index: start };
}

/** The anchor that keeps the current first row mounted while the reader is away from the end. */
export function anchorAt(rows: readonly Row[], current: MountWindow): WindowStart {
  const row = rows[current.start];

  return row === undefined
    ? { kind: "tail" }
    : { kind: "from", key: row.key, index: current.start };
}
