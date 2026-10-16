import type { WorkspaceInfo } from "@nyte-ai/sdk";

export type WorkspaceMenu =
  | { kind: "loading" }
  | { kind: "failed"; message: string; retry: () => void }
  | { kind: "ready"; label: string | undefined; choices: readonly WorkspaceChoice[] };

export interface WorkspaceChoice {
  readonly key: string;
  readonly label: string;
  readonly selected: boolean;
  readonly choose: () => void;
}

export function workspacePath(workspace: WorkspaceInfo): string {
  return "path" in workspace.target ? workspace.target.path : workspace.target.kind;
}

export function workspaceName(workspace: WorkspaceInfo): string {
  return workspacePath(workspace).split("/").filter(Boolean).at(-1) ?? workspacePath(workspace);
}
