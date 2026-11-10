import type { Failure, Message, TurnId, TurnInfo } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";
import {
  runMark,
  runStatus,
  showsAnswer,
  showsReport,
  showsTool,
  taskLabel,
} from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { MIN_REPORTED_DURATION_MS } from "../lib/constants.ts";
import { unlandedMessages } from "../lib/view-helpers.ts";
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

export type Row =
  | { readonly kind: "turn"; readonly key: RowKey; readonly turn: TurnModel }
  | PromptRow
  | { readonly kind: "shell"; readonly key: RowKey; readonly job: ShellJob };

export interface TranscriptModel {
  readonly rows: readonly Row[];
  /** The keys of the mounted rows, `rows.slice(window.start, window.end)`, in order. */
  readonly visible: readonly RowKey[];
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

export function rowWeight(row: Row): number {
  return row.kind === "turn" ? Math.max(1, row.turn.blocks.length) : 1;
}

export function deriveTranscript(
  view: HeadView | null,
  shells: readonly ShellJob[],
  local: TranscriptLocal,
): TranscriptModel {
  const timed = view === null ? [] : turnRows(withWholeTools(view, local));

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

      if (job !== undefined) rows.push({ kind: "shell", key: `shell:${job.id}`, job });
      next += 1;
    }

    rows.push(row);
  }

  for (const job of jobs.slice(next)) rows.push({ kind: "shell", key: `shell:${job.id}`, job });

  const window = mountWindow(rows, rowWeight, local.window);

  return {
    rows,
    visible: rows.slice(window.start, window.end).map((row) => row.key),
    window,
    following: local.following,
    toolOutput: local.toolOutput,
    disclosures: local.disclosures,
    reportsHeld: view?.reportsHeld ?? false,
  };
}

function withWholeTools(view: HeadView, local: TranscriptLocal): HeadView {
  if (local.toolOutput === "collapsed" || local.wholeTools.size === 0) return view;

  return {
    ...view,
    messages: view.messages.map((message) => {
      const state = message.kind === "part" ? local.wholeTools.get(message.part) : undefined;

      return state === undefined ? message : { ...message, state };
    }),
  };
}

function turnRows(view: HeadView): readonly Row[] {
  const indexes = new Map(view.turns.map((info, index) => [info.id, index]));
  const first = Math.min(firstReachedTurn(view.messages, indexes), view.turns.length - 1);
  const count = view.turns.length - Math.max(0, first);
  const blocks = Array.from({ length: count }, (): Message[] | null => null);
  let current: TurnId | null = null;
  let slot = -1;

  for (const message of view.leadingPrompt === null
    ? view.messages
    : [view.leadingPrompt, ...view.messages]) {
    if (
      showsTool(message) &&
      message.state.class.kind === "delegate" &&
      message.state.class.role === "await"
    )
      continue;

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
    const built = blocks[index - first] ?? NO_BLOCKS;

    if (built.length === 0 && (info.state.kind === "ended" || info.run === null)) continue;

    rows.push({
      kind: "turn",
      key: `turn:${info.id}`,
      turn: {
        info,
        blocks: built,
        status: turnStatus(info, built, view),
        clipped: view.leadingPrompt?.turn === info.id,
      },
    });
  }

  const pending = view.execution.kind !== "idle";
  const unlanded = unlandedMessages(view.messages);

  const waiting = [
    ...unlanded.filter((message) => !showsReport(message) && !showsAnswer(message)),
    ...unlanded.filter(showsReport),
    ...unlanded.filter(showsAnswer),
  ];

  for (const message of waiting)
    rows.push({ kind: "prompt", key: `prompt:${message.id}`, message, pending });

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

export function turnStatus(
  info: TurnInfo,
  blocks: readonly Message[],
  view: HeadView,
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
      return info.state.on.kind === "part"
        ? { kind: "waiting", question: true }
        : { kind: "working", activity: taskLabel(runMark(runStatus(execution))), startedAt };
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
      const streaming = last?.kind === "part" && last.status.kind === "live";

      if (streaming && last.partKind === "thinking") return { kind: "thinking", startedAt };

      return {
        kind: "working",
        activity:
          info.state.activity ?? (streaming ? taskLabel(runMark(runStatus(execution))) : null),
        startedAt,
      };
    }

    default: {
      const _exhaustive: never = info.state;

      return _exhaustive;
    }
  }
}
