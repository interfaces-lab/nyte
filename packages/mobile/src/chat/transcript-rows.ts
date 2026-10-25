import { canvas } from "@nyte-ai/plugin/canvas/schema";
import { branchSummary, compaction, isPart, text, thinking, tool } from "@nyte-ai/plugin/client";
import type {
  Execution,
  Failure,
  Message,
  PartId,
  PartStatus,
  SessionView,
  ToolPartState,
  TurnId,
  UserContent,
} from "@nyte-ai/sdk";

export type ActivityPart =
  | { kind: "tool"; id: string; state: ToolPartState; status: PartStatus }
  | { kind: "thinking"; id: string; text: string; streaming: boolean };

type UserMessage = Extract<Message, { kind: "user" }>;

/** Where a sent message is on its way: the SDK's journal holds it until the host answers, then the host schedules it. */
export type UserDelivery =
  | { kind: "sent" }
  | { kind: "sending" }
  | { kind: "retrying"; reason: string }
  | { kind: "queued" }
  | { kind: "joining" };

export type ChatRow =
  | {
      kind: "user";
      id: string;
      message: UserMessage["id"];
      content: UserContent;
      delivery: UserDelivery;
    }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "canvas";
      id: string;
      part: PartId;
      title: string;
      runtime: number;
      code: string;
      height: number | null;
      error: string | null;
    }
  | { kind: "activity"; id: string; parts: readonly ActivityPart[] }
  | { kind: "status"; id: string; execution: Exclude<Execution, { kind: "idle" }> }
  | { kind: "failure"; id: string; failure: Failure }
  | { kind: "summary"; id: string; text: string }
  | { kind: "marker"; id: string; text: string };

const STOPPED: Failure = { class: "aborted", message: "" };

const rowsOf = new WeakMap<Message, ChatRow>();

function userDelivery(status: UserMessage["status"]): UserDelivery {
  switch (status.kind) {
    case "landed":
      return { kind: "sent" };
    case "unsent":
      return status.retrying === null
        ? { kind: "sending" }
        : { kind: "retrying", reason: status.retrying.reason };
    case "pending":
      switch (status.schedule.kind) {
        case "joined":
        case "attached":
          return { kind: "joining" };
        case "next-turn":
          return { kind: "queued" };
        case "deciding":
          return { kind: "sending" };
        default: {
          const exhaustive: never = status.schedule;

          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = status;

      return exhaustive;
    }
  }
}

function messageRow(message: Message): ChatRow | undefined {
  const cached = rowsOf.get(message);

  if (cached !== undefined) return cached;

  const row: ChatRow | undefined =
    message.kind === "user"
      ? {
          kind: "user",
          id: `submission:${message.id}`,
          message: message.id,
          content: message.content,
          delivery: userDelivery(message.status),
        }
      : isPart(message, text)
        ? {
            kind: "assistant",
            id: message.id,
            text: message.state.markdown,
            streaming: message.status.kind === "live",
          }
        : isPart(message, canvas)
          ? { kind: "canvas", id: message.id, part: message.part, ...message.state }
          : isPart(message, branchSummary)
            ? { kind: "summary", id: message.id, text: message.state.markdown }
            : isPart(message, compaction)
              ? { kind: "marker", id: message.id, text: "Earlier context summarized" }
              : undefined;

  if (row !== undefined) rowsOf.set(message, row);

  return row;
}

function activityPart(message: Message): ActivityPart | undefined {
  if (isPart(message, tool))
    return { kind: "tool", id: message.id, state: message.state, status: message.status };

  if (isPart(message, thinking))
    return {
      kind: "thinking",
      id: message.id,
      text: message.state.markdown,
      streaming: message.status.kind === "live",
    };

  return undefined;
}

export function conversationRows(view: SessionView): ChatRow[] {
  const ends = new Map(view.turns.map((turn) => [turn.id, turn.state]));
  const rows: ChatRow[] = [];
  let group: ActivityPart[] | undefined;
  let turn: TurnId | undefined;

  const closeTurn = () => {
    const state = turn === undefined ? undefined : ends.get(turn);

    if (state?.kind === "ended" && state.end.kind !== "completed")
      rows.push({
        kind: "failure",
        id: `failure:${String(turn)}`,
        failure: state.end.kind === "failed" ? state.end.failure : STOPPED,
      });
  };

  const lead = view.leadingPrompt;
  const leadRow = lead === null ? undefined : messageRow(lead);

  if (lead !== null) {
    if (leadRow !== undefined) rows.push(leadRow);
    rows.push({ kind: "marker", id: `earlier:${lead.turn}`, text: "Earlier steps not shown" });
    turn = lead.turn;
  }

  for (const message of view.messages) {
    if (message.turn !== turn) {
      closeTurn();
      turn = message.turn;
      group = undefined;
    }

    const step = activityPart(message);

    if (step !== undefined) {
      if (group === undefined) {
        group = [];
        rows.push({ kind: "activity", id: `activity:${message.id}`, parts: group });
      }

      group.push(step);
      continue;
    }

    group = undefined;
    const row = messageRow(message);

    if (row !== undefined) rows.push(row);
  }

  closeTurn();
  rows.push(...view.queue.flatMap((message) => messageRow(message) ?? []));

  if (view.execution.kind !== "idle")
    rows.push({
      kind: "status",
      id: `status:${view.execution.run.id}`,
      execution: view.execution,
    });

  return rows;
}
