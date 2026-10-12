import { asId } from "@nyte-ai/schema";
import type {
  BatchOutcome,
  BlobId,
  ByteReader,
  FileDocument,
  FileEntryView,
  FileEvent,
  FileVersion,
  FormatOutcome,
  Json,
  ReceiptId,
  ScanFrame,
  SearchFrame,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WriteOutcome,
} from "@nyte-ai/schema";
import { blobId, objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { Receipt } from "./receipt.ts";
import { typedReceipt } from "./receipt-handles.ts";
import { settleReceipt } from "./receipts.ts";
import { isJsonObject, readReceipt, writeReceipt } from "./session-state.ts";
import { waitFor } from "./waits.ts";

export interface FilesApi {
  read(path: string): Promise<FileDocument>;
  bytes(path: string): Promise<ByteReader>;
  stat(path: string): Promise<{
    readonly kind: "file" | "directory" | "symlink";
    readonly size: number;
    readonly version: FileVersion;
    readonly target?: string;
  } | null>;
  write(
    path: string,
    contents: string | Uint8Array,
    options?: { readonly expect?: FileVersion | "absent"; readonly parents?: boolean },
  ): Promise<WriteOutcome>;
  remove(path: string, options?: { readonly expect?: FileVersion }): Promise<WriteOutcome>;
  batch(): FileBatch;
  format(path: string, contents: string): Promise<FormatOutcome>;
  scan(input?: {
    readonly directory?: string;
    readonly ignored?: "exclude" | "include";
  }): AsyncIterable<ScanFrame>;
  find(input: {
    readonly query: string;
    readonly limit?: number;
  }): Promise<readonly FileEntryView[]>;
  search(input: { readonly query: string; readonly limit?: number }): AsyncIterable<SearchFrame>;
  watch(input?: { readonly paths?: readonly string[] }): AsyncIterable<readonly FileEvent[]>;
  upload(source: AsyncIterable<Uint8Array>): Promise<BlobId>;
}

export interface FileBatch {
  put(input: {
    readonly path: string;
    readonly contents: string | Uint8Array | BlobId;
    readonly expect?: FileVersion | "absent";
  }): FileBatch;
  remove(input: { readonly path: string; readonly expect?: FileVersion }): FileBatch;
  apply(): Promise<Receipt<BatchOutcome>>;
}

/** Names where a batch receipt lives: a session's store, or this host's memory for a workspace reached outside a session (§37b). */
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

/** Returns a workspace-scope batch receipt held in memory with what a replay by its id must match. */
export type HeldBatch = {
  readonly receipt: Receipt<BatchOutcome>;
  readonly workspace: WorkspaceId;
  readonly digest: string;
};

/** Returns a provider's files with core's `upload` (a stored blob) and `batch()` (immutable plans whose `apply` settles a receipt in `scope`) laid over them. */
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

/** Returns a workspace-scope batch receipt this process holds (§37b, §40d); the latest 256 are held. */
export function heldReceipt(kernel: Kernel, id: ReceiptId): Receipt<BatchOutcome> | undefined {
  return kernel.workspaceState.held.get(id)?.receipt;
}

/** Stops a batch this process is applying before its next entry; returns whether one was running. */
export function stopBatch(kernel: Kernel, id: ReceiptId): boolean {
  const controller = kernel.workspaceState.batches.get(id);
  controller?.abort();

  return controller !== undefined;
}

/** Returns whether a stored outcome is a batch's. */
export function isBatchOutcome(value: Json): value is BatchOutcome {
  return isJsonObject(value) && typeof value.kind === "string" && BATCH_OUTCOMES.has(value.kind);
}

/** Applies a plan over a scope's files and returns its receipt at once; a replayed `id` answers that receipt when the plan's digest matches and throws `invalid` otherwise (§40e, §40x). Every `expect` is checked before anything is written (`stale`), then entries apply in order until one fails (`partial`) or `stop()` (`stopped`). */
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

/** Returns the snapshot after a batch, keyed by its receipt id, or `EMPTY_SNAPSHOT`. */
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

/** Returns what a put writes: the bytes of a stored blob a string names, else the contents as given. */
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

/** Returns a plan's content hash, bytes by their blob id. */
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
