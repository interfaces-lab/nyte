import { basename } from "node:path";
import type { SelectedWorkspace } from "@nyte-ai/app/contract/bridge.ts";
import type { WorkspaceInfo } from "@nyte-ai/sdk/client";
import type { HostWindow, WindowEnd } from "./host-window.ts";

export function restorableFolder(workspace: WorkspaceInfo | null): SelectedWorkspace | undefined {
  if (
    workspace === null ||
    workspace.availability.kind === "unavailable" ||
    workspace.target.kind !== "local" ||
    !("path" in workspace.target) ||
    (workspace.trust.state === "undecided" && workspace.trust.notice === "ask")
  ) {
    return undefined;
  }
  const path = workspace.target.path;

  return { id: workspace.id, path, name: basename(path) };
}

export function createWindowWorkspaces() {
  const windows = new Map<HostWindow, string | undefined>();

  return {
    opened(window: HostWindow, path: string | undefined): void {
      windows.set(window, path);
    },
    shown(window: HostWindow, path: string | undefined): void {
      if (windows.has(window)) windows.set(window, path);
    },
    windowEnded(window: HostWindow, end: WindowEnd): void {
      if (end === "closed") windows.delete(window);
    },
    workspace(window: HostWindow): string | undefined {
      return windows.get(window);
    },
  };
}

export type WindowWorkspaces = ReturnType<typeof createWindowWorkspaces>;
