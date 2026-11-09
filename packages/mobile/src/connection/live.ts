import { useSyncExternalStore } from "react";
import Constants from "expo-constants";
import { asId } from "@nyte-ai/schema";
import type { Connection, HeadName, SessionId, SessionInfo } from "@nyte-ai/sdk";
import { headView, openHost, streamText, unsentSends, withStreamedText } from "@nyte-ai/sdk/client";
import type {
  Freshness,
  HeadView,
  Health,
  HostConnection as LiveHost,
  OpenSocket,
  SessionsWindow,
  StreamedText,
} from "@nyte-ai/sdk/client";
import { SHARE_LOCATION } from "./connect-copy.ts";

export type { LiveHost };

export interface ChatSnapshot {
  readonly view: HeadView;
  readonly freshness: Freshness;
}

export interface ListSnapshot {
  readonly sessions: readonly SessionInfo[] | undefined;
  readonly freshness: Freshness;
}

interface Shared<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => T | undefined;
}

interface Opened<T> {
  read(previous: T | undefined): T | undefined;
  close(): void;
}

type NativeSocket = new (
  url: string,
  protocols: undefined,
  options: { readonly headers: Readonly<Record<string, string>> },
) => ReturnType<OpenSocket>;

const NativeWebSocket: NativeSocket = WebSocket;

const MAIN = asId<"head">("main");

const TAIL = 200;

const NONE: Shared<ChatSnapshot> = { subscribe: () => () => undefined, snapshot: () => undefined };

const healths = new WeakMap<
  LiveHost,
  { readonly subscribe: (listener: () => void) => () => void; readonly snapshot: () => Health }
>();

const chats = new WeakMap<LiveHost, Map<string, Shared<ChatSnapshot>>>();

const lists = new WeakMap<LiveHost, Map<string, Shared<ListSnapshot>>>();

export function openLiveHost(url: string, token: string): LiveHost {
  return openHost(url, {
    credentials: { kind: "token", token },
    client: { kind: "app", name: "Nyte iOS", version: Constants.expoConfig?.version ?? "0.0.0" },
    socket: (request) => new NativeWebSocket(request.url, undefined, { headers: request.headers }),
  });
}

export function useHealth(live: LiveHost): Health {
  const known = healths.get(live);

  const health = known ?? {
    subscribe: (listener: () => void) => live.health.subscribe(listener),
    snapshot: () => live.health.snapshot(),
  };

  healths.set(live, health);

  return useSyncExternalStore(health.subscribe, health.snapshot);
}

export function useChat(
  live: LiveHost,
  client: Connection,
  session: SessionId | undefined,
  head: HeadName | undefined,
): ChatSnapshot | undefined {
  const chat = session === undefined ? NONE : openChat(live, client, session, head ?? MAIN);

  return useSyncExternalStore(chat.subscribe, chat.snapshot);
}

function openChat(
  live: LiveHost,
  client: Connection,
  session: SessionId,
  name: HeadName,
): Shared<ChatSnapshot> {
  return sharedStore(chats, live, JSON.stringify([session, name]), (changed) => {
    const store = live.head(session, name, { tail: TAIL });
    const unsent = unsentSends(client, session, name);
    let texts: StreamedText = new Map();
    const stops = [store.subscribe(changed), unsent.subscribe(changed)];

    const stopText = live.text((update) => {
      texts = streamText(texts, update);
      changed();
    });

    return {
      read(previous) {
        const snapshot = store.snapshot();

        if (snapshot === null) return undefined;
        const freshness = store.freshness();

        const laid = unsent.lay(
          headView(snapshot),
          freshness.kind === "fresh" ? freshness.seq : null,
        );

        const view = withStreamedText(laid, texts);

        return previous?.view === view && previous.freshness === freshness
          ? previous
          : { view, freshness };
      },
      close() {
        for (const stop of stops) stop();
        stopText();
        store.close();
      },
    };
  });
}

export function useSessions(live: LiveHost, window: SessionsWindow): ListSnapshot | undefined {
  const list = sharedStore(lists, live, JSON.stringify(window), (changed) => {
    const store = live.directory(window);
    const stop = store.subscribe(changed);

    return {
      read(previous) {
        const snapshot = store.snapshot();
        const freshness = store.freshness();

        const sessions = snapshot?.ids.flatMap((id) => {
          const info = snapshot.rows.get(id);

          return info === undefined ? [] : [info];
        });

        return previous !== undefined &&
          previous.freshness === freshness &&
          (previous.sessions === sessions ||
            (previous.sessions !== undefined &&
              sessions !== undefined &&
              previous.sessions.length === sessions.length &&
              previous.sessions.every((info, index) => info === sessions[index])))
          ? previous
          : { sessions, freshness };
      },
      close() {
        stop();
        store.close();
      },
    };
  });

  return useSyncExternalStore(list.subscribe, list.snapshot);
}

export function healthMessage(health: Health): string | undefined {
  switch (health.kind) {
    case "connecting":
    case "open":
      return undefined;
    case "retrying":
      return "Reconnecting to your Mac…";
    case "blocked":
      switch (health.reason) {
        case "offline":
          return "Can't reach your Mac. Nyte reconnects when you're back online.";
        case "auth":
          return `Your Mac refused this iPhone. Scan a new code from ${SHARE_LOCATION}.`;
        case "version":
          return "Nyte on this iPhone and on your Mac can't talk to each other. Update Nyte.";
        default: {
          const exhaustive: never = health.reason;

          return exhaustive;
        }
      }

    default: {
      const exhaustive: never = health;

      return exhaustive;
    }
  }
}

export function updatedLabel(freshness: Freshness | undefined): string | undefined {
  if (freshness?.kind !== "stale") return undefined;

  const time = new Date(freshness.since).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `Updated ${time}`;
}

function sharedStore<T>(
  stores: WeakMap<LiveHost, Map<string, Shared<T>>>,
  live: LiveHost,
  key: string,
  open: (changed: () => void) => Opened<T>,
): Shared<T> {
  const byKey = stores.get(live) ?? new Map<string, Shared<T>>();
  stores.set(live, byKey);
  const known = byKey.get(key);

  if (known !== undefined) return known;
  const listeners = new Set<() => void>();
  let opened: Opened<T> | null = null;
  let value: T | undefined;

  const changed = (): void => {
    const next = opened?.read(value);

    if (next === value) return;
    value = next;

    for (const listener of listeners) listener();
  };

  const shared: Shared<T> = {
    subscribe(listener) {
      listeners.add(listener);

      if (opened === null) {
        opened = open(changed);
        changed();
      }

      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        opened?.close();
        opened = null;
        value = undefined;
        byKey.delete(key);
      };
    },
    snapshot: () => value,
  };

  byKey.set(key, shared);

  return shared;
}
