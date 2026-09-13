/**
 * The transcript as a flat list of rows for the virtualizer. Each row maps to
 * one element the thread screen used to render in flow; keys match the ones
 * those elements carried so React state (edits, folds) survives the move.
 */
import type { Turn, UserTurnPart } from "@nyte-ai/core";

export interface LandingMessage {
  readonly key: string;
  readonly content: UserTurnPart["content"];
}

export type TranscriptRow =
  | { readonly kind: "skeleton"; readonly key: "skeleton" }
  | { readonly kind: "error"; readonly key: "error" }
  | {
      readonly kind: "turn";
      readonly key: string;
      readonly turn: RenderedTurn;
      readonly trailing: boolean;
    }
  | { readonly kind: "landing"; readonly key: string; readonly content: UserTurnPart["content"] }
  | { readonly kind: "retry"; readonly key: "retry"; readonly message: string }
  | { readonly kind: "live"; readonly key: "live"; readonly working: boolean }
  /** Selections parked on this session; delegated sessions' are discovered by the row itself. */
  | { readonly kind: "selections"; readonly key: "selections"; readonly selections: number };

export function turnRowKey(turn: Turn): string {
  return turn.kind === "turn" ? turn.id : `${turn.kind}:${turn.commit}`;
}

/** A turn the transcript draws. A config turn can never reach a row. */
export type RenderedTurn = Exclude<Turn, { readonly kind: "config" }>;

/**
 * Config turns draw nothing: every turn already shows the model it ran with,
 * so a row for one reserved its estimated height and painted an empty band.
 * This is the transcript's single answer to which turns it renders; the thread
 * screen reads it too, so the run indicator agrees with the last drawn turn.
 */
export function rendersInTranscript(turn: Turn): turn is RenderedTurn {
  return turn.kind !== "config";
}

export function transcriptRows({
  loading,
  failed,
  turns,
  landing,
  retrying,
  working,
  selections,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly Turn[];
  readonly landing: readonly LandingMessage[];
  /** The retry banner's title; absent while the run is not retrying. */
  readonly retrying: string | undefined;
  readonly working: boolean;
  readonly selections: number;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const rendered = turns.filter(rendersInTranscript);
  if (loading && rendered.length === 0 && landing.length === 0) {
    rows.push({ kind: "skeleton", key: "skeleton" });
  }
  if (failed) rows.push({ kind: "error", key: "error" });
  for (const [index, turn] of rendered.entries()) {
    rows.push({
      kind: "turn",
      key: turnRowKey(turn),
      turn,
      trailing: index === rendered.length - 1,
    });
  }
  for (const message of landing) {
    rows.push({ kind: "landing", key: message.key, content: message.content });
  }
  if (retrying !== undefined) rows.push({ kind: "retry", key: "retry", message: retrying });
  rows.push({ kind: "live", key: "live", working });
  rows.push({ kind: "selections", key: "selections", selections });
  return rows;
}

/** How many prompts the reader has sent, whether landed or still in flight. */
export function promptRowCount(rows: readonly TranscriptRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.kind === "landing") count += 1;
    if (row.kind === "turn" && rowHasPrompt(row)) count += 1;
  }
  return count;
}

export function rowHasPrompt(row: TranscriptRow): boolean {
  if (row.kind === "landing") return true;
  if (row.kind !== "turn" || row.turn.kind !== "turn") return false;
  return row.turn.parts.some((part) => part.kind === "user");
}

const USER_ROW_ESTIMATE = 76;
const WORK_GROUP_ESTIMATE = 140;
const PROSE_BASE_ESTIMATE = 40;
const PROSE_LINE_HEIGHT = 22;
const PROSE_CHARS_PER_LINE = 90;
const RECORD_ROW_ESTIMATE = 40;
const LIVE_ROW_ESTIMATE = 60;
const SELECTION_CARD_ESTIMATE = 120;
const BANNER_ESTIMATE = 28;
const SKELETON_ESTIMATE = 240;

/**
 * A first guess at each row's height so unmeasured rows place their
 * neighbours roughly right. The parts of a turn add up: a prompt, one work
 * group, and prose sized by its text.
 */
export function estimateRowSize(row: TranscriptRow | undefined): number {
  if (row === undefined) return 0;
  switch (row.kind) {
    case "skeleton":
      return SKELETON_ESTIMATE;
    case "error":
    case "retry":
      return BANNER_ESTIMATE;
    case "landing":
      return USER_ROW_ESTIMATE;
    case "live":
      return row.working ? LIVE_ROW_ESTIMATE : 0;
    case "selections":
      return row.selections * SELECTION_CARD_ESTIMATE;
    case "turn":
      return estimateTurnSize(row.turn);
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

function estimateTurnSize(turn: Turn): number {
  if (turn.kind !== "turn") return RECORD_ROW_ESTIMATE;
  let size = 0;
  let prose = 0;
  let work = false;
  for (const part of turn.parts) {
    switch (part.kind) {
      case "user":
        size += USER_ROW_ESTIMATE;
        break;
      case "assistant":
        prose += part.text.length;
        break;
      case "thinking":
      case "tool":
        work = true;
        break;
      case "note":
        prose += part.text.length;
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  if (work) size += WORK_GROUP_ESTIMATE;
  if (prose > 0) {
    size += PROSE_BASE_ESTIMATE + PROSE_LINE_HEIGHT * Math.ceil(prose / PROSE_CHARS_PER_LINE);
  }
  return size;
}
