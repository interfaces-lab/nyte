import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { FileStatus, SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { conversationTurns, editPatch, turnChangedFiles } from "../chats/index.ts";
import { chatStore } from "../data/chat-store.ts";
import type { ChatView } from "../data/chat-store.ts";
import { reconcile } from "../data/keep.ts";
import { sessionRows, subscribeSessionRows } from "../data/session-rows.ts";

/** A file the workspace's chats changed, by the path their tools named, and the patches their edits made to it, newest first. */
export interface ChatEdit {
  readonly path: string;
  readonly status: FileStatus;
  readonly patches: readonly ChatPatch[];
}

interface ChatPatch {
  readonly patch: string;
  readonly session: SessionId;
  readonly at: number;
}

interface DatedPatch extends ChatPatch {
  readonly path: string;
  readonly created: boolean;
}

interface ChatEdits {
  readonly patched: readonly DatedPatch[];
  readonly charged: readonly string[];
}

const chatEdits = new WeakMap<ChatView, ChatEdits>();

/**
 * What `select` reads from the files every chat in `workspace` changed, whichever window the chat runs in: those their
 * edit tools patched, and those their turns' snapshots charged to them. It renders again only when what it read
 * changes, so switching between chats renders nothing here. Without a workspace it reads and follows nothing.
 */
export function useChatChanges<T>(
  workspace: WorkspaceId | undefined,
  select: (edits: readonly ChatEdit[] | undefined) => T,
): T {
  return useSyncExternalStoreWithSelector(
    (notice) => (workspace === undefined ? () => undefined : followChats(workspace, notice)),
    () => readChats(workspace),
    () => readChats(workspace),
    select,
    Value.Equal,
  );
}

function readChats(workspace: WorkspaceId | undefined): readonly ChatEdit[] | undefined {
  if (workspace === undefined) return undefined;

  const chats = workspaceChats(workspace).flatMap((session) => {
    const view = chatStore(session.id).getState().value;

    return view === undefined ? [] : [{ session: session.id, view }];
  });

  const views = chats.map((chat) => chat.view);

  const edits = chats.map((chat) => readChat(chat.session, chat.view));

  const patched = edits
    .flatMap((chat) => chat.patched)
    .toSorted((first, second) => second.at - first.at);

  const paths = [
    ...new Set([...patched.map((edit) => edit.path), ...edits.flatMap((chat) => chat.charged)]),
  ];

  if (paths.length === 0) return undefined;

  const statuses = new Map(
    views.flatMap((view) => view.changes.map((file) => [file.path, file.status] as const)),
  );

  return paths.map((path) => {
    const made = patched.filter((edit) => edit.path === path);

    return {
      path,
      status: statuses.get(path) ?? (made.at(-1)?.created === true ? "added" : "modified"),
      patches: made.map((edit) => ({ patch: edit.patch, session: edit.session, at: edit.at })),
    };
  });
}

function readChat(session: SessionId, view: ChatView): ChatEdits {
  const known = chatEdits.get(view);

  if (known !== undefined) return known;

  const read = {
    patched: view.messages
      .flatMap((message) => {
        const edit = showsTool(message) ? editPatch(message) : undefined;

        return edit === undefined
          ? []
          : [
              {
                path: edit.path,
                patch: edit.patch,
                created: edit.created,
                at: message.at,
                session,
              },
            ];
      })
      .toReversed(),
    charged: conversationTurns(view).toReversed().flatMap(turnChangedFiles),
  };

  chatEdits.set(view, read);

  return read;
}

function followChats(workspace: WorkspaceId, notice: () => void): () => void {
  const followed = new Map<SessionId, () => void>();

  const follow = (): void =>
    reconcile(
      followed,
      new Set(workspaceChats(workspace).map((session) => session.id)),
      (session) => chatStore(session).subscribeByFrame(notice),
      (leave) => leave(),
    );

  follow();

  const stop = subscribeSessionRows(() => {
    follow();
    notice();
  });

  return () => {
    stop();

    for (const leave of followed.values()) leave();
  };
}

function workspaceChats(workspace: WorkspaceId): readonly SessionInfo[] {
  return [...sessionRows().rows.values()]
    .filter((session) => session.workspace === workspace && !session.archived)
    .toSorted((first, second) => first.lastActivityAt - second.lastActivityAt);
}
