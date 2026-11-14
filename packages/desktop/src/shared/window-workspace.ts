import { basename } from "node:path";
import type { SelectedWorkspace } from "@nyte-ai/app/contract/bridge.ts";
import type { WorkspaceInfo } from "@nyte-ai/sdk/client";
import type { HostWindow, WindowEnd } from "./host-window.ts";

/**
 * The folder a window reopening on a chat shows: the chat's local folder, unless the host can't
 * reach it or it has project sources nobody has trusted yet, which the window asks about instead.
 */
export function restorableFolder(workspace: WorkspaceInfo | null): SelectedWorkspace | undefined {
  if (
    workspace === null ||
    workspace.availability.kind === "unavailable" ||
    workspace.target.kind !== "local" ||
    !("path" in workspace.target) ||
    (workspace.trusted === null && workspace.projectSources.length > 0)
  )
    return undefined;
  const path = workspace.target.path;

  return { id: workspace.id, path, name: basename(path) };
}

interface WindowWorkspace {
  readonly seed: string | undefined;
  readonly shown: string | undefined;
}

/**
 * Main's mirror of the path of the workspace each window shows, read only to route Finder's Open
 * With. The window's page owns the fact and says every change; a new page starts on the folder
 * Finder opened the window for, as the page itself does, until it says otherwise.
 */
export function createWindowWorkspaces() {
  const windows = new Map<HostWindow, WindowWorkspace>();

  return {
    opened(window: HostWindow, seed: string | undefined): void {
      windows.set(window, { seed, shown: seed });
    },
    shown(window: HostWindow, path: string | undefined): void {
      const entry = windows.get(window);

      if (entry !== undefined) windows.set(window, { seed: entry.seed, shown: path });
    },
    windowEnded(window: HostWindow, end: WindowEnd): void {
      const entry = windows.get(window);

      if (entry === undefined) return;

      if (end === "closed") windows.delete(window);
      else windows.set(window, { seed: entry.seed, shown: entry.seed });
    },
    workspace(window: HostWindow): string | undefined {
      return windows.get(window)?.shown;
    },
  };
}

export type WindowWorkspaces = ReturnType<typeof createWindowWorkspaces>;
