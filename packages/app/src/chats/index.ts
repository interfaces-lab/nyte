import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { SessionId, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { QueryObserver, skipToken } from "@tanstack/react-query";
import { appSessionActions, keys, queryClient, useSession, workspacesQuery } from "../queries.ts";
import { openViews, sessionsWatch, subscribeOpenViews } from "../sdk.tsx";
import { joinChats } from "./directory.ts";
import type { Chat, ChatDirectory } from "./directory.ts";

export type { Chat, ChatDirectory, ChatLocation, Folder } from "./directory.ts";

export type ChatResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly chat: Chat };

/**
 * One chat as every surface shows it. Re-renders only when that chat changes. A chat the
 * lists don't carry yet, such as one just started, is read on its own and joined the same way.
 */
export function useChat(id: SessionId): ChatResult {
  const listed = useSyncExternalStore(
    subscribeChats,
    () => readChat(id),
    () => readChat(id),
  );

  const unlisted = useSession(listed.kind === "missing" ? id : undefined).data;

  return listed.kind === "missing" && unlisted !== undefined && unlisted !== null
    ? readUnlisted(unlisted)
    : listed;
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

const unlistedResults = new WeakMap<SessionInfo, ChatResult>();

function readUnlisted(session: SessionInfo): ChatResult {
  const known = unlistedResults.get(session);

  if (known !== undefined) return known;

  const chat = joinChats(
    {
      lists: [[session]],
      views: openViews(),
      workspaces: queryClient.getQueryData(keys.workspaces),
      project: (listed) => listed,
    },
    new Map(),
  ).get(session.id);

  const result: ChatResult = chat === undefined ? MISSING : { kind: "ready", chat };

  unlistedResults.set(session, result);

  return result;
}

interface Read {
  readonly all: readonly SessionInfo[] | undefined;
  readonly roots: readonly SessionInfo[] | undefined;
  readonly recorded: readonly SessionInfo[] | undefined;
  readonly views: ReturnType<typeof openViews>;
  readonly workspaces: readonly WorkspaceInfo[] | undefined;
  readonly pending: ReturnType<ReturnType<typeof appSessionActions>["getSnapshot"]>;
}

let read: Read | undefined;

let directory: ChatDirectory = new Map();

/** Every chat this connection lists, joined again only when one of its sources changed. */
export function chatDirectory(): ChatDirectory {
  const actions = appSessionActions();

  const next: Read = {
    all: sessionsWatch("all").value,
    roots: sessionsWatch("roots").value,
    recorded: queryClient.getQueryData(keys.firstFrameRoots),
    views: openViews(),
    workspaces: queryClient.getQueryData(keys.workspaces),
    pending: actions.getSnapshot(),
  };

  if (
    read !== undefined &&
    read.all === next.all &&
    read.roots === next.roots &&
    read.recorded === next.recorded &&
    read.views === next.views &&
    read.workspaces === next.workspaces &&
    read.pending === next.pending
  )
    return directory;

  read = next;

  directory = joinChats(
    {
      lists: [next.all, next.roots ?? next.recorded],
      views: next.views,
      workspaces: next.workspaces,
      project: (session) => actions.projectSession(session, next.pending),
    },
    directory,
  );

  return directory;
}

const listeners = new Set<() => void>();

let leaveSources: (() => void) | undefined;

/** Hears every change to the directory's sources; the sources are watched while anyone listens. */
export function subscribeChats(notice: () => void): () => void {
  listeners.add(notice);
  leaveSources ??= watchSources();

  return () => {
    listeners.delete(notice);

    if (listeners.size > 0) return;
    leaveSources?.();
    leaveSources = undefined;
  };
}

function watchSources(): () => void {
  const notify = (): void => {
    for (const notice of listeners) notice();
  };

  const leave = [
    sessionsWatch("all").subscribeByFrame(notify),
    sessionsWatch("roots").subscribeByFrame(notify),
    subscribeOpenViews(notify),
    appSessionActions().subscribe(notify),
    new QueryObserver(queryClient, workspacesQuery).subscribe(notify),
    new QueryObserver(queryClient, {
      queryKey: keys.firstFrameRoots,
      queryFn: skipToken,
    }).subscribe(notify),
  ];

  return () => {
    for (const unsubscribe of leave) unsubscribe();
  };
}
