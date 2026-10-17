import { asId, foldJobChange } from "@nyte-ai/schema";
import type {
  BlobId,
  JobId,
  JobKey,
  JobsChange,
  JobView,
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
  GitHubApi,
  Job,
  Jobs,
  Page,
  Workspace,
} from "@nyte-ai/core";
import type { OperationInput } from "@nyte-ai/protocol";
import { resolveCapability } from "./capability.ts";
import { loginHandle } from "./login.ts";
import { batchOutcome, receiptHandle } from "./receipts.ts";
import type { Rows } from "./rows.ts";

type BatchEntry = OperationInput<"files.batch">["entries"][number];

type Pending =
  | ({ readonly kind: "put" } & Parameters<FileBatch["put"]>[0])
  | ({ readonly kind: "remove" } & Parameters<FileBatch["remove"]>[0]);

const encoder = new TextEncoder();

export function workspaceHandle(rows: Rows, workspace: WorkspaceId): Workspace {
  return {
    id: workspace,
    info: () => rows.call("workspace.info", { workspace }),
    watch: () => rows.watch("workspace.watch", { workspace }),
    catalog: () => rows.call("workspace.catalog", { workspace }),
    command: (name, args) => rows.call("workspace.command", { workspace, name, args }),
    mcp: {
      watch: () => rows.watch("mcp.watch", { workspace }),
      reconnect: (server) => rows.call("mcp.reconnect", { workspace, server }),
      setEnabled: (server, enabled) => rows.call("mcp.setEnabled", { workspace, server, enabled }),
      login: (server) =>
        loginHandle(
          rows,
          async () => (await rows.call("mcp.login", { workspace, server })).login,
          null,
        ),
      logout: (server) => rows.call("mcp.logout", { workspace, server }),
      add: (server, config, scope) => rows.call("mcp.add", { workspace, server, config, scope }),
      remove: (server, scope) => rows.call("mcp.remove", { workspace, server, scope }),
    },
    update: (patch) => rows.call("workspace.update", { workspace, patch }),
    reload: () => rows.call("workspace.reload", { workspace }),
    jobs: jobsApi(rows, workspace),
    job: (id) => jobHandle(rows, workspace, id, null),
    changes: (run) => rows.call("workspace.changes", { workspace, run }),
    patches: (run, paths, options) =>
      mapped(rows.frames("workspace.patches", { workspace, run, paths, options }), patchSet),
    files: async () =>
      resolveCapability(await rows.call("workspace.files", { workspace }), () =>
        filesApi(rows, workspace),
      ),
    git: async () =>
      resolveCapability(await rows.call("workspace.git", { workspace }), () =>
        gitApi(rows, workspace),
      ),
    github: async () =>
      resolveCapability(await rows.call("workspace.github", { workspace }), () =>
        githubApi(rows, workspace),
      ),
    browser: async () =>
      resolveCapability(await rows.call("workspace.browser", { workspace }), () =>
        browserApi(rows, workspace),
      ),
  };
}

function filesApi(rows: Rows, workspace: WorkspaceId): FilesApi {
  const upload = (source: AsyncIterable<Uint8Array>): Promise<BlobId> =>
    rows.upload("files.upload", { workspace }, streamBytes(source));

  const plan = (pending: readonly Pending[]): FileBatch => ({
    put: (input) => plan([...pending, { kind: "put", ...input }]),
    remove: (input) => plan([...pending, { kind: "remove", ...input }]),
    async apply() {
      const entries = await Promise.all(
        pending.map(async (entry): Promise<BatchEntry> => {
          if (entry.kind === "remove") return entry;
          const { contents, ...rest } = entry;

          return {
            ...rest,
            contents:
              typeof contents === "string" || !(contents instanceof Uint8Array)
                ? contents
                : { blob: await upload(once(contents)) },
          };
        }),
      );

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

function githubApi(rows: Rows, workspace: WorkspaceId): GitHubApi {
  return {
    state: () => rows.call("github.state", { workspace }),
    createPullRequest: (input) => rows.call("github.createPullRequest", { workspace, input }),
  };
}

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
    watch: () => foldJobs(rows.watch("jobs.watch", { workspace })),
  };
}

async function* foldJobs(changes: AsyncIterable<JobsChange>): AsyncIterable<readonly JobView[]> {
  let jobs: readonly JobView[] = [];

  for await (const change of changes) {
    jobs = foldJobChange(jobs, change);

    yield jobs;
  }
}

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

function patchSet(wire: PatchSetWire): PatchSet {
  return { revision: wire.revision, entries: new Map(Object.entries(wire.entries)) };
}

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

function streamBytes(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
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
