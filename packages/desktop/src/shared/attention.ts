import { effectiveChannels } from "@nyte-ai/app/contract/desktop-settings.ts";
import type {
  AlertSettings,
  AlertState,
  DesktopSettings,
} from "@nyte-ai/app/contract/desktop-settings.ts";
import { alertNews, alertsOnChat, headAttention } from "@nyte-ai/plugin/client/presentation";
import type { HeadAttention } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { HostWindow, WindowEnd } from "./host-window.ts";

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

export type AttentionWindows = ReadonlyMap<HostWindow, WindowAttention>;

export type WindowAttentionEvent =
  | { readonly kind: "viewing"; readonly window: HostWindow; readonly viewed: string | null }
  | { readonly kind: "ended"; readonly window: HostWindow; readonly end: WindowEnd }
  | { readonly kind: "clicked"; readonly window: HostWindow; readonly session: SessionId }
  | { readonly kind: "focused"; readonly window: HostWindow };

export interface WindowAttentionStep {
  readonly windows: AttentionWindows;
  readonly reveal: HostWindow | undefined;
  readonly open: { readonly window: HostWindow; readonly session: SessionId } | undefined;
}

export function findViewer(windows: AttentionWindows, session: SessionId): HostWindow | undefined {
  return [...windows].findLast(
    (entry) => entry[1].kind === "ready" && entry[1].viewed === session,
  )?.[0];
}

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

  if (event.kind === "focused" && before !== undefined) {
    next.delete(event.window);
    next.set(event.window, before);
  }

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
  const attended = input.rows.map((session) => ({ session, status: headAttention(session) }));

  const asking = new Set(
    attended.flatMap((entry) =>
      !entry.session.archived && entry.status.alert.state === "waiting" ? [entry.session.id] : [],
    ),
  );

  const rows = attended.map((entry) => {
    const session = entry.session;
    const status = entry.status;
    const before = previous?.get(session.id);

    const changed =
      previous !== undefined &&
      (before === undefined ? session.createdAt >= input.since : before.key !== status.alert.key);

    return {
      session,
      status,
      moved: changed && (before === undefined || alertNews(before.key, status.alert)),
      fresh: changed || (before?.fresh === true && before.key === status.alert.key),
      counted:
        !session.archived &&
        alertsOnChat(
          session,
          status.alert,
          session.parent !== null && asking.has(session.parent),
          settings.notifySubagents,
        ),
    };
  });

  return {
    seen: new Map(
      rows.map((row) => [row.session.id, { key: row.status.alert.key, fresh: row.fresh }]),
    ),
    deliveries: rows.flatMap((row) => {
      const alert = row.status.alert;

      if (!row.moved || !row.counted || alert.state === undefined) return [];
      const delivery = deliver(row.session, alert, settings);

      return delivery.notify || delivery.bounce ? [delivery] : [];
    }),
    badge: rows.filter(
      (row) =>
        row.counted &&
        row.status.alert.state !== undefined &&
        (row.status.alert.state === "waiting" || row.status.settledUnread) &&
        effectiveChannels(row.status.alert.state, settings).includes("badge"),
    ).length,
    reminders: rows.flatMap((row) => {
      const alert = row.status.alert;

      if (!row.fresh || !row.counted || alert.state !== "waiting") return [];

      return effectiveChannels("waiting", settings).includes("remind")
        ? [
            {
              id: `${row.session.id}:${alert.key}`,
              delivery: {
                ...deliver(row.session, alert, settings),
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
  alert: Extract<HeadAttention["alert"], { readonly state: AlertState }>,
  settings: AlertSettings,
): AttentionDelivery {
  const reach = effectiveChannels(alert.state, settings);

  return {
    session: session.id,
    state: alert.state,
    title: session.name ?? "New chat",
    body: alert.body,
    notify: reach.includes("notification"),
    sound: reach.includes("sound"),
    bounce: reach.includes("bounce"),
  };
}
