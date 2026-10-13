/**
 * The rows beside the composer: the user's unplaced messages in inbox order,
 * labelled by where core scheduled them (`status.schedule`), never by the
 * `delivery` they were sent with. Reports wait in their own list and are
 * never the user's to edit, move or withdraw.
 */
import type { Delivery, MessageId, RunId, Schedule } from "@nyte-ai/sdk";
import { reportRow } from "../lib/tasks.ts";
import type { Task } from "../lib/tasks.ts";
import { pendingReports, queuedMessages, shownContent } from "../lib/view-helpers.ts";
import type { UserMessage } from "../lib/view-helpers.ts";
import { draftFromContent } from "./draft.ts";
import type { State } from "./state.ts";

export interface QueueRow {
  readonly id: MessageId;
  /** `shownContent`: an action's label, never its prompt; markers for files and images. */
  readonly text: string;
  readonly place: Place;
  readonly delivery: Delivery;
  /** Pending rows can be withdrawn through `session.receipt(id).stop()`; unsent rows by the journal. */
  readonly withdrawable: boolean;
  /** Action-source messages show a label, so there is nothing to edit. */
  readonly editable: boolean;
  readonly editing: boolean;
}

/**
 * Where a row will land, read off `status`:
 * - joining: `pending` + `joined(run)`; lands at the run's next response boundary.
 * - next-turn: `pending` + `next-turn(reason)`; starts or waits for a later run.
 * - attached: `pending` + `attached`; rides with whatever lands next.
 * - sending: `unsent`; only in this client's journal, maybe retrying.
 * - uncovered: `pending` with `covered: false`; no host will run it yet.
 */
export type Place =
  | { readonly kind: "joining"; readonly run: RunId }
  | {
      readonly kind: "next-turn";
      readonly reason: Extract<Schedule, { readonly kind: "next-turn" }>["reason"];
    }
  | { readonly kind: "attached" }
  | { readonly kind: "sending"; readonly retryAt: number | null; readonly reason: string | null }
  | { readonly kind: "uncovered" };

export interface ReportRow {
  readonly id: MessageId;
  readonly title: string;
  readonly body: string;
  readonly glyph: string;
  readonly tone: "muted" | "running" | "warning" | "ok" | "error";
  /** The task it came from, while the session lists it; clicking opens it. */
  readonly task: string | null;
}

function placeOf(message: UserMessage): Place {
  const { status } = message;

  if (status.kind === "unsent")
    return {
      kind: "sending",
      retryAt: status.retrying?.at ?? null,
      reason: status.retrying?.reason ?? null,
    };

  if (status.kind !== "pending" || !status.covered) return { kind: "uncovered" };
  const { schedule } = status;

  switch (schedule.kind) {
    case "joined":
      return { kind: "joining", run: schedule.run };
    case "next-turn":
      return { kind: "next-turn", reason: schedule.reason };
    case "attached":
      return { kind: "attached" };
    default: {
      const _exhaustive: never = schedule;

      return _exhaustive;
    }
  }
}

/** One line for a queued message: markers for its parts, whitespace collapsed. */
export function queuedText(message: UserMessage): string {
  const shown = shownContent(message);

  if (message.source.kind === "action") return message.source.label;

  return draftFromContent(shown).text.replaceAll(/\s+/gu, " ").trim();
}

export function queueRows(
  session: State["facts"]["session"],
  editing: State["local"]["editing"],
): readonly QueueRow[] {
  const view = session?.view;

  if (view === null || view === undefined) return [];

  return queuedMessages(view).map((message) => ({
    id: message.id,
    text: queuedText(message),
    place: placeOf(message),
    delivery: message.delivery,
    withdrawable: message.status.kind === "pending",
    editable: message.source.kind !== "action",
    editing: editing?.message === message.id,
  }));
}

export function reportRows(
  session: State["facts"]["session"],
  tasks: readonly Task[],
): readonly ReportRow[] {
  const view = session?.view;

  if (view === null || view === undefined) return [];

  return pendingReports(view).map((report) => {
    const row = reportRow(report, tasks);

    return {
      id: report.id,
      title: row.title,
      body: row.body,
      glyph: row.mark.glyph,
      tone: row.mark.tone,
      task: row.task?.id ?? null,
    };
  });
}

function nextTurnLabel(reason: Extract<Place, { kind: "next-turn" }>["reason"]): string {
  switch (reason) {
    case "requested":
      return "queued";
    case "idle":
      return "next";
    case "run-ended":
      return "after this run";
    case "configuration":
      return "next turn · new model";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

/** The label a row shows. One switch, exhaustive over `Place`. */
export function placeLabel(place: Place): string {
  switch (place.kind) {
    case "joining":
      return "steer · next response";
    case "next-turn":
      return nextTurnLabel(place.reason);
    case "attached":
      return "attached";
    case "sending":
      return place.retryAt === null ? "sending…" : `retrying · ${place.reason ?? "waiting"}`;
    case "uncovered":
      return "waiting for a host";
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** Count shown in the footer: rows that will start or wait for a later run. Joining rows are part of this run. */
export function queuedCount(rows: readonly QueueRow[]): number {
  return rows.filter((row) => row.place.kind === "next-turn" || row.place.kind === "uncovered")
    .length;
}

export function rowMessage(session: State["facts"]["session"], id: MessageId): UserMessage | null {
  const found = session?.view?.messages.find((message) => message.id === id);

  return found?.kind === "user" ? found : null;
}

export function sameQueueRow(left: QueueRow, right: QueueRow): boolean {
  return (
    left.id === right.id &&
    left.text === right.text &&
    left.delivery === right.delivery &&
    left.withdrawable === right.withdrawable &&
    left.editable === right.editable &&
    left.editing === right.editing &&
    JSON.stringify(left.place) === JSON.stringify(right.place)
  );
}

export function sameReportRow(left: ReportRow, right: ReportRow): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.body === right.body &&
    left.glyph === right.glyph &&
    left.tone === right.tone &&
    left.task === right.task
  );
}
