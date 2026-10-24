import type { Failure, Message, SessionView, TurnId, TurnInfo } from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { MIN_REPORTED_DURATION_MS } from "../lib/constants.ts";
import { promptMessages, pendingReports } from "../lib/view-helpers.ts";
import type { ShellJob, TranscriptLocal } from "./state.ts";
import { mountWindow } from "./window.ts";
import type { MountWindow } from "./window.ts";

export type RowKey = string;

export interface PromptRow {
  readonly kind: "prompt";
  readonly key: RowKey;
  readonly message: UserMessage;
  readonly pending: boolean;
}

/** One transcript row. A row carries its content, and an unchanged row keeps its identity across frames. */
export type Row =
  | { readonly kind: "turn"; readonly key: RowKey; readonly turn: TurnModel }
  | PromptRow
  | { readonly kind: "shell"; readonly key: RowKey; readonly job: ShellJob };

export interface TranscriptModel {
  readonly rows: readonly Row[];
  readonly window: MountWindow;
  readonly following: boolean;
  readonly toolOutput: "collapsed" | "expanded";
  readonly disclosures: ReadonlySet<string>;
  readonly reportsHeld: boolean;
}

export interface TurnModel {
  readonly info: TurnInfo;
  readonly blocks: readonly Message[];
  readonly status: TurnStatus | null;
  /** Whether steps between the turn's prompt and its next block are not loaded. */
  readonly clipped: boolean;
}

export type TurnStatus =
  | { readonly kind: "unanswered" }
  | { readonly kind: "working"; readonly activity: string | null; readonly startedAt: number }
  | { readonly kind: "thinking"; readonly startedAt: number }
  | { readonly kind: "waiting"; readonly question: boolean }
  | {
      readonly kind: "retrying";
      readonly until: number;
      readonly reason: string;
      readonly attempt: number;
    }
  | {
      readonly kind: "settled";
      readonly durationMs: number | null;
      readonly failure: Failure | null;
      readonly stopped: boolean;
    };

const STOPPED: Failure = { class: "aborted", message: "Run stopped." };

const NO_BLOCKS: readonly Message[] = [];

const AWAITS_DELEGATE = new WeakMap<Message, boolean>();

const TURN_INDEXES = new WeakMap<readonly TurnInfo[], ReadonlyMap<TurnId, number>>();

const TURN_MODELS = new WeakMap<TurnInfo, TurnModel>();

const TURN_ROWS = new WeakMap<TurnModel, Row>();

const MESSAGE_ROWS = new WeakMap<Message, Row>();

const SHELL_ROWS = new WeakMap<ShellJob, Row>();

export function rowWeight(row: Row): number {
  return row.kind === "turn" ? Math.max(1, row.turn.blocks.length) : 1;
}

/**
 * Derives the transcript rows for one frame.
 *
 * Work is bounded by the view's message tail: only turns the tail reaches are visited, settled
 * turns and rows are reused by identity, and only a turn whose info, blocks or status changed
 * gets a new model.
 */
export function deriveTranscript(
  view: SessionView | null,
  shells: readonly ShellJob[],
  local: TranscriptLocal,
  previous: TranscriptModel | null,
): TranscriptModel {
  const timed = view === null ? [] : turnRows(view);

  const jobs = shells.toSorted(
    (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id),
  );

  const rows: Row[] = [];
  let next = 0;

  for (const row of timed) {
    const at =
      row.kind === "turn"
        ? row.turn.info.startedAt
        : row.kind === "shell"
          ? row.job.startedAt
          : row.message.at;

    while (next < jobs.length && (jobs[next]?.startedAt ?? Infinity) < at) {
      const job = jobs[next];

      if (job !== undefined) rows.push(shellRow(job));
      next += 1;
    }

    rows.push(row);
  }

  for (const job of jobs.slice(next)) rows.push(shellRow(job));

  const kept =
    previous !== null &&
    previous.rows.length === rows.length &&
    previous.rows.every((row, index) => row === rows[index])
      ? previous.rows
      : rows;

  const window = mountWindow(kept, rowWeight, local.window);

  return {
    rows: kept,
    window:
      previous !== null &&
      previous.window.start === window.start &&
      previous.window.end === window.end
        ? previous.window
        : window,
    following: local.following,
    toolOutput: local.toolOutput,
    disclosures: local.disclosures,
    reportsHeld: view?.reportsHeld ?? false,
  };
}

function turnRows(view: SessionView): readonly Row[] {
  const indexes = readTurnIndexes(view.turns);
  const first = Math.min(firstReachedTurn(view.messages, indexes), view.turns.length - 1);
  const count = view.turns.length - Math.max(0, first);
  const blocks = Array.from({ length: count }, (): Message[] | null => null);
  let current: TurnId | null = null;
  let slot = -1;

  for (const message of view.leadingPrompt === null
    ? view.messages
    : [view.leadingPrompt, ...view.messages]) {
    if (message.kind === "part" && message.partKind === "tool" && awaitsDelegate(message)) continue;

    if (message.turn !== current) {
      current = message.turn;
      const index = indexes.get(current);
      slot = index === undefined ? -1 : index - first;
    }

    if (slot < 0) continue;
    const held = blocks[slot] ?? [];
    held.push(message);
    blocks[slot] = held;
  }

  const rows: Row[] = [];

  for (let index = Math.max(0, first); index < view.turns.length; index += 1) {
    const info = view.turns[index];

    if (info === undefined) continue;
    const turn = turnModel(info, blocks[index - first] ?? NO_BLOCKS, view);

    if (turn.blocks.length === 0 && (info.state.kind === "ended" || info.run === null)) continue;
    rows.push(turnRow(turn));
  }

  const pending = view.execution.kind !== "idle";

  for (const message of [...promptMessages(view), ...pendingReports(view)])
    rows.push(messageRow(message, pending));

  return rows;
}

