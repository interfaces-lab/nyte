import { basename } from "node:path";
import type { SelectedWorkspace } from "@nyte-ai/app/contract/bridge.ts";
import type { WorkspaceInfo } from "@nyte-ai/sdk/client";

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
