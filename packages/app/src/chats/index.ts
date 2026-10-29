import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { SessionId, WorkspaceInfo } from "@nyte-ai/sdk";
import { QueryObserver } from "@tanstack/react-query";
import { derivedStore } from "../data/derived-store.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionRows, subscribeSessionRow, subscribeSessionRows } from "../data/session-rows.ts";
import { workspacesQuery } from "../data/workspaces.ts";
import { describeChats } from "./directory.ts";
import type { Chat, ChatDirectory } from "./directory.ts";

export type { Chat, ChatDirectory, ChatLocation, Folder, UnreadTip } from "./directory.ts";

export type ChatResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly chat: Chat };

/**
 * One chat as every surface shows it. Re-renders only when that chat changes. Asking for a chat
 * the lists don't carry yet, such as one just started, reads it on its own.
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

  if (chat === undefined) return sessionRows().listed ? MISSING : LOADING;
  const known = results.get(chat);

  if (known !== undefined) return known;
  const result: ChatResult = { kind: "ready", chat };
  results.set(chat, result);

  return result;
}

function subscribeChat(id: SessionId, notice: () => void): () => void {
  const leave = [subscribeChats(notice), subscribeSessionRow(id, notice)];

  return () => {
    for (const unsubscribe of leave) unsubscribe();
  };
}

const directory = derivedStore(
  {
    rows: { read: sessionRows, subscribe: subscribeSessionRows },
    workspaces: {
      read: () => queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces),
      subscribe: (notice: () => void) =>
        new QueryObserver(queryClient, workspacesQuery).subscribe(notice),
    },
  },
  (read, previous: ChatDirectory) =>
    describeChats(read.rows.read().rows.values(), read.workspaces.read(), previous),
  new Map<SessionId, Chat>(),
);

/** A chat for every session row, described again only when the rows or the folders changed. */
export const chatDirectory = directory.getSnapshot;

/** Hears every change to the directory's sources; the sources are watched while anyone listens. */
export const subscribeChats = directory.subscribe;
