import { asId } from "@nyte-ai/schema";
import type {
  BatchOutcome,
  BlobId,
  FileVersion,
  Json,
  ReceiptId,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WriteOutcome,
} from "@nyte-ai/schema";
import { blobId, objectId } from "./content.ts";
import type { FileBatch, FilesApi } from "./files.ts";
import type { Kernel } from "./kernel.ts";
import type { Receipt } from "./receipt.ts";
import { typedReceipt } from "./receipt-handles.ts";
import { settleReceipt } from "./receipts.ts";
import { SdkError } from "./error.ts";
import { isJsonObject, readReceipt, writeReceipt } from "./session-state.ts";
import { waitFor } from "./waits.ts";

/** Names where a batch receipt lives: a session's store (durable, `session.receipt(id)` finds it), or the host's memory for a workspace reached outside a session (§37b). */
export type FileScope = { readonly session: SessionId } | { readonly workspace: WorkspaceId };

/** Returns one planned write or removal. */
export type BatchEntry =
  | {
      readonly kind: "put";
      readonly path: string;
      readonly contents: string | Uint8Array | BlobId;
      readonly expect?: FileVersion | "absent";
    }
  | { readonly kind: "remove"; readonly path: string; readonly expect?: FileVersion };

/** The snapshot an applied batch reports when the environment takes none. */
export const EMPTY_SNAPSHOT: SnapshotId = asId<"snapshot">("");

const BLOB_ID = /^[0-9a-f]{64}$/;

const BATCH_OUTCOMES: ReadonlySet<string> = new Set(["applied", "stale", "partial", "stopped"]);

const HELD_RECEIPTS = 256;

/** Returns a workspace-scope batch receipt held in memory with what a replay by its id must match: the workspace and the plan's digest. */
type HeldBatch = {
  readonly receipt: Receipt<BatchOutcome>;
  readonly workspace: WorkspaceId;
  readonly digest: string;
};

const running = new WeakMap<Kernel, Map<ReceiptId, AbortController>>();

const held = new WeakMap<Kernel, Map<ReceiptId, HeldBatch>>();

/** Returns a provider's files with core's two members laid over them; every other member passes through. `upload(source)` stores the stream with `objects.putBlob` and returns its `BlobId`. `batch()` returns an empty plan; `put` and `remove` return a new plan with the entry appended, leaving the receiver unchanged. `apply()` returns a receipt at once (`Receipt<BatchOutcome>`) and the work then settles it: in a session scope the receipt is a `ReceiptRecord { kind: "batch", digest }` (`digest` the plan's content hash), also reachable as `session.receipt(id)`; in a workspace scope it is held in this process's memory (§37b). Every `expect` is checked first and any moved path settles `stale { paths }` with nothing written; then each entry is applied in plan order (a put creating missing directories; a string naming a stored blob puts that blob's bytes), and a write that answers anything but `saved`, or throws, stops the batch as `partial { applied, remaining, reason }`; all written settles `applied { snapshot, paths }`, `snapshot` the scope's run snapshots `after` keyed by the receipt id, or `EMPTY_SNAPSHOT` when the environment takes none. `stop()` on the receipt before it settles ends it before the next entry as `stopped { applied }`. */
export function wrapFiles(kernel: Kernel, scope: FileScope, files: FilesApi): FilesApi {
  const plan = (entries: readonly BatchEntry[]): FileBatch => ({
    put: (input) => plan([...entries, { kind: "put", ...input }]),
    remove: (input) => plan([...entries, { kind: "remove", ...input }]),
    apply: () => applyBatch(kernel, scope, files, entries),
  });

  return {
    read: (path) => files.read(path),
    bytes: (path) => files.bytes(path),
    stat: (path) => files.stat(path),
    write: (path, contents, options) => files.write(path, contents, options),
    remove: (path, options) => files.remove(path, options),
    batch: () => plan([]),
    format: (path, contents) => files.format(path, contents),
    scan: (input) => files.scan(input),
    find: (input) => files.find(input),
    search: (input) => files.search(input),
    watch: (input) => files.watch(input),
    upload: (source) => kernel.store.objects.putBlob(source),
  };
}

