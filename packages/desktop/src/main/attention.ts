import { effectiveChannels } from "@nyte-ai/app/desktop-settings.ts";
import type { AlertSettings, AlertState, DesktopSettings } from "@nyte-ai/app/desktop-settings.ts";
import { describeRunEnd } from "@nyte-ai/plugin/client/notifications";
import { mainHead } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";

/** A chat's status, read from its main head the way the sidebar marks it. */
type Status = {
  /** Changes once per question, run or ending, so each one alerts once. */
  readonly key: string;
  readonly unread: boolean;
} & Alerting;

type Alerting =
  | { readonly alert: undefined }
  | { readonly alert: AlertState; readonly body: string };

interface Tracked {
  readonly key: string;
  /** Whether this status began after Nyte started; only those alert or remind. */
  readonly fresh: boolean;
}

export type AttentionSeen = ReadonlyMap<SessionId, Tracked>;

export interface AttentionDelivery {
  readonly session: SessionId;
  readonly title: string;
  readonly body: string;
  readonly notify: boolean;
  readonly sound: boolean;
  readonly bounce: boolean;
}

export interface AttentionReminder {
  /** The chat and the question it waits on; a new question is a new reminder. */
  readonly id: string;
  readonly delivery: AttentionDelivery;
}

export interface AttentionPlan {
  readonly seen: AttentionSeen;
  readonly deliveries: readonly AttentionDelivery[];
  readonly badge: number;
  readonly reminders: readonly AttentionReminder[];
}

export type AttentionSettings = AlertSettings & Pick<DesktopSettings, "notifySubagents">;

/**
 * Compares the rows with what the host saw last: each chat whose status moved alerts once, on
 * the channels its state reaches you on. Without `previous` the rows are the baseline and nothing
 * alerts; a chat first seen later alerts only if it was created after `since`. The badge counts
 * the chats that still need you: waiting ones, and failed or done ones not yet read.
 */
export function planAttention(input: {
  readonly previous: AttentionSeen | undefined;
  readonly rows: readonly SessionInfo[];
  readonly settings: AttentionSettings;
  readonly since: number;
}): AttentionPlan {
  const { previous, settings } = input;

  const rows = input.rows.map((session) => {
    const status = readStatus(session);
    const before = previous?.get(session.id);

    const moved =
      previous !== undefined &&
      (before === undefined ? session.createdAt >= input.since : before.key !== status.key);

    return {
      session,
      status,
      moved,
      fresh: moved || (before?.fresh === true && before.key === status.key),
      counted: !session.archived && (settings.notifySubagents || session.parent === null),
    };
  });

  return {
    seen: new Map(rows.map((row) => [row.session.id, { key: row.status.key, fresh: row.fresh }])),
    deliveries: rows.flatMap((row) => {
      if (!row.moved || !row.counted || row.status.alert === undefined) return [];
      const delivery = deliver(row.session, row.status, settings);

      return delivery.notify || delivery.bounce ? [delivery] : [];
    }),
    badge: rows.filter(
      (row) =>
        row.counted &&
        row.status.alert !== undefined &&
        (row.status.alert === "waiting" || row.status.unread) &&
        effectiveChannels(row.status.alert, settings).includes("badge"),
    ).length,
    reminders: rows.flatMap((row) => {
      if (!row.fresh || !row.counted || row.status.alert !== "waiting") return [];

      return effectiveChannels("waiting", settings).includes("remind")
        ? [
            {
              id: `${row.session.id}:${row.status.key}`,
              delivery: {
                ...deliver(row.session, row.status, settings),
                body: "Still needs your answer",
                bounce: false,
              },
            },
          ]
        : [];
    }),
  };
}

function deliver(
  session: SessionInfo,
  status: { readonly alert: AlertState; readonly body: string },
  settings: AlertSettings,
): AttentionDelivery {
  const reach = effectiveChannels(status.alert, settings);

  return {
    session: session.id,
    title: session.name ?? "New chat",
    body: status.body,
    notify: reach.includes("notification"),
    sound: reach.includes("sound"),
    bounce: reach.includes("bounce"),
  };
}

function readStatus(session: SessionInfo): Status {
  const head = mainHead(session);
  const unread = head?.unread ?? false;
  const execution = head?.execution;

  if (execution === undefined) return { key: "none", unread, alert: undefined };

  switch (execution.kind) {
    case "waiting":
      return execution.on.kind === "part"
        ? {
            key: `waiting:${execution.on.part}`,
            unread,
            alert: "waiting",
            body: "Needs your answer",
          }
        : { key: `working:${execution.run.id}`, unread, alert: undefined };
    case "live":
    case "retrying":
      return { key: `working:${execution.run.id}`, unread, alert: undefined };
    case "idle": {
      const last = execution.lastRun;

      if (last === null) return { key: "none", unread, alert: undefined };
      const key = `ended:${last.id}`;
      const body = describeRunEnd(last.end);

      if (body === undefined) return { key, unread, alert: undefined };

      return { key, unread, alert: last.end.kind === "completed" ? "done" : "failed", body };
    }

    default: {
      const _exhaustive: never = execution;

      return _exhaustive;
    }
  }
}
