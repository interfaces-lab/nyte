import {
  headAttention,
  mainHead,
  runStatus,
  sessionTitle,
} from "@nyte-ai/plugin/client/presentation";
import type {
  BackgroundWork,
  HeadAttention,
  RunStatus,
  TaskState,
} from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo, WorkspaceId, ProjectInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { replaceEqualDeep } from "@tanstack/react-query";
import { coordinatedProject } from "../data/projects.ts";
import { workspaceName, workspacePath } from "../data/workspaces.ts";

interface Folder {
  readonly workspace: WorkspaceId;
  readonly path: string;
  readonly name: string;
}

type ChatLocation =
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
  readonly unreadTip: HeadAttention["unreadTip"];
  readonly settledUnread: boolean;
}

export type ChatDirectory = ReadonlyMap<SessionId, Chat>;

export interface ChatMark {
  readonly state: TaskState;
  readonly unread: boolean;
}

export function describeChats(
  sessions: Iterable<SessionInfo>,
  workspaces: readonly WorkspaceInfo[] | undefined,
  projects: readonly ProjectInfo[] | undefined,
  previous: ChatDirectory,
): ChatDirectory {
  const names = new Map((projects ?? []).map((project) => [project.id, project.name] as const));

  const folders =
    workspaces === undefined
      ? undefined
      : new Map(workspaces.map((workspace) => [workspace.id, workspace] as const));

  const chats = new Map(
    [...sessions].map((session) => {
      const known = described.get(session);

      if (
        known !== undefined &&
        known.workspaces === workspaces &&
        known.projects === projects &&
        previous.get(session.id) === known.chat
      ) {
        return [session.id, known.chat] as const;
      }
      const head = mainHead(session);
      const project = coordinatedProject(session);
      const attention = headAttention(session);

      const next: Chat = {
        id: session.id,
        parent: session.parent,
        title: (project === undefined ? undefined : names.get(project)) ?? sessionTitle(session),
        location: folders === undefined ? LOADING : locate(session.workspace, folders),
        status: runStatus(head?.execution),
        background: head?.background ?? NO_BACKGROUND,
        mark: attention.mark,
        unreadTip: attention.unreadTip,
        settledUnread: attention.settledUnread,
      };

      const chat = replaceEqualDeep(previous.get(session.id), next);
      described.set(session, { chat, workspaces, projects });

      return [session.id, chat] as const;
    }),
  );

  return chats.size === previous.size && [...chats].every(([id, chat]) => previous.get(id) === chat)
    ? previous
    : chats;
}

const described = new WeakMap<
  SessionInfo,
  {
    readonly chat: Chat;
    readonly workspaces: readonly WorkspaceInfo[] | undefined;
    readonly projects: readonly ProjectInfo[] | undefined;
  }
>();

const LOADING: ChatLocation = { kind: "loading" };

const UNLISTED: ChatLocation = { kind: "unlisted" };

const NO_BACKGROUND: BackgroundWork = { working: 0, waiting: 0 };

function locate(
  workspace: WorkspaceId,
  folders: ReadonlyMap<WorkspaceId, WorkspaceInfo>,
): ChatLocation {
  const info = folders.get(workspace);
  const folder = info === undefined ? null : listedFolder(info);

  if (info === undefined || folder === null) return UNLISTED;
  const isolation = info.isolation;
  const source = isolation === null ? undefined : folders.get(isolation.source);

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
