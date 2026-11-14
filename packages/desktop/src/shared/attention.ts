import { effectiveChannels } from "@nyte-ai/app/contract/desktop-settings.ts";
import type {
  AlertSettings,
  AlertState,
  DesktopSettings,
} from "@nyte-ai/app/contract/desktop-settings.ts";
import { describeRunEnd } from "@nyte-ai/plugin/client/notifications";
import { mainHead } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { HostWindow, WindowEnd } from "./host-window.ts";

type Status = {
  readonly key: string;
  readonly unread: boolean;
} & Alerting;

type Alerting =
  | { readonly alert: undefined }
  | { readonly alert: AlertState; readonly body: string };

interface Tracked {
  readonly key: string;
  readonly fresh: boolean;
}

export type AttentionSeen = ReadonlyMap<SessionId, Tracked>;

export interface AttentionDelivery {
  readonly session: SessionId;
  readonly state: AlertState;
  readonly title: string;
  readonly body: string;
  readonly notify: boolean;
  readonly sound: boolean;
  readonly bounce: boolean;
}

export interface AttentionReminder {
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

export interface ReminderChanges {
  readonly stop: readonly string[];
  readonly start: readonly (AttentionReminder & { readonly signature: string })[];
}

export type WindowAttention =
  | { readonly kind: "ready"; readonly viewed: string | null }
  | { readonly kind: "loading"; readonly opening: SessionId };

/** In insertion order, which picks the viewer a notification click goes to. */
export type AttentionWindows = ReadonlyMap<HostWindow, WindowAttention>;

export type WindowAttentionEvent =
  | { readonly kind: "viewing"; readonly window: HostWindow; readonly viewed: string | null }
  | { readonly kind: "ended"; readonly window: HostWindow; readonly end: WindowEnd }
  | { readonly kind: "clicked"; readonly window: HostWindow; readonly session: SessionId };

export interface WindowAttentionStep {
  readonly windows: AttentionWindows;
  readonly reveal: HostWindow | undefined;
  readonly open: { readonly window: HostWindow; readonly session: SessionId } | undefined;
}

export function findViewer(windows: AttentionWindows, session: SessionId): HostWindow | undefined {
  return [...windows].find(
    (entry) => entry[1].kind === "ready" && entry[1].viewed === session,
  )?.[0];
}

/**
 * A page that ends without its window closing keeps `loading`, so a click that raced the window's
 * load opens its chat once the new page reports what it views.
 */
export function stepWindowAttention(
  windows: AttentionWindows,
  event: WindowAttentionEvent,
): WindowAttentionStep {
  const before = windows.get(event.window);
  const ready = before?.kind === "ready";
  const next = new Map(windows);

  if (event.kind === "viewing") next.set(event.window, { kind: "ready", viewed: event.viewed });

  if (event.kind === "ended" && (event.end === "closed" || ready)) next.delete(event.window);

  if (event.kind === "clicked" && !ready)
    next.set(event.window, { kind: "loading", opening: event.session });

  const opening =
    event.kind === "viewing" && before?.kind === "loading"
      ? before.opening
      : event.kind === "clicked" && ready
        ? event.session
        : undefined;

  return {
    windows: next,
    reveal: event.kind === "clicked" ? event.window : undefined,
    open: opening === undefined ? undefined : { window: event.window, session: opening },
  };
}

/**
 * Leaves a running reminder whose interval and delivery are unchanged; stops the others held and
 * starts the new or changed ones.
 */
export function reconcileReminders(
  held: ReadonlyMap<string, { readonly signature: string }>,
  wanted: readonly AttentionReminder[],
  every: number,
): ReminderChanges {
  const signed = wanted.map((reminder) => ({
    ...reminder,
    signature: JSON.stringify([every, reminder.delivery]),
  }));

  const signatures = new Map(signed.map((reminder) => [reminder.id, reminder.signature]));

  return {
    stop: [...held.keys()].filter((id) => signatures.get(id) !== held.get(id)?.signature),
    start: signed.filter((reminder) => held.get(reminder.id)?.signature !== reminder.signature),
  };
}

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
    state: status.alert,
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

      if (
        session.project !== undefined &&
        session.parent === null &&
        (head?.background.working ?? 0) > 0
      )
        return { key: `ended:${last.id}:agents`, unread, alert: undefined };
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
