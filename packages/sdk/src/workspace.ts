import { asId } from "@nyte-ai/schema";
import type {
  BlobId,
  JobId,
  JobKey,
  OutputFrame,
  PageId,
  PatchSet,
  PatchSetWire,
  WorkspaceId,
} from "@nyte-ai/schema";
import { closable } from "@nyte-ai/core";
import type {
  BrowserApi,
  FileBatch,
  FilesApi,
  GitApi,
  Job,
  Jobs,
  Page,
  Workspace,
} from "@nyte-ai/core";
import type { OperationInput } from "@nyte-ai/protocol";
import { capabilityOf } from "./capability.ts";
import { batchOutcome, receiptHandle } from "./receipts.ts";
import type { Rows } from "./rows.ts";

type BatchEntry = OperationInput<"files.batch">["entries"][number];

type Pending =
  | ({ readonly kind: "put" } & Parameters<FileBatch["put"]>[0])
  | ({ readonly kind: "remove" } & Parameters<FileBatch["remove"]>[0]);

const encoder = new TextEncoder();

/**
 * Returns a handle on a workspace over the `workspace.*`, `jobs.*` and
 * `job.*` rows. `files()`, `git()` and `browser()` read the capability from
 * the host and bind its api to the `files.*`, `git.*` and `browser.*` /
 * `page.*` rows; `patches` rebuilds each `PatchSet`'s map. Binds
 * synchronously.
 */
export function workspaceHandle(rows: Rows, workspace: WorkspaceId): Workspace {
  return {
    id: workspace,
    info: () => rows.call("workspace.info", { workspace }),
    watch: () => rows.watch("workspace.watch", { workspace }),
    update: (patch) => rows.call("workspace.update", { workspace, patch }),
    reload: () => rows.call("workspace.reload", { workspace }),
    jobs: jobsApi(rows, workspace),
    job: (id) => jobHandle(rows, workspace, id, null),
    changes: (run) => rows.call("workspace.changes", { workspace, run }),
    patches: (run, paths, options) =>
      mapped(rows.frames("workspace.patches", { workspace, run, paths, options }), patchSet),
    files: async () =>
      capabilityOf(await rows.call("workspace.files", { workspace }), () =>
        filesApi(rows, workspace),
      ),
    git: async () =>
      capabilityOf(await rows.call("workspace.git", { workspace }), () => gitApi(rows, workspace)),
    browser: async () =>
      capabilityOf(await rows.call("workspace.browser", { workspace }), () =>
        browserApi(rows, workspace),
      ),
  };
}

/** Returns the files api over the `files.*` rows: `write` and `upload` send their bytes as the body, `bytes` answers a reader, and `batch()` an immutable plan whose `apply()` uploads `Uint8Array` contents first (§40i) and mints the batch's id (§40o). */
function filesApi(rows: Rows, workspace: WorkspaceId): FilesApi {
  const upload = (source: AsyncIterable<Uint8Array>): Promise<BlobId> =>
    rows.upload("files.upload", { workspace }, streamOf(source));

  const plan = (pending: readonly Pending[]): FileBatch => ({
    put: (input) => plan([...pending, { kind: "put", ...input }]),
    remove: (input) => plan([...pending, { kind: "remove", ...input }]),
    async apply() {
      const entries: BatchEntry[] = [];

      for (const entry of pending) {
        if (entry.kind === "remove") {
          entries.push(entry);
          continue;
        }

        const { contents, ...rest } = entry;

        entries.push({
          ...rest,
          contents: typeof contents === "string" ? contents : await upload(once(contents)),
        });
      }

      const { receipt } = await rows.call("files.batch", {
        workspace,
        entries,
        id: asId<"receipt">(crypto.randomUUID()),
      });

      return receiptHandle(rows, null, receipt, batchOutcome);
    },
  });

  return {
    read: (path) => rows.call("files.read", { workspace, path }),
    bytes: (path) => rows.bytes("files.bytes", { workspace, path }),
    stat: (path) => rows.call("files.stat", { workspace, path }),
    write: (path, contents, options) =>
      rows.upload(
        "files.write",
        { workspace, path, options },
        typeof contents === "string" ? encoder.encode(contents) : contents,
      ),
    remove: (path, options) => rows.call("files.remove", { workspace, path, options }),
    batch: () => plan([]),
    format: (path, contents) => rows.call("files.format", { workspace, path, contents }),
    scan: (input) => rows.frames("files.scan", { workspace, ...input }),
    find: (input) => rows.call("files.find", { workspace, ...input }),
    search: (input) => rows.frames("files.search", { workspace, ...input }),
    watch: (input) => rows.watch("files.watch", { workspace, ...input }),
    upload,
  };
}

/** Returns the git api over the `git.*` rows; `patches` rebuilds each `PatchSet`'s map. */
function gitApi(rows: Rows, workspace: WorkspaceId): GitApi {
  return {
    status: () => rows.call("git.status", { workspace }),
    watch: () => rows.watch("git.watch", { workspace }),
    changes: (scope, options) => rows.call("git.changes", { workspace, scope, options }),
    watchChanges: (scope, options) => rows.watch("git.watchChanges", { workspace, scope, options }),
    patches: (scope, paths, options) =>
      mapped(rows.frames("git.patches", { workspace, scope, paths, options }), patchSet),
    contents: (path, scope) => rows.call("git.contents", { workspace, path, scope }),
    log: (input) => rows.call("git.log", { workspace, ...input }),
    refs: () => rows.call("git.refs", { workspace }),
    blame: (path) => rows.call("git.blame", { workspace, path }),
    stage: (paths, options) => rows.call("git.stage", { workspace, paths, options }),
    unstage: (paths, options) => rows.call("git.unstage", { workspace, paths, options }),
    discard: (paths, options) => rows.call("git.discard", { workspace, paths, options }),
    commit: (input, options) => rows.call("git.commit", { workspace, input, options }),
    branch: (input, options) => rows.call("git.branch", { workspace, input, options }),
    push: (input, options) => rows.call("git.push", { workspace, input, options }),
  };
}

