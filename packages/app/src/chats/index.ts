import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { SessionId, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { QueryObserver, skipToken } from "@tanstack/react-query";
import { derivedStore } from "../data/derived-store.ts";
import type { StoreSource } from "../data/derived-store.ts";
import { appSessionActions } from "../data/session-actions.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionQuery } from "../data/sessions.ts";
import { workspacesQuery } from "../data/workspaces.ts";
import { openViews, sessionsWatch, subscribeOpenViews } from "../data/watches.ts";
import { joinChats } from "./directory.ts";
import type { Chat, ChatDirectory } from "./directory.ts";

export type { Chat, ChatDirectory, ChatLocation, Folder, UnreadTip } from "./directory.ts";

export type ChatResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly chat: Chat };

/**
 * One chat as every surface shows it. Re-renders only when that chat changes. Asking for a chat
 * the lists don't carry yet, such as one just started, reads it into the directory.
 */
export function useChat(id: SessionId): ChatResult {
  return useSyncExternalStore(
    (notice) => subscribeChat(id, notice),
    () => readChat(id),
    () => readChat(id),
  );
}

/** What `select` makes of every chat; a change that selects an equal value doesn't render. */
export function useChats<S>(
  select: (chats: ChatDirectory) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  return useSyncExternalStoreWithSelector(
    subscribeChats,
    chatDirectory,
    chatDirectory,
    select,
    isEqual,
  );
}

/** What a surface calls a chat; one the directory doesn't have yet is still a chat, never blank. */
export function chatTitle(chat: Chat | undefined): string {
  return chat?.title ?? "Chat";
}

/** The folder the host opens for a chat: its own, null for Home, undefined until the folder list loads. */
export function chatFolderPath(id: SessionId): string | null | undefined {
  const location = chatDirectory().get(id)?.location;

  if (location === undefined || location.kind === "loading") return undefined;

  return location.kind === "folder" && location.available ? location.path : null;
}

const LOADING: ChatResult = { kind: "loading" };

const MISSING: ChatResult = { kind: "missing" };

const results = new WeakMap<Chat, ChatResult>();

function readChat(id: SessionId): ChatResult {
  const chat = chatDirectory().get(id);

  if (chat === undefined) return sessionsWatch("all").value === undefined ? LOADING : MISSING;
  const known = results.get(chat);

  if (known !== undefined) return known;
  const result: ChatResult = { kind: "ready", chat };
  results.set(chat, result);

  return result;
}

/** How many readers ask for each chat by id. */
const asked = new Map<SessionId, number>();

const askListeners = new Set<() => void>();

function subscribeChat(id: SessionId, notice: () => void): () => void {
  const leave = subscribeChats(notice);
  asked.set(id, (asked.get(id) ?? 0) + 1);

  for (const listener of askListeners) listener();

  return () => {
    const count = (asked.get(id) ?? 1) - 1;

    if (count === 0) asked.delete(id);
    else asked.set(id, count);

    for (const listener of askListeners) listener();
    leave();
  };
}

let unlistedRows: readonly SessionInfo[] = [];

/** Each asked-for chat the lists don't carry, read on its own while the directory is heard. */
const unlisted: StoreSource<readonly SessionInfo[]> = {
  read: () => unlistedRows,
  subscribe(notice) {
    const reads = new Map<
      SessionId,
      { readonly session: () => SessionInfo | null | undefined; readonly leave: () => void }
    >();

    const collect = (): void => {
      const next = [...reads.values()].flatMap((read) => {
        const session = read.session();

        return session === undefined || session === null ? [] : [session];
      });

      if (
        next.length === unlistedRows.length &&
        next.every((row, index) => row === unlistedRows[index])
      )
        return;
      unlistedRows = next;
      notice();
    };

    const sync = (): void => {
      const all = sessionsWatch("all").value;

      const listed = new Set(
        [...(all ?? []), ...(sessionsWatch("roots").value ?? [])].map((session) => session.id),
      );

      const wanted = new Set(
        all === undefined ? [] : [...asked.keys()].filter((id) => !listed.has(id)),
      );

      for (const [id, read] of reads)
        if (!wanted.has(id)) {
          read.leave();
          reads.delete(id);
        }

      for (const id of wanted)
        if (!reads.has(id)) {
          const observer = new QueryObserver(queryClient, sessionQuery(id));
          reads.set(id, {
            session: () => observer.getCurrentResult().data,
            leave: observer.subscribe(collect),
          });
        }

      collect();
    };

    askListeners.add(sync);

    const leave = [
      sessionsWatch("all").subscribeByFrame(sync),
      sessionsWatch("roots").subscribeByFrame(sync),
    ];

    sync();

    return () => {
      askListeners.delete(sync);

      for (const unsubscribe of leave) unsubscribe();

      for (const read of reads.values()) read.leave();
      unlistedRows = [];
    };
  },
};

const sources = {
  all: {
    read: () => sessionsWatch("all").value,
    subscribe: (notice: () => void) => sessionsWatch("all").subscribeByFrame(notice),
  },
  roots: {
    read: () => sessionsWatch("roots").value,
    subscribe: (notice: () => void) => sessionsWatch("roots").subscribeByFrame(notice),
  },
  recorded: {
    read: () => queryClient.getQueryData<readonly SessionInfo[]>(keys.firstFrameRoots),
    subscribe: (notice: () => void) =>
      new QueryObserver(queryClient, {
        queryKey: keys.firstFrameRoots,
        queryFn: skipToken,
      }).subscribe(notice),
  },
  unlisted,
  views: { read: openViews, subscribe: subscribeOpenViews },
  workspaces: {
    read: () => queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces),
    subscribe: (notice: () => void) =>
      new QueryObserver(queryClient, workspacesQuery).subscribe(notice),
  },
  pending: {
    read: () => appSessionActions().getSnapshot(),
    subscribe: (notice: () => void) => appSessionActions().subscribe(notice),
  },
} satisfies Readonly<Record<string, StoreSource<unknown>>>;

const directory = derivedStore(
  sources,
  (read, previous: ChatDirectory) => {
    const pending = read.pending.read();

    return joinChats(
      {
        lists: [read.all.read(), read.roots.read() ?? read.recorded.read(), read.unlisted.read()],
        views: read.views.read(),
        workspaces: read.workspaces.read(),
        project: (session) => appSessionActions().projectSession(session, pending),
      },
      previous,
    );
  },
  new Map<SessionId, Chat>(),
);

/** Every chat this connection lists or a reader asked for, joined again only when one of its sources changed. */
export const chatDirectory = directory.getSnapshot;

/** Hears every change to the directory's sources; the sources are watched while anyone listens. */
export const subscribeChats = directory.subscribe;
