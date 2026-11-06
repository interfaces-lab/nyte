import type {
  BatchOutcome,
  FileBatch,
  RestoreOutcome,
  TrashOutcome,
  TrashToken,
  WriteOutcome,
} from "@nyte-ai/sdk";
import { workspaceFiles } from "../../data/files.ts";

export async function createFile(path: string): Promise<WriteOutcome> {
  return (await workspaceFiles()).write(path, "", { expect: "absent", parents: true });
}

export async function applyChange(
  change: (batch: FileBatch) => FileBatch,
): Promise<string | undefined> {
  const files = await workspaceFiles();

  return batchFailure(await (await change(files.batch()).apply()).settled());
}

export async function trashEntry(path: string): Promise<TrashOutcome> {
  return (await workspaceFiles()).trash(path);
}

export async function restoreEntry(token: TrashToken): Promise<RestoreOutcome> {
  return (await workspaceFiles()).restore(token);
}

export async function removeEntry(path: string): Promise<WriteOutcome> {
  return (await workspaceFiles()).remove(path);
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
