import type { MessageId, SessionId } from "@nyte-ai/sdk";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { draftFromContent, snapshot } from "../draft.ts";
import type { Intent } from "../msg.ts";
import { queueRows, rowMessage } from "../queue.ts";
import type { QueueRow } from "../queue.ts";
import type { State } from "../state.ts";
import { refuse, setDraft, stay, withLocal, withNotice } from "../step.ts";
import type { SomeHandlers, Step } from "../step.ts";

type QueueIntent = Extract<
  Intent,
  { readonly kind: "edit-queued" | "promote" | "withdraw" | "reorder" }
>;

export const queueHandlers = {
  "edit-queued": (state, msg, now) =>
    queued(state, msg, now, (row, message) => {
      if (state.local.editing !== null)
        return refuse(state, "Save or cancel the current queue edit first.", now);

      if (!row.editable)
        return refuse(state, `"${row.text}" is an action; it can't be edited.`, now);

      const editing = {
        message: row.id,
        delivery: row.delivery === "queue" ? ("queue" as const) : ("steer" as const),
        saved: snapshot(state.local.draft),
      };

      const next = withNotice(
        withLocal(state, { editing }),
        "Editing queued message. Enter saves; Esc cancels.",
        "ok",
        now,
      );

      return setDraft(next, draftFromContent(message.content));
    }),
  promote: (state, msg, now) =>
    queued(state, msg, now, (row, message, session) => {
      if (!row.withdrawable) return refuse(state, "That message is still sending", now, "info");

      if (row.place.kind === "joining")
        return refuse(state, "That message already joins this run", now, "info");

      return {
        state,
        effects: [
          {
            kind: "revise",
            session,
            message: row.id,
            content: message.content,
            delivery: "steer",
            position: null,
          },
        ],
      };
    }),
  withdraw: (state, msg, now) =>
    queued(state, msg, now, (row, _message, session) => {
      if (!row.withdrawable)
        return refuse(
          state,
          "That message is still sending; it can't be removed yet.",
          now,
          "info",
        );

      return { state, effects: [{ kind: "withdraw", session, message: row.id }] };
    }),
  reorder: (state, msg, now) =>
    queued(state, msg, now, (row, message, session, rows) => {
      const pending = rows.filter((candidate) => candidate.withdrawable);
      const index = pending.findIndex((candidate) => candidate.id === row.id);

      if (index === -1) return stay(state);

      const before = reorderTarget(
        pending.map((candidate) => candidate.id),
        index,
        msg.to,
      );

      if (before === undefined) return stay(state);

      return {
        state,
        effects: [
          {
            kind: "revise",
            session,
            message: row.id,
            content: message.content,
            delivery: row.delivery,
            position: before === null ? { kind: "last" } : { kind: "before", message: before },
          },
        ],
      };
    }),
  revised: (state, msg, now) => {
    if (msg.result === "landed-first") return refuse(state, "Already sent", now);

    return msg.result === "gone" ? refuse(state, "No longer queued", now, "info") : stay(state);
  },
  withdrawn: (state, msg, now) => {
    if (msg.result === "withdrawn")
      return stay(withNotice(state, "Removed from the queue", "info", now));

    return msg.result === "landed-first"
      ? refuse(state, "Already sent", now)
      : refuse(state, "No longer queued", now, "info");
  },
} satisfies SomeHandlers;

function queued(
  state: State,
  msg: QueueIntent,
  now: number,
  act: (row: QueueRow, message: UserMessage, session: SessionId, rows: readonly QueueRow[]) => Step,
): Step {
  const followed = state.facts.session;

  if (followed === null) return stay(state);
  const rows = queueRows(followed, state.local.editing);
  const row = rows.find((candidate) => candidate.id === msg.message);
  const message = rowMessage(followed, msg.message);

  if (row === undefined || message === null) return refuse(state, "Already sent", now);

  return act(row, message, followed.id, rows);
}

function reorderTarget(
  ids: readonly MessageId[],
  index: number,
  to: Extract<Intent, { kind: "reorder" }>["to"],
): MessageId | null | undefined {
  if (to === "earlier") return index <= 0 ? undefined : ids[index - 1];

  if (to === "later") return index >= ids.length - 1 ? undefined : (ids[index + 2] ?? null);

  if (to.before === null) return index >= ids.length - 1 ? undefined : null;

  if (to.before === ids[index] || to.before === ids[index + 1]) return undefined;

  return ids.includes(to.before) ? to.before : null;
}
