import { asId, writePatch } from "@nyte-ai/schema";
import type {
  Availability,
  ChangeSet,
  EndReason,
  FileStatus,
  FileVersion,
  JobEnd,
  OutputFrame,
  PageId,
  PatchEntry,
  RunId,
  ScanFrame,
  SnapshotId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { createHost } from "../src/api/connection.ts";
import { createHostState } from "../src/api/host.ts";
import { createKernel } from "../src/compose.ts";
import { memoryStore } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type {
  BrowserApi,
  EnvironmentProvider,
  ExecutionEnv,
  FilesApi,
  GitApi,
  Host,
  Job,
  Page,
  Plugin,
} from "../src/index.ts";
import { configuration } from "../src/harness.ts";

export interface Disk {
  readonly files: Map<
    string,
    { readonly contents: string | Uint8Array; readonly version: FileVersion }
  >;
  readonly directories: Set<string>;
  /** Hears every `put`, with the file's absolute path; an open `watch` is one listener. */
  readonly watchers: Set<(path: string) => void>;
  put(path: string, contents: string | Uint8Array): void;
  text(path: string): string | undefined;
  pause(): () => void;
  readonly held: number;
  wait(): Promise<void>;
}

export interface Process {
  readonly command: string | readonly string[];
  readonly pty: { readonly columns: number; readonly rows: number } | null;
  readonly stdin: string[];
  readonly resized: { readonly columns: number; readonly rows: number }[];
  idle: boolean;
  readonly job: Job;
  emit(data: string | Uint8Array): void;
  exit(code: number | null, reason?: EndReason): void;
}

export interface FakeProvider extends EnvironmentProvider {
  readonly disk: Disk;
  readonly processes: Process[];
  readonly patchReads: (readonly string[])[];
  peakReads: number;
  attaches: number;
  availability: Availability | null;
  failure: string | null;
  script: (process: Process) => void;
  failPatches: ((paths: readonly string[]) => string | null) | null;
  readonly opened: PageId[];
  readonly closed: PageId[];
}

export function createDisk(): Disk {
  let minted = 0;
  let gate: Promise<void> | null = null;
  let held = 0;
  const files: Disk["files"] = new Map();
  const directories = new Set<string>(["/"]);
  const watchers = new Set<(path: string) => void>();

  const disk: Disk = {
    files,
    directories,
    watchers,
    put(path: string, contents: string | Uint8Array) {
      minted += 1;
      files.set(normalize(path), { contents, version: asId<"file-version">(`v${minted}`) });

      for (const parent of listParentDirectories(normalize(path))) directories.add(parent);

      for (const heard of watchers) heard(normalize(path));
    },
    text(path: string) {
      const contents = files.get(normalize(path))?.contents;

      return typeof contents === "string" ? contents : undefined;
    },
    pause() {
      let release = () => {};

      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });

      return release;
    },
    get held() {
      return held;
    },
    async wait() {
      if (gate === null) return;
      held += 1;
      await gate;
      held -= 1;
    },
  };

  return disk;
}

