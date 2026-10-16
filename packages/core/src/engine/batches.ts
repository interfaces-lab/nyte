import { asId, SdkError } from "@nyte-ai/schema";
import type {
  BatchOutcome,
  BlobId,
  Json,
  ReceiptId,
  SnapshotId,
  WriteOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { Receipt } from "../contract/session.ts";
import type { BatchEntry, FilesApi, FileScope } from "../contract/workspace.ts";
import { writeReceipt } from "../fold/commit.ts";
import { readReceipt } from "../store/session.ts";
import { blobId, objectId } from "../util/content.ts";
import { settleReceipt, typedReceipt } from "./receipts.ts";
import { waitFor } from "./waits.ts";
import type { StoreConnection } from "../contract/store.ts";

export const EMPTY_SNAPSHOT: SnapshotId = asId<"snapshot">("");

const HELD_RECEIPTS = 256;

export function heldReceipt(kernel: Kernel, id: ReceiptId): Receipt<BatchOutcome> | undefined {
  return kernel.workspaceState.held.get(id)?.receipt;
}

export async function applyBatch(
  kernel: Kernel,
  scope: FileScope,
  files: FilesApi,
  entries: readonly BatchEntry[],
  options?: { readonly id?: ReceiptId },
): Promise<Receipt<BatchOutcome>> {
  const id = options?.id ?? asId<"receipt">(crypto.randomUUID());
  const controller = new AbortController();
  const table = kernel.workspaceState.batches;

  const digest = await hashFileBatch(entries);

  if ("session" in scope) {
    const { session } = scope;
    const receipt = typedReceipt(kernel, session, id, (record) => {
      if (record.kind !== "batch") throw new SdkError("internal", `Receipt ${id} is not a batch.`);

      return record.outcome;
    });
    const known = await readReceipt(kernel.store, session, id);

    if (known !== null) {
      if (known.record.kind !== "batch" || known.record.digest !== digest)
        throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

      return receipt;
    }

    await writeReceipt(kernel, session, { id, kind: "batch", digest, outcome: null });
    table.set(id, controller);

    void execute(kernel, scope, files, entries, id, controller.signal)
      .then((outcome) => settleReceipt(kernel, session, id, { kind: "batch", outcome }))
      .finally(() => table.delete(id));

    return receipt;
  }

  const receipts = kernel.workspaceState.held;
  const replayed = receipts.get(id);

  if (replayed !== undefined) {
    if (replayed.workspace !== scope.workspace || replayed.digest !== digest)
      throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

    return replayed.receipt;
  }

  let outcome: BatchOutcome | null = null;
  const listeners = new Set<() => void>();
  table.set(id, controller);

  void execute(kernel, scope, files, entries, id, controller.signal)
    .then((settled) => {
      outcome = settled;

      for (const listener of listeners) listener();
    })
    .finally(() => table.delete(id));

  const receipt: Receipt<BatchOutcome> = {
    id,
    status: async () => (outcome === null ? { kind: "pending" } : { kind: "settled", outcome }),
    settled: (options) =>
      waitFor({
        options,
        check: async () => (outcome === null ? null : { value: outcome }),
        subscribe(trigger) {
          listeners.add(trigger);

          return () => {
            listeners.delete(trigger);
          };
        },
      }),
    async stop() {
      if (outcome !== null) return { kind: "settled", outcome };
      controller.abort();

      return { kind: "requested" };
    },
  };

  receipts.set(id, { receipt, workspace: scope.workspace, digest });

  for (const oldest of receipts.keys()) {
    if (receipts.size <= HELD_RECEIPTS) break;
    receipts.delete(oldest);
  }

  return receipt;
}

async function execute(
  kernel: Kernel,
  scope: FileScope,
  files: FilesApi,
  entries: readonly BatchEntry[],
  id: ReceiptId,
  signal: AbortSignal,
): Promise<BatchOutcome> {
  const stale: string[] = [];

  for (const entry of entries) {
    if (entry.expect === undefined) continue;

    try {
      const current = (await files.stat(entry.path))?.version ?? null;

      if (entry.expect === "absent" ? current !== null : current !== entry.expect)
        stale.push(entry.path);
    } catch {
      stale.push(entry.path);
    }
  }

  if (stale.length > 0) return { kind: "stale", paths: stale };
  const applied: string[] = [];

  for (const [index, entry] of entries.entries()) {
    if (signal.aborted) return { kind: "stopped", applied };
    const remaining = entries.slice(index).map((next) => next.path);
    let outcome: WriteOutcome;

    try {
      outcome =
        entry.kind === "remove"
          ? await files.remove(entry.path, { expect: entry.expect })
          : await files.write(entry.path, await resolveFileContents(kernel.store, entry.contents), {
              expect: entry.expect,
              parents: true,
            });
    } catch (error) {
      return {
        kind: "partial",
        applied,
        remaining,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.kind !== "saved")
      return {
        kind: "partial",
        applied,
        remaining,
        reason:
          outcome.kind === "stale"
            ? `${entry.path} moved while the batch ran.`
            : `${entry.path} has no parent directory.`,
      };
    applied.push(entry.path);
  }

  return {
    kind: "applied",
    snapshot: await captureFileSnapshot(kernel, scope, id),
    paths: applied,
  };
}

async function captureFileSnapshot(
  kernel: Kernel,
  scope: FileScope,
  id: ReceiptId,
): Promise<SnapshotId> {
  try {
    const snapshots =
      "session" in scope
        ? await kernel.snapshots(scope.session)
        : await kernel.environments.workspaceSnapshots(scope.workspace);

    return snapshots === null ? EMPTY_SNAPSHOT : await snapshots.after(asId<"run">(id));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

async function resolveFileContents(
  store: StoreConnection,
  contents: string | Uint8Array | { readonly blob: BlobId },
): Promise<string | Uint8Array> {
  if (typeof contents === "string" || contents instanceof Uint8Array) return contents;
  const reader = await store.objects.blob(contents.blob);

  if (reader === null) throw new SdkError("unknown", `No blob has the id ${contents.blob}.`);

  try {
    const chunks: Uint8Array[] = [];

    for await (const chunk of reader.chunks()) chunks.push(chunk);
    const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;

    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return joined;
  } finally {
    await reader.close();
  }
}

async function hashFileBatch(entries: readonly BatchEntry[]): Promise<string> {
  const described = await Promise.all(
    entries.map(async (entry): Promise<Json> => ({
      kind: entry.kind,
      path: entry.path,
      expect: entry.expect ?? null,
      contents:
        entry.kind === "remove"
          ? null
          : typeof entry.contents === "string"
            ? entry.contents
            : `bytes:${entry.contents instanceof Uint8Array ? await blobId(entry.contents) : entry.contents.blob}`,
    })),
  );

  return objectId(described);
}
