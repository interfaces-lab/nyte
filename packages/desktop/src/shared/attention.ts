import { effectiveChannels } from "@nyte-ai/app/contract/desktop-settings.ts";
import type {
  AlertSettings,
  AlertState,
  DesktopSettings,
} from "@nyte-ai/app/contract/desktop-settings.ts";
import { alertNews, headAttention } from "@nyte-ai/plugin/client/presentation";
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

/** Least recently focused first: the last viewer of a chat is where a notification click goes. */
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

/**
 * A page that ends without its window closing keeps `loading`, so a click that raced the window's
 * load opens its chat once the new page reports what it views. A focused window moves last.
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

/**
 * An ask always reaches the person, once: a chat that waits on the person counts unless the chat
 * above it alerts for it already, which a parent does for any ask below it, so a question alerts on
 * the root chat it is answered from, whatever `notifySubagents` says. `notifySubagents` decides
 * only whether a subagent's or side chat's own end alerts.
 */
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
        (session.parent === null ||
          (status.alert.state === "waiting"
            ? !asking.has(session.parent)
            : settings.notifySubagents)),
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
