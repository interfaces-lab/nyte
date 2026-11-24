import { SdkError } from "@nyte-ai/schema";
import type { StorageCleanup, StorageScan } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { StorageProvider, StorageWorkspace } from "../contract/workspace.ts";
import { listSessionRecords, liveRuns, workspaceRecords } from "../store/session.ts";

export async function scanStorage(kernel: Kernel): Promise<StorageScan> {
  return localStorage(kernel).scan(await storageWorkspaces(kernel));
}

export async function cleanStorage(
  kernel: Kernel,
  items: readonly string[],
): Promise<StorageCleanup> {
  return localStorage(kernel).clean(await storageWorkspaces(kernel), items);
}

function localStorage(kernel: Kernel): StorageProvider {
  const storage = kernel.environments.provider("local")?.storage;

  if (storage === undefined) {
    throw new SdkError("unavailable", "This host has no local disk to clean.");
  }

  return storage;
}

async function storageWorkspaces(kernel: Kernel): Promise<readonly StorageWorkspace[]> {
  const [records, sessions] = await Promise.all([
    workspaceRecords(kernel.store),
    listSessionRecords(kernel.store),
  ]);

  const running = new Set(
    (
      await Promise.all(
        sessions.map(async (session) =>
          (await liveRuns(kernel.store, session.id)).length > 0 ? [session.workspace] : [],
        ),
      )
    ).flat(),
  );

  return records.map((record) => {
    const on = sessions.filter((session) => session.workspace === record.id);

    return {
      target: record.target,
      worktree: record.isolation !== null && record.isolation !== undefined,
      usedAt: Math.max(record.createdAt, ...on.map((session) => session.lastActivityAt)),
      running: running.has(record.id),
    };
  });
}
