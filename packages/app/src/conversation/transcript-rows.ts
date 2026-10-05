/**
 * The transcript as a flat list of rows for the virtualizer. Each row maps to
 * one element the thread screen used to render in flow; keys match the ones
 * those elements carried so React state (edits, folds) survives the move.
 */
import type { Delivery, SessionSnapshot, Turn, UserTurnPart } from "@nyte-ai/protocol";
import { changesFromTurns, isTerminalPhase } from "@nyte-ai/client";
import type { OutboxRow } from "@nyte-ai/client";
import type { ToolCallDensity } from "../theme/boot.ts";
import { CHANGES_VISIBLE_FILES } from "../workbench/change-tree.ts";

interface LandingMessage {
  readonly key: string;
  readonly content: UserTurnPart["content"];
  /** Held behind a live run: drawn muted until the message lands. */
  readonly pending: boolean;
}

export type TranscriptRow =
  | { readonly kind: "skeleton"; readonly messageId: "row:skeleton"; readonly scrollAnchor: false }
  | { readonly kind: "error"; readonly messageId: "row:error"; readonly scrollAnchor: false }
  | {
      readonly kind: "turn";
      readonly messageId: string;
      readonly scrollAnchor: boolean;
      readonly turn: RenderedTurn;
      readonly trailing: boolean;
    }
  | {
      readonly kind: "landing";
      readonly messageId: string;
      readonly scrollAnchor: true;
      readonly content: UserTurnPart["content"];
      readonly pending: boolean;
    }
  | {
      readonly kind: "retry";
      readonly messageId: "row:retry";
      readonly scrollAnchor: false;
      readonly message: string;
    }
  | {
      readonly kind: "live";
      readonly messageId: "row:live";
      readonly scrollAnchor: false;
      readonly working: boolean;
    };

/**
 * A landing prompt and the turn it commits into are the same row. The outbox
 * mints a submission key, the landed change carries it back, and reusing it
 * here means the commit re-measures an existing row instead of replacing it —
 * which is what makes the transcript hold still mid-stream. A request opens
 * its turn, so the key is on the first part or the turn never carried one.
 */
function turnMessageId(turn: Turn): string {
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
  /** The retry status's title; absent while the run is not retrying. */
  readonly retrying: string | undefined;
  readonly working: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const rendered = turns.filter(rendersInTranscript);

  if (loading && rendered.length === 0 && landing.length === 0) {
    rows.push({ kind: "skeleton", messageId: "row:skeleton", scrollAnchor: false });
  }

  if (failed) rows.push({ kind: "error", messageId: "row:error", scrollAnchor: false });

  for (const [index, turn] of rendered.entries()) {
    rows.push({
      kind: "turn",
      messageId: turnMessageId(turn),
      scrollAnchor: turn.kind === "turn" && turn.parts.some((part) => part.kind === "user"),
      turn,
      trailing: index === rendered.length - 1,
    });
  }

  for (const message of landing) {
    rows.push({
      kind: "landing",
      messageId: `landing:${message.key}`,
      scrollAnchor: true,
      content: message.content,
      pending: message.pending,
    });
  }

  if (retrying !== undefined) {
    rows.push({ kind: "retry", messageId: "row:retry", scrollAnchor: false, message: retrying });
  }

  rows.push({ kind: "live", messageId: "row:live", scrollAnchor: false, working });

  return rows;
}

const USER_ROW_ESTIMATE = 76;

/**
 * A step group's height depends on the density posture: compact settles to
 * the summary line and clips live work to a preview, detailed leaves the
 * whole list open. A turn's live state is unknown before it measures, so
 * the estimate splits those postures rather than guessing one number.
 */
const STEP_GROUP_ESTIMATE = {
  compact: 64,
  balanced: 140,
  detailed: 240,
} as const satisfies Record<ToolCallDensity, number>;

const PROSE_BASE_ESTIMATE = 40;

const PROSE_LINE_HEIGHT = 24;

const PROSE_CHARS_PER_LINE = 90;

const CHANGES_CARD_BASE_ESTIMATE = 50;

const CHANGES_CARD_ROW_ESTIMATE = 30;

const RECORD_ROW_ESTIMATE = 40;

const LIVE_ROW_ESTIMATE = 60;

const BANNER_ESTIMATE = 28;

const SKELETON_ESTIMATE = 240;

const ESTIMATE_FONT_SIZE = 13;

/**
 * A first guess at each row's height so unmeasured rows place their
 * neighbours roughly right. The parts of a turn add up: a prompt, one work
 * group, and prose sized by its text.
 */
export function estimateRowSize(
  row: TranscriptRow | undefined,
  density: ToolCallDensity,
  uiFontSize: number,
): number {
  const scale = uiFontSize / ESTIMATE_FONT_SIZE;

  return scale * rowEstimate(row, density, scale);
}

function rowEstimate(
  row: TranscriptRow | undefined,
  density: ToolCallDensity,
  scale: number,
): number {
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
      return estimateTurnSize(row.turn, density, scale);
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}

function estimateTurnSize(turn: Turn, density: ToolCallDensity, scale: number): number {
  if (turn.kind !== "turn") return RECORD_ROW_ESTIMATE;
  let size = 0;
  let prose = 0;
  let step = false;

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
        step = true;
        break;
      default: {
        const _exhaustive: never = part;

        return _exhaustive;
      }
    }
  }

  if (step) size += STEP_GROUP_ESTIMATE[density];
  const files = changesFromTurns([turn]).length;

  if (files > 0) {
    size +=
      CHANGES_CARD_BASE_ESTIMATE +
      CHANGES_CARD_ROW_ESTIMATE * Math.min(files, CHANGES_VISIBLE_FILES);
  }

  if (prose > 0) {
    size +=
      PROSE_BASE_ESTIMATE + PROSE_LINE_HEIGHT * Math.ceil((prose * scale) / PROSE_CHARS_PER_LINE);
  }

  return size;
}
