import { useSyncExternalStore } from "react";
import { asId } from "@nyte-ai/schema";
import type { HeadName, SdkError, SessionId, SessionInfo } from "@nyte-ai/sdk";
import type {
  Chat,
  ChatSnapshot as SdkChatSnapshot,
  ClientConnection,
  Freshness,
  HeadView,
  Health,
  OpenSocket,
  SessionsWindow,
} from "@nyte-ai/sdk/client";
import { SHARE_LOCATION } from "./connect-copy.ts";

export interface ChatSnapshot {
  readonly view: HeadView;
  readonly freshness: Freshness;
  readonly stopping: SdkChatSnapshot["stopping"];
}

export type ChatRead = ChatSnapshot | { readonly error: SdkError };

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

const NONE: Shared<ChatRead> = { subscribe: () => () => undefined, snapshot: () => undefined };

const healths = new WeakMap<
  ClientConnection,
  { readonly subscribe: (listener: () => void) => () => void; readonly snapshot: () => Health }
>();

const chats = new WeakMap<ClientConnection, Map<string, Shared<ChatRead>>>();

const opened = new WeakMap<ClientConnection, Map<string, Chat>>();

const lists = new WeakMap<ClientConnection, Map<string, Shared<ListSnapshot>>>();

export const nativeSocket: OpenSocket = (request) =>
  new NativeWebSocket(request.url, undefined, { headers: request.headers });

export function useHealth(client: ClientConnection): Health {
  const known = healths.get(client);

  const health = known ?? {
    subscribe: (listener: () => void) => client.health.subscribe(listener),
    snapshot: () => client.health.snapshot(),
  };

  healths.set(client, health);

  return useSyncExternalStore(health.subscribe, health.snapshot);
}

export function useChat(
  client: ClientConnection,
  session: SessionId | undefined,
  head: HeadName | undefined,
): ChatSnapshot | undefined {
  const read = useChatRead(client, session, head);

  return read !== undefined && "view" in read ? read : undefined;
}

export function useChatRead(
  client: ClientConnection,
  session: SessionId | undefined,
  head: HeadName | undefined,
): ChatRead | undefined {
  const chat = session === undefined ? NONE : sharedChat(client, session, head ?? MAIN);

  return useSyncExternalStore(chat.subscribe, chat.snapshot);
}

export function chatFor(client: ClientConnection, session: SessionId, head: HeadName): Chat {
  const byKey = opened.get(client) ?? new Map<string, Chat>();
  opened.set(client, byKey);
  const key = JSON.stringify([session, head]);
  const known = byKey.get(key);

  if (known !== undefined) return known;
  const chat = client.chat(session, { head, tail: TAIL });
  byKey.set(key, chat);

  return chat;
}

function sharedChat(
  client: ClientConnection,
  session: SessionId,
  name: HeadName,
): Shared<ChatRead> {
  return sharedStore(chats, client, JSON.stringify([session, name]), (changed) => {
    const chat = chatFor(client, session, name);

    return {
      read(previous) {
        const snapshot = chat.snapshot();
        const view = snapshot.view;
        const freshness = snapshot.freshness;
        const stopping = snapshot.stopping;

        if (view !== null)
          return previous !== undefined &&
            "view" in previous &&
            previous.view === view &&
            previous.freshness === freshness &&
            previous.stopping === stopping
            ? previous
            : { view, freshness, stopping };
        const error = freshness.kind === "stale" ? freshness.error : null;

        if (error === null) return undefined;

        return previous !== undefined && "error" in previous && previous.error === error
          ? previous
          : { error };
      },
      close: chat.subscribe(changed),
    };
  });
}

export function useSessions(
  client: ClientConnection,
  window: SessionsWindow,
): ListSnapshot | undefined {
  const list = sharedStore(lists, client, JSON.stringify(window), (changed) => {
    const store = client.sessions.open(window);
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
  stores: WeakMap<ClientConnection, Map<string, Shared<T>>>,
  client: ClientConnection,
  key: string,
  open: (changed: () => void) => Opened<T>,
): Shared<T> {
  const byKey = stores.get(client) ?? new Map<string, Shared<T>>();
  stores.set(client, byKey);
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