/** Returns the browser api over the `browser.*` rows; `open` mints the page's wire id (§40o) so a replay opens one page. */
function browserApi(rows: Rows, workspace: WorkspaceId): BrowserApi {
  return {
    open: async ({ url }) =>
      pageHandle(
        rows,
        workspace,
        (await rows.call("browser.open", { workspace, url, id: crypto.randomUUID() })).id,
      ),
    adopt: async (id) =>
      pageHandle(rows, workspace, (await rows.call("browser.adopt", { workspace, id })).id),
    list: () => rows.call("browser.list", { workspace }),
    watch: () => rows.watch("browser.watch", { workspace }),
  };
}

/** Returns a handle on a page over the `page.*` rows; `capture` answers a reader. Binds synchronously. */
function pageHandle(rows: Rows, workspace: WorkspaceId, page: PageId): Page {
  const close = async (): Promise<void> => {
    await rows.call("page.close", { workspace, page });
  };

  return {
    id: page,
    view: () => rows.call("page.view", { workspace, page }),
    watch: () => rows.watch("page.watch", { workspace, page }),
    snapshot: (input) => rows.call("page.snapshot", { workspace, page, ...input }),
    navigate: (url) => rows.call("page.navigate", { workspace, page, url }),
    back: () => rows.call("page.back", { workspace, page }),
    forward: () => rows.call("page.forward", { workspace, page }),
    reload: () => rows.call("page.reload", { workspace, page }),
    stopLoading: () => rows.call("page.stopLoading", { workspace, page }),
    click: (input) => rows.call("page.click", { workspace, page, ...input }),
    type: (input) => rows.call("page.type", { workspace, page, ...input }),
    press: (input) => rows.call("page.press", { workspace, page, ...input }),
    scroll: (input) => rows.call("page.scroll", { workspace, page, ...input }),
    wait: (condition) => rows.call("page.wait", { workspace, page, condition }),
    console: (input) => rows.call("page.console", { workspace, page, ...input }),
    capture: () => rows.bytes("page.capture", { workspace, page }),
    evaluate: (expression, options) =>
      rows.call("page.evaluate", { workspace, page, expression, options }),
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Returns the jobs api over the `jobs.*` rows; a started or recovered job is a handle carrying its key. */
function jobsApi(rows: Rows, workspace: WorkspaceId): Jobs {
  return {
    async start(input) {
      const view = await rows.call("jobs.start", { workspace, ...input });

      return jobHandle(rows, workspace, view.id, view.key);
    },
    async recover(key) {
      const recovered = await rows.call("jobs.recover", { workspace, key });

      return "id" in recovered
        ? jobHandle(rows, workspace, recovered.id, recovered.key)
        : recovered;
    },
    list: () => rows.call("jobs.list", { workspace }),
    watch: () => rows.watch("jobs.watch", { workspace }),
  };
}

/** Returns a handle on a job over the `job.*` rows, bound synchronously: `write` sends its bytes as the body, `output` yields byte frames and the `gap`/`exit` control frames (§40h), and `settled` is retried across link loss. `close` returns this handle's open outputs on the client (ADV G4); the process keeps running. */
function jobHandle(rows: Rows, workspace: WorkspaceId, job: JobId, key: JobKey | null): Job {
  const readers = new Set<() => Promise<void>>();

  const close = async (): Promise<void> => {
    await Promise.all([...readers].map((detach) => detach()));
  };

  return {
    id: job,
    key,
    async write(bytes) {
      await rows.upload("job.write", { workspace, job }, bytes);
    },
    output: () =>
      closable<OutputFrame>(() => {
        const frames = rows.output({ workspace, job })[Symbol.asyncIterator]();

        const detach = async (): Promise<void> => {
          readers.delete(detach);
          await frames.return?.();
        };

        readers.add(detach);

        return { pull: () => frames.next(), close: detach };
      }),
    resize: (size) => rows.call("job.resize", { workspace, job, size }),
    idle: () => rows.call("job.idle", { workspace, job }),
    stop: () => rows.call("job.stop", { workspace, job }),
    settled: (options) => rows.wait("job.settled", { workspace, job }, options),
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Rebuilds a `PatchSet` from its wire form: the entries as a map. */
function patchSet(wire: PatchSetWire): PatchSet {
  return { revision: wire.revision, entries: new Map(Object.entries(wire.entries)) };
}

/** Returns a source with each value mapped; `return()` reaches the source at once. */
function mapped<T, U>(source: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();

      return {
        async next(): Promise<IteratorResult<U>> {
          const next = await iterator.next();

          return next.done === true
            ? { done: true, value: undefined }
            : { done: false, value: map(next.value) };
        },
        async return(): Promise<IteratorResult<U>> {
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

/** Returns a byte stream pulling from an async iterable; cancelling it returns the iterable. */
function streamOf(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();

      if (next.done === true) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