/** Returns a batch receipt this process holds in memory for a workspace scope (§37b), by id: what `receipt.*` with a null session reads (§40d); the latest 256 are held. */
export function heldReceipt(kernel: Kernel, id: ReceiptId): Receipt<BatchOutcome> | undefined {
  return held.get(kernel)?.get(id)?.receipt;
}

/** Stops a batch this process is applying, before its next entry; returns whether one was running. What a batch receipt's `stop()` does. */
export function stopBatch(kernel: Kernel, id: ReceiptId): boolean {
  const controller = running.get(kernel)?.get(id);
  controller?.abort();

  return controller !== undefined;
}

/** Returns whether a stored outcome is a batch's. */
export function isBatchOutcome(value: Json): value is BatchOutcome {
  return isJsonObject(value) && typeof value.kind === "string" && BATCH_OUTCOMES.has(value.kind);
}

/** Applies a batch plan over a scope's files and returns its receipt at once, as `FileBatch.apply()` does (see `wrapFiles`). `id` is the receipt's id (minted when absent): an id the scope already holds replays that receipt and applies nothing when the plan's digest matches (and, in a workspace scope, the workspace), else throws `invalid` (§40e, §40x). */
export async function applyBatch(
  kernel: Kernel,
  scope: FileScope,
  files: FilesApi,
  entries: readonly BatchEntry[],
  options?: { readonly id?: ReceiptId },
): Promise<Receipt<BatchOutcome>> {
  const id = options?.id ?? asId<"receipt">(crypto.randomUUID());
  const controller = new AbortController();
  const table = running.get(kernel) ?? new Map<ReceiptId, AbortController>();
  running.set(kernel, table);

  const digest = await digestOf(entries);

  if ("session" in scope) {
    const { session } = scope;
    const known = await readReceipt(kernel, session, id);

    if (known !== null) {
      if (known.record.kind !== "batch" || known.record.digest !== digest)
        throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

      return typedReceipt(kernel, session, id, isBatchOutcome);
    }

    await writeReceipt(kernel, session, { id, kind: "batch", digest, outcome: null });
    table.set(id, controller);

    void execute(kernel, scope, files, entries, id, controller.signal)
      .then((outcome) => settleReceipt(kernel, session, id, outcome))
      .finally(() => table.delete(id));

    return typedReceipt(kernel, session, id, isBatchOutcome);
  }

  const receipts = held.get(kernel) ?? new Map<ReceiptId, HeldBatch>();
  held.set(kernel, receipts);
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

/** Applies a plan and returns its outcome: every `expect` checked first, then each entry in order until one fails or the signal stops the batch. */
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
          : await files.write(entry.path, await contentsOf(kernel, entry.contents), {
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

  return { kind: "applied", snapshot: await snapshotOf(kernel, scope, id), paths: applied };
}

/** Returns the snapshot after a batch, keyed by its receipt id, or `EMPTY_SNAPSHOT` when the scope's environment takes none. */
async function snapshotOf(kernel: Kernel, scope: FileScope, id: ReceiptId): Promise<SnapshotId> {
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

/** Returns what a put writes: bytes as given, the bytes of a stored blob a string names, else the string as text. */
async function contentsOf(
  kernel: Kernel,
  contents: string | Uint8Array | BlobId,
): Promise<string | Uint8Array> {
  if (typeof contents !== "string" || !BLOB_ID.test(contents)) return contents;
  const reader = await kernel.store.objects.blob(asId<"blob">(contents));

  if (reader === null) return contents;

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

/** Returns a plan's content hash: each entry's kind, path, expect and contents (bytes by their blob id). */
async function digestOf(entries: readonly BatchEntry[]): Promise<string> {
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
            : `bytes:${await blobId(entry.contents)}`,
    })),
  );

  return objectId(described);
}
