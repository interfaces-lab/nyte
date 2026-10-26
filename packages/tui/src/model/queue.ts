import type { Delivery, MessageId, QueuedMessage, Schedule } from "@nyte-ai/sdk";
import { shownContent } from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { draftFromContent } from "./draft.ts";
import type { FollowedSession, State } from "./state.ts";

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
  | {
      readonly kind: "next-turn";
      readonly reason: Extract<Schedule, { readonly kind: "next-turn" }>["reason"];
    }
  | { readonly kind: "attached" }
  | { readonly kind: "sending"; readonly retryAt: number | null; readonly reason: string | null }
  | { readonly kind: "uncovered" }
  | { readonly kind: "deciding" };

function placeMessage(message: QueuedMessage): Place {
  const { status } = message;

  if (status.kind === "unsent")
    return {
      kind: "sending",
      retryAt: status.retrying?.at ?? null,
      reason: status.retrying?.reason ?? null,
    };

  if (!status.covered) return { kind: "uncovered" };
  const { schedule } = status;

  switch (schedule.kind) {
    case "next-turn":
      return { kind: "next-turn", reason: schedule.reason };
    case "attached":
      return { kind: "attached" };
    case "deciding":
      return { kind: "deciding" };
    default: {
      const _exhaustive: never = schedule;

      return _exhaustive;
    }
  }
}

function queuedText(message: UserMessage): string {
  const shown = shownContent(message);

  if (message.source.kind === "action") return message.source.label;

  return draftFromContent(shown).text.replaceAll(/\s+/gu, " ").trim();
}

export function queueRows(
  session: FollowedSession | null,
  editing: State["local"]["editing"],
): readonly QueueRow[] {
  const view = session?.view;

  if (view === null || view === undefined) return [];

  return view.queue.map((message) => {
    const place = placeMessage(message);

    return {
      id: message.id,
      text: queuedText(message),
      place,
      delivery: message.delivery,
      withdrawable: message.status.kind === "pending" && place.kind !== "deciding",
      editable: message.source.kind !== "action" && place.kind !== "deciding",
      editing: editing?.message === message.id,
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
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

export function placeLabel(place: Place): string {
  switch (place.kind) {
    case "next-turn":
      return nextTurnLabel(place.reason);
    case "attached":
      return "attached";
    case "sending":
      return place.retryAt === null ? "sending…" : `retrying · ${place.reason ?? "waiting"}`;
    case "uncovered":
      return "waiting for a host";
    case "deciding":
      return "waiting on plugins";
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

export function rowMessage(session: FollowedSession | null, id: MessageId): UserMessage | null {
  const view = session?.view;

  if (view === null || view === undefined) return null;

  const found =
    view.queue.find((message) => message.id === id) ??
    view.messages.find((message) => message.id === id);

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
