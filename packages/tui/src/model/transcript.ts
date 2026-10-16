import type {
  Execution,
  Failure,
  Message,
  MessageId,
  SessionView,
  TurnId,
  TurnInfo,
} from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { MIN_REPORTED_DURATION_MS } from "../lib/constants.ts";
import { isToolMessage, landingMessages, pendingReports } from "../lib/view-helpers.ts";
import type { ShellJob, TranscriptLocal } from "./state.ts";
import { mountWindow } from "./window.ts";
import type { MountWindow } from "./window.ts";

export type RowKey = string;

export type Row =
  | { readonly kind: "turn"; readonly key: RowKey; readonly turn: TurnId }
  | { readonly kind: "note"; readonly key: RowKey; readonly message: MessageId }
  | { readonly kind: "landing"; readonly key: RowKey; readonly message: MessageId }
  | { readonly kind: "shell"; readonly key: RowKey; readonly job: string };

export interface TranscriptModel {
  readonly rows: readonly Row[];
  readonly turns: ReadonlyMap<TurnId, TurnModel>;
  readonly messages: ReadonlyMap<MessageId, Message>;
  readonly shells: ReadonlyMap<string, ShellJob>;
  readonly window: MountWindow;
  readonly following: boolean;
  readonly toolOutput: "collapsed" | "expanded";
  readonly disclosures: ReadonlySet<string>;
  readonly execution: Execution | null;
}

export interface TurnModel {
  readonly info: TurnInfo;
  readonly blocks: readonly MessageId[];
  readonly status: TurnStatus | null;
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

export function rowWeight(row: Row, turns: ReadonlyMap<TurnId, TurnModel>): number {
  if (row.kind !== "turn") return 1;

  return Math.max(1, turns.get(row.turn)?.blocks.length ?? 1);
}

function sameStatus(left: TurnStatus | null, right: TurnStatus | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function deriveTranscript(
  view: SessionView | null,
  shells: readonly ShellJob[],
  local: TranscriptLocal,
  previous: TranscriptModel | null,
): TranscriptModel {
  const messages = new Map<MessageId, Message>();
  const byTurn = new Map<TurnId, MessageId[]>();
  const notesByTurn = new Map<TurnId, Message[]>();

  for (const message of view?.messages ?? []) {
    if (message.kind === "user" && message.status.kind !== "landed") continue;

    if (
      isToolMessage(message) &&
      message.state.class.kind === "delegate" &&
      message.state.class.role === "await"
    )
      continue;
    messages.set(message.id, message);

    if (message.kind === "part" && message.role === "note") {
      notesByTurn.set(message.turn, [...(notesByTurn.get(message.turn) ?? []), message]);
      continue;
    }

    byTurn.set(message.turn, [...(byTurn.get(message.turn) ?? []), message.id]);
  }

  const turns = new Map<TurnId, TurnModel>();
  const timed: { readonly row: Row; readonly at: number }[] = [];

  for (const info of view?.turns ?? []) {
    for (const note of notesByTurn.get(info.id) ?? [])
      timed.push({ row: { kind: "note", key: `note:${note.id}`, message: note.id }, at: note.at });
    const blocks = byTurn.get(info.id) ?? [];

    if (blocks.length === 0 && (info.state.kind === "ended" || info.run === null)) continue;

    const blockMessages = blocks.flatMap((id) => {
      const message = messages.get(id);

      return message === undefined ? [] : [message];
    });

    const status = view === null ? null : turnStatus(info, blockMessages, view);
    const before = previous?.turns.get(info.id);

    turns.set(
      info.id,
      before !== undefined &&
        before.info === info &&
        sameIds(before.blocks, blocks) &&
        sameStatus(before.status, status)
        ? before
        : { info, blocks, status },
    );
    timed.push({
      row: { kind: "turn", key: `turn:${info.id}`, turn: info.id },
      at: info.startedAt,
    });
  }

  for (const message of view === null ? [] : [...landingMessages(view), ...pendingReports(view)]) {
    messages.set(message.id, message);
    timed.push({
      row: { kind: "landing", key: `landing:${message.id}`, message: message.id },
      at: message.at,
    });
  }

  const jobs = shells.toSorted(
    (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id),
  );

  const rows: Row[] = [];
  let next = 0;

  for (const entry of timed) {
    while (next < jobs.length && (jobs[next]?.startedAt ?? Infinity) < entry.at) {
      const job = jobs[next];

      if (job !== undefined) rows.push({ kind: "shell", key: `shell:${job.id}`, job: job.id });
      next += 1;
    }

    rows.push(entry.row);
  }

  for (const job of jobs.slice(next))
    rows.push({ kind: "shell", key: `shell:${job.id}`, job: job.id });

  const keptRows =
    previous !== null &&
    sameIds(
      previous.rows.map((row) => row.key),
      rows.map((row) => row.key),
    )
      ? previous.rows
      : rows;

  const window = mountWindow(keptRows, (row) => rowWeight(row, turns), local.window);

  return {
    rows: keptRows,
    turns,
    messages,
    shells: new Map(shells.map((job) => [job.id, job])),
    window:
      previous !== null &&
      previous.window.start === window.start &&
      previous.window.hidden === window.hidden
        ? previous.window
        : window,
    following: local.following,
    toolOutput: local.toolOutput,
    disclosures: local.disclosures,
    execution: view?.execution ?? null,
  };
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
      if (info.run === null && blocks.every((message) => message.kind === "user"))
        return { kind: "unanswered" };

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