export function fakeProvider(
  disk: Disk,
  options?: {
    readonly kind?: string;
    readonly git?: boolean;
    readonly browser?: boolean;
    readonly confined?: boolean;
  },
): FakeProvider {
  const snapshots = new Map<SnapshotId, ReadonlyMap<string, string>>();
  const ids = new Map<string, SnapshotId>();
  const befores = new Map<RunId, SnapshotId>();
  let reading = 0;

  const take = (root: string): SnapshotId => {
    const tree = new Map(
      [...disk.files]
        .filter(([path]) => path.startsWith(`${root}/`))
        .map(([path, file]) => [
          path.slice(root.length + 1),
          typeof file.contents === "string" ? file.contents : `<${file.contents.byteLength} bytes>`,
        ]),
    );

    const key = JSON.stringify([...tree].sort(([left], [right]) => (left < right ? -1 : 1)));
    const known = ids.get(key);

    if (known !== undefined) return known;
    const id = asId<"snapshot">(`s${ids.size + 1}`);
    ids.set(key, id);
    snapshots.set(id, tree);

    return id;
  };

  const changed = (from: SnapshotId, to: SnapshotId) => {
    const before = snapshots.get(from) ?? new Map<string, string>();
    const after = snapshots.get(to) ?? new Map<string, string>();
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();

    return paths.flatMap((path) => {
      const old = before.get(path);
      const next = after.get(path);

      if (old === next) return [];

      const status: FileStatus =
        old === undefined ? "added" : next === undefined ? "deleted" : "modified";

      const removed = old === undefined ? [] : old.split("\n").filter((line) => line !== "");
      const added = next === undefined ? [] : next.split("\n").filter((line) => line !== "");

      return [{ path, status, removed, added }];
    });
  };

  const provider: FakeProvider = {
    kind: options?.kind ?? "local",
    disk,
    processes: [],
    patchReads: [],
    peakReads: 0,
    failPatches: null,
    opened: [],
    closed: [],
    attaches: 0,
    availability: null,
    failure: null,
    git: options?.git === false ? undefined : () => fakeGit(),
    browser: options?.browser === true ? () => fakeBrowser(provider) : undefined,
    script: (process) => {
      const command =
        typeof process.command === "string" ? process.command : process.command.join(" ");

      if (command.startsWith("echo ")) {
        process.emit(`${command.slice(5)}\n`);
        process.exit(0);
      }
    },
    inspect: async (target) => ({
      identity: asId<"environment-identity">(`id:${readTargetPath(target)}`),
      availability: provider.availability ?? { kind: "available" },
      projectSources: [".nyte/plugins/x.ts"],
    }),
    async attach(target) {
      if (provider.failure !== null) throw new Error(provider.failure);
      provider.attaches += 1;

      return env(provider, readTargetPath(target), options?.confined === true);
    },
    snapshots: (attached) => ({
      async before(run) {
        const known = befores.get(run);

        if (known !== undefined) return known;
        const taken = take(attached.cwd);
        befores.set(run, taken);

        return taken;
      },
      after: async () => take(attached.cwd),
      async diff(from, to): Promise<ChangeSet> {
        return {
          revision: to,
          files: changed(from, to).map((file) => ({
            path: file.path,
            status: file.status,
            stat: { kind: "text", added: file.added.length, removed: file.removed.length },
          })),
        };
      },
      async patches(from, to, paths) {
        provider.patchReads.push(paths);
        reading += 1;
        provider.peakReads = Math.max(provider.peakReads, reading);
        await new Promise((resolve) => setTimeout(resolve, 1));
        reading -= 1;
        const failure = provider.failPatches?.(paths) ?? null;

        if (failure !== null) throw new Error(failure);

        return changed(from, to)
          .filter((file) => paths.includes(file.path))
          .map((file): PatchEntry => ({
            path: file.path,
            status: file.status,
            digest: `${to}:${file.path}`,
            kind: "text",
            added: file.added.length,
            removed: file.removed.length,
            patch: writePatch(file.path, file.status, [
              {
                oldStart: 1,
                oldLines: file.removed.length,
                newStart: 1,
                newLines: file.added.length,
                header: null,
                lines: [
                  ...file.removed.map((text) => ({ kind: "remove" as const, text })),
                  ...file.added.map((text) => ({ kind: "add" as const, text })),
                ],
              },
            ]),
          }));
      },
    }),
  };

  return provider;
}

