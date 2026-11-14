import type { Connection } from "@nyte-ai/sdk";
import type { RegisterWorkspaceOutcome } from "./bridge.ts";
import { errorMessage } from "./errors.ts";

/**
 * Adds the folder at `path` to the host's workspaces, trusting it first when `trust` is set. Both
 * bridges register through this, so a folder carries the host's own path and a failure reads the
 * same on each: it comes back as `failed` with words a person can read, never as a rejection.
 */
export async function registerFolder(
  host: () => Promise<Pick<Connection, "workspaces" | "workspace">>,
  path: string,
  trust: boolean,
): Promise<RegisterWorkspaceOutcome> {
  try {
    const connection = await host();
    const seen = await connection.workspaces.inspect({ kind: "local", path });

    const added = await connection.workspaces.add(seen.target, {
      expect: { identity: seen.identity },
    });

    if (added.kind === "stale")
      return { kind: "failed", message: "The folder changed. Try again." };

    if (added.kind === "unavailable")
      return { kind: "failed", message: "This folder is not available on the server." };

    if (trust) await connection.workspace(added.workspace).update({ projectResources: true });
    const workspace = await connection.workspace(added.workspace).info();
    const folder = "path" in workspace.target ? workspace.target.path : path;

    return {
      kind: "registered",
      workspace: {
        id: workspace.id,
        path: folder,
        name: folder.split(/[\\/]/u).filter(Boolean).at(-1) ?? folder,
      },
      needsTrust: workspace.trusted === null && seen.projectSources.length > 0,
    };
  } catch (cause) {
    return { kind: "failed", message: errorMessage(cause) };
  }
}
