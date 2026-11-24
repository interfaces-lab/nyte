import { useSyncExternalStore } from "react";
import { asId } from "@nyte-ai/schema";
import type { HeadName, SdkError, SessionId, SessionInfo } from "@nyte-ai/sdk";
import type {
  Chat,
  ChatSnapshot as SdkChatSnapshot,
  ClientConnection,
  Freshness,
  HeadView,
  LinkState,
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

const links = new WeakMap<
  ClientConnection,
  { readonly subscribe: (listener: () => void) => () => void; readonly snapshot: () => LinkState }
>();

const chats = new WeakMap<ClientConnection, Map<string, Shared<ChatRead>>>();

const opened = new WeakMap<ClientConnection, Map<string, Chat>>();

const lists = new WeakMap<ClientConnection, Map<string, Shared<ListSnapshot>>>();

export const nativeSocket: OpenSocket = (request) =>
  new NativeWebSocket(request.url, undefined, { headers: request.headers });

export function useLink(client: ClientConnection): LinkState {
  const known = links.get(client);

  const link = known ?? {
    subscribe: (listener: () => void) => client.link.subscribe(listener),
    snapshot: () => client.link.snapshot(),
  };

  links.set(client, link);

  return useSyncExternalStore(link.subscribe, link.snapshot);
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

        if (view !== null) {
          return previous !== undefined &&
            "view" in previous &&
            previous.view === view &&
            previous.freshness === freshness &&
            previous.stopping === stopping
            ? previous
            : { view, freshness, stopping };
        }
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

export function linkMessage(link: LinkState): string | undefined {
  switch (link.kind) {
    case "connecting":
    case "open":
    case "closed":
      return undefined;
    case "away":
      return AWAY[link.reason];
    case "refused":
      return REFUSED[link.reason];
    default: {
      const exhaustive: never = link;

      return exhaustive;
    }
  }
}

const AWAY = {
  replacing: "Nyte is updating on your Mac…",
  restarting: "Nyte is restarting on your Mac…",
  stopping: "Nyte stopped on your Mac.",
  lost: "Reconnecting to your Mac…",
} as const satisfies Record<Extract<LinkState, { readonly kind: "away" }>["reason"], string>;

const REFUSED = {
  "other-host": "Another Nyte answered at your Mac's address. Scan a new code to reach it.",
  auth: `Your Mac refused this iPhone. Scan a new code from ${SHARE_LOCATION}.`,
  "update-host": "Your Mac runs an older Nyte. Update Nyte on your Mac.",
  "update-client": "Your Mac runs a newer Nyte. Update Nyte on this iPhone.",
} as const satisfies Record<Extract<LinkState, { readonly kind: "refused" }>["reason"], string>;

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
