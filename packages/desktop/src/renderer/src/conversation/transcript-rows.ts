/**
 * The transcript as a flat list of rows for the virtualizer. Each row maps to
 * one element the thread screen used to render in flow; keys match the ones
 * those elements carried so React state (edits, folds) survives the move.
 */
import type { Delivery, SessionSnapshot, Turn, UserTurnPart } from "@nyte-ai/protocol";
import { isTerminalPhase } from "@nyte-ai/client";
import type { OutboxRow } from "@nyte-ai/client";
import type { ToolCallDensity } from "../theme/boot.ts";

interface LandingMessage {
  readonly key: string;
  readonly content: UserTurnPart["content"];
  /** Held behind a live run: drawn muted until the message lands. */
  readonly pending: boolean;
}

export type TranscriptRow =
  | { readonly kind: "skeleton"; readonly key: "row:skeleton" }
  | { readonly kind: "error"; readonly key: "row:error" }
  | {
      readonly kind: "turn";
      readonly key: string;
      readonly turn: RenderedTurn;
      readonly trailing: boolean;
    }
  | {
      readonly kind: "landing";
      readonly key: string;
      readonly content: UserTurnPart["content"];
      readonly pending: boolean;
    }
  | { readonly kind: "retry"; readonly key: "row:retry"; readonly message: string }
  | { readonly kind: "live"; readonly key: "row:live"; readonly working: boolean };

/**
 * A landing prompt and the turn it commits into are the same row. The outbox
 * mints a submission key, the landed change carries it back, and reusing it
 * here means the commit re-measures an existing row instead of replacing it —
 * which is what makes the transcript hold still mid-stream. A request opens
 * its turn, so the key is on the first part or the turn never carried one.
 */
function turnRowKey(turn: Turn): string {
  if (turn.kind !== "turn") return `turn:${turn.kind}:${turn.commit}`;
  const opening = turn.parts[0];

  return opening?.kind === "user" && opening.key !== undefined
    ? `landing:${opening.key}`
    : `turn:${turn.id}`;
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

export function conversationMessages({
  snapshot,
  unsent,
  steerDelivery,
}: {
  readonly snapshot: SessionSnapshot | undefined;
  readonly unsent: readonly OutboxRow[];
  readonly steerDelivery: Delivery;
}) {
  const running = snapshot?.run !== undefined && !isTerminalPhase(snapshot.run.phase);
  const represented = new Set<string>();

  for (const turn of snapshot?.transcript ?? []) {
    if (turn.kind !== "turn") continue;

    for (const part of turn.parts) {
      if (part.kind === "user" && part.key !== undefined) represented.add(part.key);
    }
  }

  const pending = snapshot?.pending ?? [];

  for (const item of pending) {
    if (item.key !== undefined) represented.add(item.key);
  }

  // The durable item arrives before its outbox row leaves; one key, one row.
  const local = unsent.filter((row) => !represented.has(row.key));

  // Whether a submitted message steers a live run or opens the next turn is
  // read from the snapshot alone, so one coherent read moves each message from
  // the outbox to `pending` to the transcript without a detour through the
  // composer strip. While a run is live only the boundary delivery draws here —
  // muted until it lands; the deliverys that wait for an idle head keep the tray.
  const landing: LandingMessage[] = [
    ...pending
      .filter((item) => !running || item.delivery === steerDelivery)
      .map((item) => ({
        // The receipt names the change; the key it carried keeps the same row.
        key: item.key ?? item.change,
        content: item.source?.label ?? item.content,
        pending: running,
      })),
    ...local
      .filter(
        (row) =>
          row.state.kind !== "retrying" && (!running || row.input.delivery === steerDelivery),
      )
      .map((row) => ({
        key: row.key,
        content: row.input.source?.label ?? row.input.content,
        pending: running,
      })),
  ];

  return {
    running,
    submitted: landing,
    queued: running ? pending.filter((item) => item.delivery !== steerDelivery) : [],
    unsent: local.filter(
      (row) => row.state.kind === "retrying" || (running && row.input.delivery !== steerDelivery),
    ),
  };
}

export function transcriptRows({
  loading,
  failed,
  turns,
  landing,
  retrying,
  working,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly Turn[];
  readonly landing: readonly LandingMessage[];
  /** The retry banner's title; absent while the run is not retrying. */
  readonly retrying: string | undefined;
  readonly working: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const rendered = turns.filter(rendersInTranscript);

  if (loading && rendered.length === 0 && landing.length === 0) {
    rows.push({ kind: "skeleton", key: "row:skeleton" });
  }

  if (failed) rows.push({ kind: "error", key: "row:error" });

  for (const [index, turn] of rendered.entries()) {
    rows.push({
      kind: "turn",
      key: turnRowKey(turn),
      turn,
      trailing: index === rendered.length - 1,
    });
  }

  for (const message of landing) {
    rows.push({
      kind: "landing",
      key: `landing:${message.key}`,
      content: message.content,
      pending: message.pending,
    });
  }

  if (retrying !== undefined) rows.push({ kind: "retry", key: "row:retry", message: retrying });
  rows.push({ kind: "live", key: "row:live", working });

  return rows;
}

const USER_ROW_ESTIMATE = 76;

/**
 * A work group's height depends on the density posture: compact settles to
 * the summary line and clips live work to a preview, detailed leaves the
 * whole list open. A turn's live state is unknown before it measures, so
 * the estimate splits those postures rather than guessing one number.
 */
const WORK_GROUP_ESTIMATE = {
  compact: 64,
  balanced: 140,
  detailed: 240,
} as const satisfies Record<ToolCallDensity, number>;

const PROSE_BASE_ESTIMATE = 40;

const PROSE_LINE_HEIGHT = 22;

const PROSE_CHARS_PER_LINE = 90;

const RECORD_ROW_ESTIMATE = 40;

const LIVE_ROW_ESTIMATE = 60;

const BANNER_ESTIMATE = 28;

const SKELETON_ESTIMATE = 240;

/**
 * A first guess at each row's height so unmeasured rows place their
 * neighbours roughly right. The parts of a turn add up: a prompt, one work
 * group, and prose sized by its text.
 */
export function estimateRowSize(row: TranscriptRow | undefined, density: ToolCallDensity): number {
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
    case "turn":
      return estimateTurnSize(row.turn, density);
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}

function estimateTurnSize(turn: Turn, density: ToolCallDensity): number {
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
      default: {
        const _exhaustive: never = part;

        return _exhaustive;
      }
    }
  }

  if (work) size += WORK_GROUP_ESTIMATE[density];

  if (prose > 0) {
    size += PROSE_BASE_ESTIMATE + PROSE_LINE_HEIGHT * Math.ceil(prose / PROSE_CHARS_PER_LINE);
  }

  return size;
}
