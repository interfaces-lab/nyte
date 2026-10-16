/**
 * The transcript as a flat list of rows for the virtualizer. Each row maps to
 * one element the thread screen used to render in flow; keys match the ones
 * those elements carried so React state (edits, folds) survives the move.
 */
import type { SessionView } from "@nyte-ai/sdk";
import type { ToolCallDensity } from "../preferences/index.ts";
import { CHANGES_VISIBLE_FILES } from "../workbench/change-tree.ts";
import { conversationTurns, isBusy, isToolMessage, sameItems } from "../view-helpers.ts";
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
      readonly continuations: readonly ConversationTurn[];
      readonly trailing: boolean;
    }
  | {
      readonly kind: "landing";
      readonly messageId: string;
      readonly scrollAnchor: true;
      readonly message: UserMessage;
      readonly pending: boolean;
      readonly held: boolean;
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

type TurnRow = Extract<TranscriptRow, { readonly kind: "turn" }>;

type LandingRow = Extract<TranscriptRow, { readonly kind: "landing" }>;

const SKELETON_ROW: TranscriptRow = {
  kind: "skeleton",
  messageId: "row:skeleton",
  scrollAnchor: false,
};

const ERROR_ROW: TranscriptRow = { kind: "error", messageId: "row:error", scrollAnchor: false };

const LIVE_ROWS = {
  working: { kind: "live", messageId: "row:live", scrollAnchor: false, working: true },
  idle: { kind: "live", messageId: "row:live", scrollAnchor: false, working: false },
} as const satisfies Record<string, TranscriptRow>;

const NO_TURNS: readonly ConversationTurn[] = [];

const NO_USERS: readonly UserMessage[] = [];

const turnRows = new WeakMap<ConversationTurn, TurnRow>();

const landingRows = new WeakMap<UserMessage, LandingRow>();

function turnMessageId(turn: ConversationTurn): string {
  return turn.info.prompt === null ? `turn:${turn.info.id}` : `landing:${turn.info.prompt}`;
}

/** The row a turn heads; the one built last time when nothing it shows has changed. */
function turnRow(
  turn: ConversationTurn,
  continuations: readonly ConversationTurn[],
  trailing: boolean,
): TurnRow {
  const known = turnRows.get(turn);

  if (
    known !== undefined &&
    known.trailing === trailing &&
    sameItems(known.continuations, continuations)
  )
    return known;

  const row: TurnRow = {
    kind: "turn",
    messageId: turnMessageId(turn),
    scrollAnchor: turn.info.prompt !== null,
    turn,
    continuations: continuations.length === 0 ? NO_TURNS : continuations,
    trailing,
  };

  turnRows.set(turn, row);

  return row;
}

function landingRow(message: UserMessage, pending: boolean, held: boolean): LandingRow {
  const known = landingRows.get(message);

  if (known !== undefined && known.pending === pending && known.held === held) return known;

  const row: LandingRow = {
    kind: "landing",
    messageId: `landing:${message.id}`,
    scrollAnchor: true,
    message,
    pending,
    held,
  };

  landingRows.set(message, row);

  return row;
}

function present(messages: readonly UserMessage[]): readonly UserMessage[] {
  return messages.length === 0 ? NO_USERS : messages;
}

export function conversationMessages(view: SessionView | undefined) {
  const running = view !== undefined && isBusy(view.execution);
  const loose = view === undefined ? [] : conversationTurns(view).loose;
  const users = loose.filter((message): message is UserMessage => message.kind === "user");

  const landing = users.filter((message) => {
    switch (message.status.kind) {
      case "unsent":
        return message.status.retrying === null && !running;
      case "pending":
        return (
          !running ||
          message.status.schedule.kind === "joined" ||
          message.source.kind === "child" ||
          message.source.kind === "job"
        );
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
    held: view?.execution.kind === "idle" && view.execution.lastRun?.end.kind !== "completed",
    submitted: present(landing),
    queued: present(
      users.filter(
        (message) =>
          running &&
          message.status.kind === "pending" &&
          message.status.schedule.kind !== "joined" &&
          message.source.kind !== "child" &&
          message.source.kind !== "job",
      ),
    ),
    unsent: present(
      users.filter(
        (message) =>
          message.status.kind === "unsent" && (message.status.retrying !== null || running),
      ),
    ),
  };
}

/**
 * The rows for one view. Rows whose content did not change since the last
 * call are the same objects, so memoized row views skip them while a reply
 * streams into the last one.
 */
export function transcriptRows({
  loading,
  failed,
  turns,
  landing,
  held,
  retrying,
  working,
  running,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly ConversationTurn[];
  readonly landing: readonly UserMessage[];
  readonly held: boolean;
  /** The retry status's title; absent while the run is not retrying. */
  readonly retrying: string | undefined;
  readonly working: boolean;
  readonly running: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (loading && turns.length === 0 && landing.length === 0) rows.push(SKELETON_ROW);

  if (failed) rows.push(ERROR_ROW);

  const groups: { readonly turn: ConversationTurn; readonly continuations: ConversationTurn[] }[] =
    [];

  for (const turn of turns) {
    const group = groups.at(-1);

    if (group !== undefined && turn.info.prompt === null) group.continuations.push(turn);
    else groups.push({ turn, continuations: [] });
  }

  for (const [index, group] of groups.entries())
    rows.push(turnRow(group.turn, group.continuations, index === groups.length - 1));

  for (const message of landing) rows.push(landingRow(message, running, held));

  if (retrying !== undefined) {
    rows.push({ kind: "retry", messageId: "row:retry", scrollAnchor: false, message: retrying });
  }

  rows.push(working ? LIVE_ROWS.working : LIVE_ROWS.idle);

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
