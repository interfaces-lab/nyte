import type { SessionInfo, WorkspaceId } from "@nyte-ai/sdk";

/** The root sessions of one workspace; `workspacePath` is null for a workspace no folder backs. */
export interface WorkspaceSessionDirectory {
  readonly environment: "local";
  readonly workspace: WorkspaceId;
  readonly workspacePath: string | null;
  readonly sessions: readonly SessionInfo[];
}

/** Groups root sessions by workspace in the directory's order; a workspace no row names is left out. */
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

/** The sessions of one workspace path; `null` is the workspace no folder backs. */
export function localSessions(
  directories: readonly WorkspaceSessionDirectory[],
  path: string | null,
): readonly SessionInfo[] | undefined {
  return directories.find((directory) => directory.workspacePath === path)?.sessions;
}
