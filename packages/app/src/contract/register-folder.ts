import type { Connection } from "@nyte-ai/sdk";
import type { RegisterWorkspaceOutcome } from "./bridge.ts";
import { errorMessage } from "./errors.ts";

const UNREADABLE_FOLDER = {
  local: "Nyte can't read this folder. Check that it exists and that Nyte has access to it.",
  server: "The server can't read this folder. Check the path on the server.",
} as const;

export async function registerFolder(
  host: () => Promise<Pick<Connection, "workspaces" | "workspace">>,
  path: string,
  trust: boolean,
  folders: keyof typeof UNREADABLE_FOLDER,
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
      return { kind: "failed", message: UNREADABLE_FOLDER[folders] };

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
