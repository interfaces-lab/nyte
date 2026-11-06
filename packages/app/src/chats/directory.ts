import {
  mainHead,
  runStatus,
  sessionMark,
  sessionTitle,
} from "@nyte-ai/plugin/client/presentation";
import type { BackgroundWork, RunStatus, TaskState } from "@nyte-ai/plugin/client/presentation";
import type {
  CommitId,
  HeadName,
  SessionId,
  SessionInfo,
  WorkspaceId,
  ProjectInfo,
  WorkspaceInfo,
} from "@nyte-ai/sdk";
import { replaceEqualDeep } from "@tanstack/react-query";
import { coordinatedProject } from "../data/projects.ts";
import { workspaceName, workspacePath } from "../data/workspaces.ts";

export interface Folder {
  readonly workspace: WorkspaceId;
  readonly path: string;
  readonly name: string;
}

export type ChatLocation =
  | { readonly kind: "loading" }
  | { readonly kind: "unlisted" }
  | (Folder & {
      readonly kind: "folder";
      readonly available: boolean;
      readonly worktree: { readonly branch: string; readonly source: Folder | null } | null;
    });

export interface Chat {
  readonly id: SessionId;
  readonly parent: SessionId | null;
  readonly title: string;
  readonly location: ChatLocation;
  readonly status: RunStatus;
  readonly background: BackgroundWork;
  readonly mark: TaskState;
  readonly unreadTip: UnreadTip | null;
}

export interface UnreadTip {
  readonly head: HeadName;
  readonly commit: CommitId;
}

export type ChatDirectory = ReadonlyMap<SessionId, Chat>;

export function describeChats(
  sessions: Iterable<SessionInfo>,
  workspaces: readonly WorkspaceInfo[] | undefined,
  projects: readonly ProjectInfo[] | undefined,
  previous: ChatDirectory,
): ChatDirectory {
  const names = new Map((projects ?? []).map((project) => [project.id, project.name] as const));

  const chats = new Map(
    [...sessions].map((session) => {
      const head = mainHead(session);
      const project = coordinatedProject(session);

      const next: Chat = {
        id: session.id,
        parent: session.parent,
        title: (project === undefined ? undefined : names.get(project)) ?? sessionTitle(session),
        location: workspaces === undefined ? LOADING : locate(session.workspace, workspaces),
        status: runStatus(head?.execution),
        background: head?.background ?? NO_BACKGROUND,
        mark: project === undefined ? sessionMark(session) : coordinatorMark(session),
        unreadTip:
          head?.unread === true && head.tip.kind === "commit"
            ? { head: head.name, commit: head.tip.id }
            : null,
      };

      return [session.id, replaceEqualDeep(previous.get(session.id), next)] as const;
    }),
  );

  return chats.size === previous.size && [...chats].every(([id, chat]) => previous.get(id) === chat)
    ? previous
    : chats;
}

const LOADING: ChatLocation = { kind: "loading" };

const UNLISTED: ChatLocation = { kind: "unlisted" };

const NO_BACKGROUND: BackgroundWork = { working: 0, waiting: 0 };

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

function coordinatorMark(session: SessionInfo): TaskState {
  const mark = sessionMark(session);

  return mark === "background" ? "working" : mark;
}
