import { mainHead, runStatus, sessionTitle } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus } from "@nyte-ai/plugin/client/presentation";
import type {
  CommitId,
  Execution,
  HeadName,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/sdk";
import { workspaceName, workspacePath } from "../view-helpers.ts";

export interface Folder {
  readonly workspace: WorkspaceId;
  readonly path: string;
  readonly name: string;
}

/** Where a chat runs. Until the folder list loads it is unknown, which is not the same as having no folder. */
export type ChatLocation =
  | { readonly kind: "loading" }
  /** The chat's workspace isn't a local folder in the list; the host opens Home for it. */
  | { readonly kind: "unlisted" }
  | (Folder & {
      readonly kind: "folder";
      readonly available: boolean;
      /** A worktree runs in its own folder; `source` is the folder it was made from, when listed. */
      readonly worktree: { readonly branch: string; readonly source: Folder | null } | null;
    });

export interface Chat {
  readonly id: SessionId;
  readonly parent: SessionId | null;
  readonly title: string;
  readonly location: ChatLocation;
  readonly status: RunStatus;
  /** The main head's tip while it is past the read mark, from the chat's open view when it has one; null once read. */
  readonly unreadTip: UnreadTip | null;
}

export interface UnreadTip {
  readonly head: HeadName;
  readonly commit: CommitId;
}

export type ChatDirectory = ReadonlyMap<SessionId, Chat>;

export interface ChatSources {
  /** Session lists, most complete first: a session takes its row from the first list that has it. */
  readonly lists: readonly (readonly SessionInfo[] | undefined)[];
  /** Each session whose view is open. Its execution and read state replace the listed head's as a unit. */
  readonly views: ReadonlyMap<SessionId, Pick<SessionView, "execution" | "heads">>;
  readonly workspaces: readonly WorkspaceInfo[] | undefined;
  /** The session as pending renames, pins, archives and deletes leave it; null once deleted. */
  readonly project: (session: SessionInfo) => SessionInfo | null;
}

/**
 * Joins the session lists, the open views and the folder list into one chat per session.
 * A chat that comes out the same as in `previous` keeps its identity, and so does the
 * directory when no chat changed.
 */
export function joinChats(sources: ChatSources, previous: ChatDirectory): ChatDirectory {
  const sessions = new Map<SessionId, SessionInfo | null>();

  for (const list of sources.lists)
    for (const session of list ?? [])
      if (!sessions.has(session.id)) sessions.set(session.id, sources.project(session));

  const listed = [...sessions.values()].filter((session) => session !== null);

  const heads = new Map(
    listed.map((session): readonly [SessionId, Head] => {
      const view = sources.views.get(session.id);
      const head = mainHead(view ?? session);

      return [
        session.id,
        {
          execution: view === undefined ? head?.execution : view.execution,
          unreadTip:
            head?.unread === true && head.tip.kind === "commit"
              ? { head: head.name, commit: head.tip.id }
              : null,
        },
      ];
    }),
  );

  const delegating = activeAncestors(listed, heads);
  const workspaces = sources.workspaces;
  let changed = listed.length !== previous.size;

  const chats = new Map(
    listed.map((session) => {
      const head = heads.get(session.id);

      const next: Chat = {
        id: session.id,
        parent: session.parent,
        title: sessionTitle(session),
        location: workspaces === undefined ? LOADING : locate(session.workspace, workspaces),
        status: runStatus(head?.execution, delegating.has(session.id)),
        unreadTip: head?.unreadTip ?? null,
      };

      const known = previous.get(session.id);

      const chat =
        known !== undefined &&
        known.parent === next.parent &&
        known.title === next.title &&
        JSON.stringify(known.unreadTip) === JSON.stringify(next.unreadTip) &&
        JSON.stringify(known.status) === JSON.stringify(next.status) &&
        JSON.stringify(known.location) === JSON.stringify(next.location)
          ? known
          : next;

      if (chat !== known) changed = true;

      return [session.id, chat] as const;
    }),
  );

  return changed ? chats : previous;
}

/** The run and read state a chat's main head reports, from its open view when it has one. */
interface Head {
  readonly execution: Execution | undefined;
  readonly unreadTip: UnreadTip | null;
}

const LOADING: ChatLocation = { kind: "loading" };

const UNLISTED: ChatLocation = { kind: "unlisted" };

/** Every chat with a run going somewhere below it, waiting runs included. */
function activeAncestors(
  sessions: readonly SessionInfo[],
  heads: ReadonlyMap<SessionId, Head>,
): ReadonlySet<SessionId> {
  const parents = new Map(sessions.map((session) => [session.id, session.parent]));
  const active = new Set<SessionId>();

  for (const session of sessions) {
    const execution = heads.get(session.id)?.execution;

    if (execution === undefined || execution.kind === "idle") continue;

    for (let parent = session.parent; parent !== null; parent = parents.get(parent) ?? null) {
      if (active.has(parent)) break;
      active.add(parent);
    }
  }

  return active;
}

function locate(workspace: WorkspaceId, workspaces: readonly WorkspaceInfo[]): ChatLocation {
  const info = workspaces.find((candidate) => candidate.id === workspace);
  const folder = info === undefined ? null : listedFolder(info);

  if (info === undefined || folder === null) return UNLISTED;
  const isolation = info.isolation;
  const source = workspaces.find((candidate) => candidate.id === isolation?.source);

  return {
    kind: "folder",
    ...folder,
    available: info.availability.kind === "available",
    worktree:
      isolation === null
        ? null
        : {
            branch: isolation.branch,
            source: source === undefined ? null : listedFolder(source),
          },
  };
}

function listedFolder(workspace: WorkspaceInfo): Folder | null {
  const path = workspacePath(workspace);

  return path === null ? null : { workspace: workspace.id, path, name: workspaceName(workspace) };
}
