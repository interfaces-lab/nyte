import type { WorkspaceInfo } from "@nyte-ai/sdk";
import { AccessibilityInfo } from "react-native";
import type { RegistryFolders } from "./workspace-start.tsx";

export type WorkspaceMenu =
  | { kind: "loading" }
  | { kind: "failed"; message: string; retry: () => void }
  | { kind: "ready"; label: string | undefined; choices: readonly WorkspaceChoice[] };

interface WorkspaceChoice {
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

export function workspaceMenu(folders: RegistryFolders, onChange: () => void): WorkspaceMenu {
  switch (folders.kind) {
    case "loading":
      return { kind: "loading" };
    case "failed":
      return { kind: "failed", message: folders.message, retry: folders.refresh };
    case "ready":
      return {
        kind: "ready",
        label: folders.selected === undefined ? undefined : workspaceName(folders.selected),
        choices: folders.ready.map((row) => ({
          key: row.id,
          label: workspaceName(row),
          selected: row.id === folders.selected?.id,
          choose: () => {
            if (row.id === folders.selected?.id) return;
            folders.choose(row.id);
            AccessibilityInfo.announceForAccessibility(`Workspace ${workspaceName(row)}`);
            onChange();
          },
        })),
      };
    default: {
      const exhaustive: never = folders;

      return exhaustive;
    }
  }
}