export async function world(options?: {
  readonly plugins?: readonly Plugin<"core">[];
  readonly builtins?: readonly Plugin<"core">[];
  readonly home?: string;
  readonly git?: boolean;
  readonly browser?: boolean;
  readonly disk?: Disk;
  readonly execution?: Kernel["execution"];
}): Promise<{
  readonly kernel: Kernel;
  readonly host: Omit<Host, "listen">;
  readonly disk: Disk;
  readonly provider: FakeProvider;
  readonly workspace: Awaited<ReturnType<typeof addWorkspace>>;
}> {
  const disk = options?.disk ?? createDisk();
  disk.directories.add("/work/project");
  const provider = fakeProvider(disk, { git: options?.git, browser: options?.browser });
  const kernel = kernelOver(await memoryStore().open(), provider, options);
  const host = createHost(kernel, { credential: { kind: "token", token: "x" } });

  return { kernel, host, disk, provider, workspace: await addWorkspace(host) };
}

export function kernelOver(
  store: Kernel["store"],
  provider: FakeProvider,
  options?: {
    readonly plugins?: readonly Plugin<"core">[];
    readonly builtins?: readonly Plugin<"core">[];
    readonly home?: string;
    readonly execution?: Kernel["execution"];
  },
): Kernel {
  return createKernel({
    hostId: asId("h1"),
    store,
    description: { name: "studio", platform: "darwin", version: "0.1.0" },
    host: createHostState({
      catalog: asId("g1"),
      plugins: [],
      settings: [],
      defaultWorkspace: null,
    }),
    turn: {
      run: (input) =>
        new Promise((resolve) =>
          input.signal.addEventListener("abort", () => resolve({ kind: "stopped" }), {
            once: true,
          }),
        ),
    },
    resolveConfiguration: async () => configuration,
    home: options?.home,
    execution: options?.execution,
    builtins: options?.builtins,
    hostPlugins: [{ id: "fake-environment", environment: provider }, ...(options?.plugins ?? [])],
  });
}

export async function addWorkspace(host: Omit<Host, "listen">, path = "/work/project") {
  const added = await host.workspaces.add({ kind: "local", path }, { projectResources: true });

  if (added.kind !== "added" && added.kind !== "exists")
    throw new Error(`Not added: ${added.kind}.`);

  return added.workspace;
}

export async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];

  for await (const value of source) values.push(value);

  return values;
}

function env(provider: FakeProvider, root: string, confined: boolean): ExecutionEnv {
  return {
    identity: asId<"environment-identity">(`id:${root}`),
    cwd: root,
    files: filesAt(provider.disk, root, confined),
    async exec(command, options) {
      const process = startProcess(command, options?.pty ?? null, options?.signal);
      provider.processes.push(process);
      provider.script(process);

      return process.job;
    },
    close: async () => undefined,
  };
}

