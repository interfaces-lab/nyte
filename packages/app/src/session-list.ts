import type { SessionInfo, WorkspaceId } from "@nyte-ai/sdk";

export interface WorkspaceSessions {
  readonly workspace: WorkspaceId;
  readonly workspacePath: string | null;
  readonly sessions: readonly SessionInfo[];
}

export function groupByWorkspace(
  sessions: readonly SessionInfo[],
  workspaces: readonly {
    readonly id: WorkspaceId;
    readonly path: string;
    readonly worktree?: { readonly source: WorkspaceId } | null;
  }[],
): readonly WorkspaceSessions[] {
  const groups = new Map<WorkspaceId, SessionInfo[]>();

  for (const session of sessions) {
    const folder =
      workspaces.find((candidate) => candidate.id === session.workspace)?.worktree?.source ??
      session.workspace;

    const group = groups.get(folder) ?? [];
    group.push(session);
    groups.set(folder, group);
  }

  return [...groups].map(([workspace, rows]) => {
    const info = workspaces.find((candidate) => candidate.id === workspace);

    return {
      workspace,
      workspacePath: info === undefined ? null : info.path,
      sessions: rows,
    };
  });
}

export function localSessions(
  groups: readonly WorkspaceSessions[],
  workspace: WorkspaceId | null,
): readonly SessionInfo[] | undefined {
  return workspace === null
    ? groups.flatMap((group) => (group.workspacePath === null ? group.sessions : []))
    : groups.find((group) => group.workspace === workspace)?.sessions;
}
