import { useState, useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, JobView, SessionId, WorkspaceInfo } from "@nyte-ai/sdk";
import { QueryObserver } from "@tanstack/react-query";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { derivedStore } from "../data/derived-store.ts";
import { keys, queryClient, queryDataReader } from "../data/query-client.ts";
import {
  sessionRows,
  subscribeChildRows,
  subscribeSessionRow,
  subscribeSessionRows,
  useSessionRow,
} from "../data/session-rows.ts";
import { hostWatch, jobsWatch } from "../data/watches.ts";
import { chatStore } from "../data/chat-store.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { workspacesQuery } from "../data/workspaces.ts";
import { describeChats } from "./directory.ts";
import type { Chat, ChatDirectory } from "./directory.ts";
import { childTask, describeTask, matchesKey } from "./tasks.ts";
import type { ChildTask, Task, TaskKey } from "./tasks.ts";
import { waitingBelow } from "./waiting.ts";
import type { WaitingChat } from "./waiting.ts";

export type { Chat, ChatDirectory } from "./directory.ts";

export type { ChildTask, JobTask, Task, TaskKey } from "./tasks.ts";

export { childTitle, delegateKey, findTask, trayTasks } from "./tasks.ts";

export type { WaitingChat } from "./waiting.ts";

export type ChatResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly chat: Chat };

/** Asking for a chat the lists don't carry yet, such as one just started, reads it on its own. */
export function useChat(id: SessionId): ChatResult {
  return useSyncExternalStore(
    (notice) => subscribeChat(id, notice),
    () => readChat(id),
    () => readChat(id),
  );
}

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

export function chatTitle(chat: Chat | undefined): string {
  return chat?.title ?? "Chat";
}

const NO_ITEMS: readonly BackgroundItem[] = [];

export function useChatTasks(session: SessionId | undefined): readonly Task[] {
  const background =
    useWatchSelect(
      session === undefined ? undefined : chatStore(session),
      (state) => state.value?.background,
    ) ?? NO_ITEMS;

  const jobs = useSessionJobs(session);
  const chats = useChildChats(session, (directory) => directory);

  return background.flatMap(
    (item) =>
      describeTask(
        item,
        item.kind === "child" ? chats.get(asId<"session">(item.id)) : undefined,
        jobs,
      ) ?? [],
  );
}

export function useTask(session: SessionId | undefined, key: TaskKey): Task | undefined {
  const item = useWatchSelect(
    session === undefined ? undefined : chatStore(session),
    (state) => state.value?.background.find((candidate) => matchesKey(candidate, key)),
    sameItem,
  );

  const chat = useChildChats(session, (directory) =>
    item?.kind === "child" ? directory.get(asId<"session">(item.id)) : undefined,
  );

  const jobs = useSessionJobs(item?.kind === "job" ? session : undefined);

  return item === undefined ? undefined : describeTask(item, chat, jobs);
}

export function useChildTasks(parent: SessionId): readonly ChildTask[] {
  return useChildChats(
    parent,
    (directory) =>
      [...directory.values()].flatMap((chat) =>
        chat.parent === parent ? [childTask(chat.id, chat, undefined)] : [],
      ),
    sameTasks,
  );
}

/** The component owns the walk for its session and starts a new one when the session changes. */
export function useWaitingDescendants(session: SessionId): readonly WaitingChat[] {
  const [owned, setOwned] = useState(() => ({ session, store: waitingBelow(session) }));
  const current = owned.session === session ? owned : { session, store: waitingBelow(session) };

  if (current !== owned) setOwned(current);

  return useSyncExternalStore(
    current.store.subscribe,
    current.store.getSnapshot,
    current.store.getSnapshot,
  );
}

/** Includes every child of `parent`, however many chats the host's lists carry. */
function useChildChats<S>(
  parent: SessionId | undefined,
  select: (chats: ChatDirectory) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  return useSyncExternalStoreWithSelector(
    (notice) =>
      parent === undefined ? subscribeChats(notice) : subscribeChildChats(parent, notice),
    chatDirectory,
    chatDirectory,
    select,
    isEqual,
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

/** The folder a chat runs in, whatever folder the window has open; undefined for Home, an unreachable folder, or while the lists load. */
export function useChatWorkspace(id: SessionId): SelectedWorkspace | undefined {
  return useChats(
    (chats) => {
      const location = chats.get(id)?.location;

      return location?.kind === "folder" && location.available
        ? { id: location.workspace, path: location.path, name: location.name }
        : undefined;
    },
    (previous, next) =>
      previous?.id === next?.id && previous?.path === next?.path && previous?.name === next?.name,
  );
}

/** Null for Home, undefined until the folder list loads. */
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

function subscribeChildChats(parent: SessionId, notice: () => void): () => void {
  const leave = [subscribeChats(notice), subscribeChildRows(parent, notice)];

  return () => {
    for (const unsubscribe of leave) unsubscribe();
  };
}

const directory = derivedStore(
  {
    rows: { read: sessionRows, subscribe: subscribeSessionRows },
    workspaces: {
      read: queryDataReader<readonly WorkspaceInfo[]>(keys.workspaces),
      subscribe: (notice: () => void) =>
        new QueryObserver(queryClient, workspacesQuery).subscribe(notice),
    },
    projects: {
      read: () => hostWatch("host").getState().value?.projects,
      subscribe: (notice: () => void) => hostWatch("host").subscribe(notice),
    },
  },
  (read, previous: ChatDirectory) =>
    describeChats(
      read.rows.read().rows.values(),
      read.workspaces.read(),
      read.projects.read(),
      previous,
    ),
  new Map<SessionId, Chat>(),
);

export const chatDirectory = directory.getSnapshot;

export const subscribeChats = directory.subscribe;