function filesAt(disk: Disk, root: string, confined: boolean): FilesApi {
  const resolve = (path: string): string => {
    const resolved = normalize(path.startsWith("/") ? path : `${root}/${path}`);

    if (confined && resolved !== root && !resolved.startsWith(`${root}/`))
      throw new Error(`${path} is outside the sandbox.`);

    return resolved;
  };

  const relative = (path: string): string =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

  const hasDirectory = (path: string): boolean =>
    disk.directories.has(path) ||
    [...disk.files.keys()].some((file) => file.startsWith(`${path}/`));

  return {
    async read(path) {
      const file = disk.files.get(resolve(path));

      if (file === undefined) return { kind: "missing", path };

      return typeof file.contents === "string"
        ? { kind: "text", path, contents: file.contents, version: file.version }
        : { kind: "binary", path, size: file.contents.byteLength, version: file.version };
    },
    async bytes(path) {
      const contents = disk.files.get(resolve(path))?.contents;

      if (contents === undefined) throw new Error(`${path} is missing.`);
      const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;

      return {
        size: bytes.byteLength,
        mime: null,
        async *chunks() {
          yield bytes;
        },
        close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      };
    },
    async stat(path) {
      const file = disk.files.get(resolve(path));

      if (file !== undefined)
        return {
          kind: "file",
          size: typeof file.contents === "string" ? file.contents.length : file.contents.byteLength,
          version: file.version,
        };

      return hasDirectory(resolve(path))
        ? { kind: "directory", size: 0, version: asId<"file-version">("directory") }
        : null;
    },
    async write(path, contents, options) {
      await disk.wait();
      const target = resolve(path);
      const current = disk.files.get(target)?.version ?? null;

      if (options?.expect === "absent" && current !== null) return { kind: "stale", current };

      if (
        options?.expect !== undefined &&
        options.expect !== "absent" &&
        options.expect !== current
      )
        return { kind: "stale", current };
      const parent = target.slice(0, target.lastIndexOf("/")) || "/";

      if (!options?.parents && !hasDirectory(parent)) return { kind: "missing-parent" };
      disk.put(target, contents);
      const written = disk.files.get(target);

      if (written === undefined) throw new Error("Lost a write.");

      return { kind: "saved", version: written.version };
    },
    async remove(path, options) {
      await disk.wait();
      const target = resolve(path);
      const current = disk.files.get(target)?.version ?? null;

      if (current === null || (options?.expect !== undefined && options.expect !== current))
        return { kind: "stale", current };
      disk.files.delete(target);

      return { kind: "saved", version: current };
    },
    batch() {
      throw new Error("Core wraps batch.");
    },
    format: async () => ({ kind: "unchanged" }),
    async *scan(input): AsyncGenerator<ScanFrame> {
      const base = resolve(input?.directory ?? ".");
      const files = [...disk.files.keys()].filter((path) => path.startsWith(`${base}/`));

      const directories = new Set(
        [...disk.directories, ...files.flatMap(listParentDirectories)].filter((path) =>
          path.startsWith(`${base}/`),
        ),
      );

      yield {
        kind: "entries",
        entries: [
          ...[...directories].map((path) => ({
            path: relative(path),
            kind: "directory" as const,
            size: null,
            version: null,
          })),
          ...files.map((path) => ({
            path: relative(path),
            kind: "file" as const,
            size: null,
            version: disk.files.get(path)?.version ?? null,
          })),
        ],
      };

      yield { kind: "complete" };
    },
    find: async () => [],
    async *search() {
      yield { kind: "complete" };
    },
    watch(input) {
      const prefixes = (input?.paths ?? [""]).map(resolve);
      const heard: string[] = [];
      let wake: (() => void) | null = null;

      const listener = (path: string): void => {
        if (!prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return;
        heard.push(path);
        wake?.();
      };

      disk.watchers.add(listener);
      const done = { done: true, value: undefined } as const;

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              while (heard.length === 0) {
                if (!disk.watchers.has(listener)) return done;
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              }

              const events = heard.splice(0).map((path) => ({
                kind: "created" as const,
                path: relative(path),
                version: disk.files.get(path)?.version ?? asId<"file-version">("gone"),
              }));

              return { done: false, value: events };
            },
            async return() {
              disk.watchers.delete(listener);
              wake?.();

              return done;
            },
          };
        },
      };
    },
    upload() {
      throw new Error("Core wraps upload.");
    },
  };
}