function firstReachedTurn(
  messages: readonly Message[],
  indexes: ReadonlyMap<TurnId, number>,
): number {
  let first = Infinity;
  let turn: TurnId | null = null;

  for (const message of messages) {
    if (message.turn === turn) continue;
    turn = message.turn;
    first = Math.min(first, indexes.get(turn) ?? Infinity);
  }

  return first;
}

function readTurnIndexes(turns: readonly TurnInfo[]): ReadonlyMap<TurnId, number> {
  const known = TURN_INDEXES.get(turns);

  if (known !== undefined) return known;
  const indexes = new Map(turns.map((info, index) => [info.id, index]));
  TURN_INDEXES.set(turns, indexes);

  return indexes;
}

function awaitsDelegate(message: Message): boolean {
  const known = AWAITS_DELEGATE.get(message);

  if (known !== undefined) return known;

  const awaits =
    showsTool(message) &&
    message.state.class.kind === "delegate" &&
    message.state.class.role === "await";

  AWAITS_DELEGATE.set(message, awaits);

  return awaits;
}

function turnModel(info: TurnInfo, built: readonly Message[], view: SessionView): TurnModel {
  const before = TURN_MODELS.get(info);

  const blocks =
    before !== undefined &&
    before.blocks.length === built.length &&
    before.blocks.every((message, index) => message === built[index])
      ? before.blocks
      : built;

  const clipped = view.leadingPrompt?.turn === info.id;
  const kept = before !== undefined && before.blocks === blocks && before.clipped === clipped;

  if (kept && info.state.kind === "ended") return before;
  const status = turnStatus(info, blocks, view);

  if (kept && sameStatus(before.status, status)) return before;
  const model = { info, blocks, status, clipped };
  TURN_MODELS.set(info, model);

  return model;
}

function sameStatus(left: TurnStatus | null, right: TurnStatus | null): boolean {
  if (left === null || right === null) return left === right;

  switch (left.kind) {
    case "unanswered":
      return right.kind === "unanswered";
    case "working":
      return (
        right.kind === "working" &&
        right.activity === left.activity &&
        right.startedAt === left.startedAt
      );
    case "thinking":
      return right.kind === "thinking" && right.startedAt === left.startedAt;
    case "waiting":
      return right.kind === "waiting" && right.question === left.question;
    case "retrying":
      return (
        right.kind === "retrying" &&
        right.until === left.until &&
        right.reason === left.reason &&
        right.attempt === left.attempt
      );
    case "settled":
      return (
        right.kind === "settled" &&
        right.durationMs === left.durationMs &&
        right.failure === left.failure &&
        right.stopped === left.stopped
      );
    default: {
      const _exhaustive: never = left;

      return _exhaustive;
    }
  }
}

function turnRow(turn: TurnModel): Row {
  const known = TURN_ROWS.get(turn);

  if (known !== undefined) return known;
  const row: Row = { kind: "turn", key: `turn:${turn.info.id}`, turn };
  TURN_ROWS.set(turn, row);

  return row;
}

function messageRow(message: UserMessage, pending: boolean): Row {
  const known = MESSAGE_ROWS.get(message);

  if (known?.kind === "prompt" && known.pending === pending) return known;
  const row: Row = { kind: "prompt", key: `prompt:${message.id}`, message, pending };
  MESSAGE_ROWS.set(message, row);

  return row;
}

function shellRow(job: ShellJob): Row {
  const known = SHELL_ROWS.get(job);

  if (known !== undefined) return known;
  const row: Row = { kind: "shell", key: `shell:${job.id}`, job };
  SHELL_ROWS.set(job, row);

  return row;
}

export function turnStatus(
  info: TurnInfo,
  blocks: readonly Message[],
  view: SessionView,
): TurnStatus | null {
  const live = view.turns.at(-1)?.id === info.id;
  const { execution } = view;

  const startedAt =
    live && execution.kind !== "idle" && execution.run.id === info.run
      ? execution.run.startedAt
      : info.startedAt;

  switch (info.state.kind) {
    case "ended": {
      if (blocks.length === 0) return null;
      const { end } = info.state;
      const duration = info.endedAt === null ? null : info.endedAt - info.startedAt;

      return {
        kind: "settled",
        durationMs: duration !== null && duration >= MIN_REPORTED_DURATION_MS ? duration : null,
        failure: end.kind === "failed" ? end.failure : end.kind === "stopped" ? STOPPED : null,
        stopped: end.kind === "stopped",
      };
    }

    case "waiting":
      return info.state.on.kind === "part" || openQuestions(view).length > 0
        ? { kind: "waiting", question: true }
        : { kind: "working", activity: null, startedAt };
    case "working": {
      if (info.run === null)
        return blocks.some((message) => message.kind === "user") ? { kind: "unanswered" } : null;

      if (live && execution.kind === "retrying")
        return {
          kind: "retrying",
          until: execution.until,
          reason: execution.reason,
          attempt: execution.run.attempt,
        };
      const last = blocks.at(-1);

      if (last?.kind === "part" && last.partKind === "thinking" && last.status.kind === "live")
        return { kind: "thinking", startedAt };

      return { kind: "working", activity: info.state.activity, startedAt };
    }

    default: {
      const _exhaustive: never = info.state;

      return _exhaustive;
    }
  }
}
