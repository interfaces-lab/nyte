import type { Delivery, MessageId, RunId, Schedule } from "@nyte-ai/sdk";
import { queuedMessages, shownContent } from "../lib/view-helpers.ts";
import type { UserMessage } from "../lib/view-helpers.ts";
import { draftFromContent } from "./draft.ts";
import type { State } from "./state.ts";

export interface QueueRow {
  readonly id: MessageId;
  readonly text: string;
  readonly place: Place;
  readonly delivery: Delivery;
  readonly withdrawable: boolean;
  readonly editable: boolean;
  readonly editing: boolean;
}

export type Place =
  | { readonly kind: "joining"; readonly run: RunId }
  | {
      readonly kind: "next-turn";
      readonly reason: Extract<Schedule, { readonly kind: "next-turn" }>["reason"];
    }
  | { readonly kind: "attached" }
  | { readonly kind: "sending"; readonly retryAt: number | null; readonly reason: string | null }
  | { readonly kind: "uncovered" };

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