function startProcess(
  command: string | readonly string[],
  pty: Process["pty"],
  signal: AbortSignal | undefined,
): Process {
  const frames: OutputFrame[] = [];
  const wakes = new Set<() => void>();
  let end: JobEnd | null = null;
  const ended = Promise.withResolvers<JobEnd>();

  const push = (frame: OutputFrame): void => {
    frames.push(frame);

    for (const wake of wakes) wake();
  };

  const process: Process = {
    command,
    pty,
    stdin: [],
    resized: [],
    idle: false,
    emit(data) {
      push({
        kind: "bytes",
        data: typeof data === "string" ? new TextEncoder().encode(data) : data,
      });
    },
    exit(code, reason = "exited") {
      if (end !== null) return;
      end = { kind: "exited", code, reason };
      push({ kind: "exit", code });
      ended.resolve(end);
    },
    job: {
      id: asId("process"),
      key: null,
      async write(bytes) {
        process.stdin.push(new TextDecoder().decode(bytes));
      },
      output: () => ({
        [Symbol.asyncIterator]() {
          let index = 0;

          return {
            async next(): Promise<IteratorResult<OutputFrame>> {
              for (;;) {
                const frame = frames[index];

                if (frame !== undefined) {
                  index += 1;

                  return { done: false, value: frame };
                }

                if (end !== null) return { done: true, value: undefined };
                await new Promise<void>((resolve) => {
                  const wake = () => {
                    wakes.delete(wake);
                    resolve();
                  };

                  wakes.add(wake);
                });
              }
            },
          };
        },
      }),
      async resize(size) {
        if (pty === null) return { kind: "not-pty" };
        process.resized.push(size);

        return { kind: "resized" };
      },
      idle: async () => process.idle,
      async stop() {
        process.exit(null, "terminated");

        return { kind: "settled", outcome: await ended.promise };
      },
      settled: () => ended.promise,
      close: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined,
    },
  };

  signal?.addEventListener("abort", () => process.exit(null, "terminated"), { once: true });

  return process;
}

function fakeBrowser(provider: FakeProvider): BrowserApi {
  const pages = new Map<PageId, Page>();
  const revision = asId<"document-revision">("d1");
  const done = async () => ({ kind: "closed" as const, reason: "released" as const });

  const open = (url: string): Page => {
    const id = asId<"page">(`page-${provider.opened.length + 1}`);
    provider.opened.push(id);

    const close = async () => {
      pages.delete(id);
      provider.closed.push(id);
    };

    const page: Page = {
      id,
      view: async () => ({
        id,
        url,
        title: url,
        loading: false,
        revision,
        canGoBack: false,
        canGoForward: false,
      }),
      async *watch() {},
      snapshot: async () => ({ revision, nodes: [] }),
      navigate: done,
      back: done,
      forward: done,
      reload: done,
      stopLoading: done,
      click: done,
      type: done,
      press: done,
      scroll: done,
      wait: done,
      console: async () => [],
      capture: async () => ({
        size: 0,
        mime: "image/png",
        async *chunks() {},
        close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      }),
      evaluate: async () => ({ kind: "value", value: null }),
      close,
      [Symbol.asyncDispose]: close,
    };

    pages.set(id, page);

    return page;
  };

  const list = async () =>
    [...pages.values()].map((page) => ({ id: page.id, url: "", title: "", holders: 1 }));

  return {
    open: async (input) => open(input.url),
    async adopt(id) {
      const page = pages.get(id);

      if (page === undefined) throw new Error(`No page ${id}.`);

      return page;
    },
    list,
    async *watch() {
      yield await list();
    },
  };
}

function fakeGit(): GitApi {
  const revision = asId<"git-revision">("rev1");
  const none = async () => ({ kind: "none" as const });

  return {
    status: none,
    async *watch() {},
    changes: async () => ({ revision, files: [] }),
    async *watchChanges() {},
    async *patches() {},
    contents: async (path) => ({ path, old: { kind: "absent" }, new: { kind: "absent" } }),
    log: async () => ({ items: [], next: null }),
    refs: async () => ({ current: null, branches: [], remotes: [] }),
    blame: async (path) => ({ path, lines: [] }),
    stage: async () => ({ kind: "applied", revision }),
    unstage: async () => ({ kind: "applied", revision }),
    discard: async () => ({ kind: "applied", revision }),
    commit: async () => ({ kind: "applied", revision }),
    branch: async () => ({ kind: "applied", revision }),
    push: async () => ({ kind: "applied", revision }),
  };
}

function readTargetPath(target: WorkspaceTarget): string {
  return "path" in target && typeof target.path === "string" ? target.path : "/remote";
}

function normalize(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function listParentDirectories(path: string): readonly string[] {
  const parts = path.split("/").filter((part) => part !== "");

  return parts.slice(0, -1).map((_part, index) => `/${parts.slice(0, index + 1).join("/")}`);
}
