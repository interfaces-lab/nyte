import type {
  BatchOutcome,
  FileBatch,
  RestoreOutcome,
  TrashOutcome,
  TrashToken,
  WorkspaceId,
  WriteOutcome,
} from "@nyte-ai/sdk";
import { filesFor } from "../../data/files.ts";

export async function createFile(
  workspace: WorkspaceId | undefined,
  path: string,
): Promise<WriteOutcome> {
  return (await filesFor(workspace)).write(path, "", { expect: "absent", parents: true });
}

export async function applyChange(
  workspace: WorkspaceId | undefined,
  change: (batch: FileBatch) => FileBatch,
): Promise<string | undefined> {
  const files = await filesFor(workspace);

  return batchFailure(await (await change(files.batch()).apply()).settled());
}

export async function trashEntry(
  workspace: WorkspaceId | undefined,
  path: string,
): Promise<TrashOutcome> {
  return (await filesFor(workspace)).trash(path);
}

export async function restoreEntry(
  workspace: WorkspaceId | undefined,
  token: TrashToken,
): Promise<RestoreOutcome> {
  return (await filesFor(workspace)).restore(token);
}

export async function removeEntry(
  workspace: WorkspaceId | undefined,
  path: string,
): Promise<WriteOutcome> {
  return (await filesFor(workspace)).remove(path);
}

function batchFailure(outcome: BatchOutcome): string | undefined {
  switch (outcome.kind) {
    case "applied":
      return undefined;
    case "stale":
      return `${outcome.paths[0] ?? "A file"} changed.`;
    case "partial":
      return outcome.reason;
    case "stopped":
      return "The change was stopped before it finished.";
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}
