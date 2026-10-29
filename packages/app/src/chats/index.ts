import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, JobView, SessionId, WorkspaceInfo } from "@nyte-ai/sdk";
import { QueryObserver } from "@tanstack/react-query";
import { derivedStore } from "../data/derived-store.ts";
import { keys, queryClient } from "../data/query-client.ts";
import {
  sessionRows,
  subscribeSessionRow,
  subscribeSessionRows,
  useSessionRow,
} from "../data/session-rows.ts";
import { jobsWatch, sessionWatch } from "../data/watches.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { workspacesQuery } from "../data/workspaces.ts";
import { describeChats } from "./directory.ts";
import type { Chat, ChatDirectory } from "./directory.ts";
import { childTask, describeTask, matchesKey } from "./tasks.ts";
import type { ChildTask, Task, TaskKey } from "./tasks.ts";

export type { Chat, ChatDirectory, ChatLocation, Folder, UnreadTip } from "./directory.ts";

export type { ChildTask, JobTask, Task, TaskKey } from "./tasks.ts";

export { childTitle, delegateKey, findTask, trayTasks } from "./tasks.ts";

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

const NO_ITEMS: readonly BackgroundItem[] = [];

/** The tasks a chat started, as the host lists them in its open view's background. */
export function useChatTasks(session: SessionId | undefined): readonly Task[] {
  const background =
    useWatchSelect(
      session === undefined ? undefined : sessionWatch(session),
      (state) => state.value?.background,
    ) ?? NO_ITEMS;

  const jobs = useSessionJobs(session);
  const chats = useChats((directory) => directory);

  return background.flatMap(
    (item) =>
      describeTask(
        item,
        item.kind === "child" ? chats.get(asId<"session">(item.id)) : undefined,
        jobs,
      ) ?? [],
  );
}

/** The one task of a chat's background that `key` picks, or undefined while it lists none. Renders only when that task changes. */
export function useTask(session: SessionId | undefined, key: TaskKey): Task | undefined {
  const item = useWatchSelect(
    session === undefined ? undefined : sessionWatch(session),
    (state) => state.value?.background.find((candidate) => matchesKey(candidate, key)),
    sameItem,
  );

  const chat = useChats((directory) =>
    item?.kind === "child" ? directory.get(asId<"session">(item.id)) : undefined,
  );

  const jobs = useSessionJobs(item?.kind === "job" ? session : undefined);

  return item === undefined ? undefined : describeTask(item, chat, jobs);
}

/** A chat's children as tasks, from the directory, for a chat whose view isn't open. */
export function useChildTasks(parent: SessionId): readonly ChildTask[] {
  return useChats(
    (directory) =>
      [...directory.values()].flatMap((chat) =>
        chat.parent === parent ? [childTask(chat.id, chat, undefined)] : [],
      ),
    sameTasks,
  );
}

function useSessionJobs(session: SessionId | undefined): readonly JobView[] | undefined {
  const workspace = useSessionRow(session, (row) => row.workspace) ?? undefined;

  return useWatchSelect(
    workspace === undefined ? undefined : jobsWatch(workspace),
    (state) => state.value,
  );
}

function sameItem(previous: BackgroundItem | undefined, next: BackgroundItem | undefined): boolean {
  return (
    previous === next ||
    (previous !== undefined &&
      next !== undefined &&
      previous.kind === next.kind &&
      previous.id === next.id &&
      previous.title === next.title &&
      previous.state === next.state &&
      previous.startedBy === next.startedBy)
  );
}

function sameTasks(previous: readonly ChildTask[], next: readonly ChildTask[]): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (task, index) =>
        task.id === next[index]?.id &&
        task.title === next[index].title &&
        task.state === next[index].state &&
        task.live === next[index].live,
    )
  );
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
