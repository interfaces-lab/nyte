/**
 * The transcript as a flat list of rows for the virtualizer. Each row maps to
 * one element the thread screen used to render in flow; keys match the ones
 * those elements carried so React state (edits, folds) survives the move.
 */
import type { SessionView } from "@nyte-ai/sdk";
import type { ToolCallDensity } from "../preferences/index.ts";
import { CHANGES_VISIBLE_FILES } from "../workbench/change-tree.ts";
import { conversationTurns, isBusy, isToolMessage } from "../view-helpers.ts";
import type { ConversationTurn, UserMessage } from "../view-helpers.ts";
import { isTextMessage } from "./transcript-presentation.ts";

export type { ConversationTurn } from "../view-helpers.ts";

export type TranscriptRow =
  | { readonly kind: "skeleton"; readonly messageId: "row:skeleton"; readonly scrollAnchor: false }
  | { readonly kind: "error"; readonly messageId: "row:error"; readonly scrollAnchor: false }
  | {
      readonly kind: "turn";
      readonly messageId: string;
      readonly scrollAnchor: boolean;
      readonly turn: ConversationTurn;
      /**
       * Turns opened under this one without a prompt. A background report
       * opens its own turn, but the prompt it answers is this row's; drawing
       * them here keeps that prompt stuck above the work they hold.
       */
      readonly continuations: readonly ConversationTurn[];
      readonly trailing: boolean;
    }
  | {
      readonly kind: "landing";
      readonly messageId: string;
      readonly scrollAnchor: true;
      readonly message: UserMessage;
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
 * A landing prompt and the turn it opens are the same row: the message id is
 * minted before the network and kept until the commit, so the turn re-measures
 * the landing row instead of replacing it.
 */
function turnMessageId(turn: ConversationTurn): string {
  return turn.info.prompt === null ? `turn:${turn.info.id}` : `landing:${turn.info.prompt}`;
}

/**
 * Where each user message the view lists outside a turn draws: under the
 * transcript while it lands (muted behind a live run when it joined it), in
 * the tray while it waits for the next turn, or as an unsent row while its
 * journal entry retries.
 */
export function conversationMessages(view: SessionView | undefined) {
  const running = view !== undefined && isBusy(view.execution);
  const loose = view === undefined ? [] : conversationTurns(view).loose;
  const users = loose.filter((message): message is UserMessage => message.kind === "user");

  const landing = users.filter((message) => {
    switch (message.status.kind) {
      case "unsent":
        return message.status.retrying === null && !running;
      case "pending":
        return !running || message.status.schedule.kind === "joined";
      case "landed":
        return true;
      default: {
        const _exhaustive: never = message.status;

        return _exhaustive;
      }
    }
  });

  return {
    running,
    submitted: landing,
    queued: users.filter(
      (message) =>
        running && message.status.kind === "pending" && message.status.schedule.kind !== "joined",
    ),
    unsent: users.filter(
      (message) =>
        message.status.kind === "unsent" && (message.status.retrying !== null || running),
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
  running,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly ConversationTurn[];
  readonly landing: readonly UserMessage[];
  /** The retry status's title; absent while the run is not retrying. */
  readonly retrying: string | undefined;
  readonly working: boolean;
  readonly running: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (loading && turns.length === 0 && landing.length === 0) {
    rows.push({ kind: "skeleton", messageId: "row:skeleton", scrollAnchor: false });
  }

  if (failed) rows.push({ kind: "error", messageId: "row:error", scrollAnchor: false });

  for (const turn of turns) {
    const previous = rows.at(-1);

    if (previous?.kind === "turn" && turn.info.prompt === null) {
      rows[rows.length - 1] = { ...previous, continuations: [...previous.continuations, turn] };
      continue;
    }

    rows.push({
      kind: "turn",
      messageId: turnMessageId(turn),
      scrollAnchor: turn.info.prompt !== null,
      turn,
      continuations: [],
      trailing: false,
    });
  }

  const last = rows.at(-1);

  if (last?.kind === "turn") rows[rows.length - 1] = { ...last, trailing: true };

  for (const message of landing) {
    rows.push({
      kind: "landing",
      messageId: `landing:${message.id}`,
      scrollAnchor: true,
      message,
      pending: running,
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
      return row.continuations.reduce(
        (size, turn) => size + estimateTurnSize(turn, density, scale),
        estimateTurnSize(row.turn, density, scale),
      );
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}

function estimateTurnSize(turn: ConversationTurn, density: ToolCallDensity, scale: number): number {
  let size = 0;
  let prose = 0;
  let step = false;
  const files = new Set<string>();

  for (const message of turn.messages) {
    if (message.kind === "user") {
      size += USER_ROW_ESTIMATE;
      continue;
    }

    if (isTextMessage(message)) {
      prose += message.state.markdown.length;
      continue;
    }

    if (message.role === "step") step = true;

    if (isToolMessage(message) && message.state.phase === "settled")
      for (const path of message.state.changes?.paths ?? []) files.add(path);
  }

  if (step) size += STEP_GROUP_ESTIMATE[density];

  if (files.size > 0) {
    size +=
      CHANGES_CARD_BASE_ESTIMATE +
      CHANGES_CARD_ROW_ESTIMATE * Math.min(files.size, CHANGES_VISIBLE_FILES);
  }

  if (prose > 0) {
    size +=
      PROSE_BASE_ESTIMATE + PROSE_LINE_HEIGHT * Math.ceil((prose * scale) / PROSE_CHARS_PER_LINE);
  }

  return size;
}
