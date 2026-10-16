import type { SessionInfo, WorkspaceId } from "@nyte-ai/sdk";

export interface WorkspaceSessionDirectory {
  readonly environment: "local";
  readonly workspace: WorkspaceId;
  readonly workspacePath: string | null;
  readonly sessions: readonly SessionInfo[];
}

export function groupDirectory(
  sessions: readonly SessionInfo[],
  workspaces: readonly { readonly id: WorkspaceId; readonly path: string }[],
): readonly WorkspaceSessionDirectory[] {
  const groups = new Map<WorkspaceId, SessionInfo[]>();

  for (const session of sessions) {
    const group = groups.get(session.workspace) ?? [];
    group.push(session);
    groups.set(session.workspace, group);
  }

  return [...groups].map(([workspace, rows]) => {
    const info = workspaces.find((candidate) => candidate.id === workspace);

    return {
      environment: "local",
      workspace,
      workspacePath: info === undefined ? null : info.path,
      sessions: rows,
    };
  });
}

export function localSessions(
  directories: readonly WorkspaceSessionDirectory[],
  workspace: WorkspaceId | null,
): readonly SessionInfo[] | undefined {
  return workspace === null
    ? directories.flatMap((directory) =>
        directory.workspacePath === null ? directory.sessions : [],
      )
    : directories.find((directory) => directory.workspace === workspace)?.sessions;
}
