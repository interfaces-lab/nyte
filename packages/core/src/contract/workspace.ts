import type {
  AddOutcome,
  Availability,
  BackgroundItem,
  BatchOutcome,
  BlameView,
  BlobId,
  ByteReader,
  CallId,
  Capability,
  ChangeSet,
  ConsoleEntry,
  Cursor,
  DiffOptions,
  Disposer,
  DocumentRevision,
  EnvironmentIdentity,
  FileDocument,
  FileEntryView,
  FileEvent,
  FileVersion,
  ForgetOutcome,
  FormatOutcome,
  GitCommitView,
  GitFileSides,
  GitOutcome,
  GitRefsView,
  GitScope,
  GitStatus,
  GitWrite,
  HeadName,
  JobEnd,
  JobId,
  JobKey,
  JobView,
  Json,
  McpChange,
  McpScope,
  McpServerConfig,
  McpView,
  OutputFrame,
  Paged,
  PageId,
  PageInfo,
  PageOutcome,
  PageSnapshot,
  PageView,
  PatchEntry,
  PatchSet,
  ReceiptId,
  RequestOptions,
  RunId,
  ScanFrame,
  SearchFrame,
  SessionId,
  SnapshotId,
  StopOutcome,
  WorkspaceId,
  WorkspaceInfo,
  WorkspaceInspection,
  WorkspaceTarget,
  WriteOutcome,
} from "@nyte-ai/schema";
import type { Login, PluginStorage } from "./host.ts";
import type { Receipt } from "./session.ts";
import type { ToolDefinition } from "./tools.ts";

export interface GitApi {
  status(): Promise<GitStatus>;
  watch(): AsyncIterable<GitStatus>;

  changes(scope: GitScope, options?: DiffOptions): Promise<ChangeSet>;
  watchChanges(scope: GitScope, options?: DiffOptions): AsyncIterable<ChangeSet>;
  patches(
    scope: GitScope,
    paths: readonly string[],
    options?: DiffOptions,
  ): AsyncIterable<PatchSet>;
  contents(path: string, scope: GitScope): Promise<GitFileSides>;

  log(input?: { readonly cursor?: Cursor; readonly limit?: number }): Promise<Paged<GitCommitView>>;
  refs(): Promise<GitRefsView>;
  blame(path: string): Promise<BlameView>;

  stage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  unstage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  discard(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  commit(
    input: { readonly message: string; readonly files: "staged" | "all" | readonly string[] },
    options?: GitWrite,
  ): Promise<GitOutcome>;
  branch(
    input: { readonly name: string; readonly checkout: boolean },
    options?: GitWrite,
  ): Promise<GitOutcome>;
  push(input?: { readonly setUpstream?: boolean }, options?: GitWrite): Promise<GitOutcome>;
}

export interface Jobs {
  start(input: {
    readonly command?: string;
    readonly session?: SessionId;
    readonly title?: string;
    readonly pty?: { readonly columns: number; readonly rows: number };
    readonly id?: JobId;
  }): Promise<Job>;

  recover(
    key: JobKey,
  ): Promise<Job | { readonly kind: "ended"; readonly end: JobEnd } | { readonly kind: "missing" }>;

  list(): Promise<readonly JobView[]>;

  watch(): AsyncIterable<readonly JobView[]>;
}

export interface Job {
  readonly id: JobId;
  readonly key: JobKey | null;

  write(bytes: Uint8Array): Promise<void>;

  output(): AsyncIterable<OutputFrame>;

  resize(size: {
    readonly columns: number;
    readonly rows: number;
  }): Promise<
    { readonly kind: "resized" } | { readonly kind: "not-pty" } | { readonly kind: "missing" }
  >;

  idle(): Promise<boolean>;

  stop(): Promise<StopOutcome<JobEnd>>;

  settled(options?: RequestOptions): Promise<JobEnd>;

  close(): Promise<void>;

  [Symbol.asyncDispose](): Promise<void>;
}

export interface JobEntry {
  readonly view: JobView;
  readonly workspace: WorkspaceId;
  readonly key: JobKey | null;
  readonly process: Job;
  readonly owner: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly startedBy: CallId | null;
  } | null;
  readonly digest: string;
  readonly output: JobOutput;
}

export interface JobOutput {
  open(): { next(): Promise<IteratorResult<OutputFrame>>; close(): void };
  push(bytes: Uint8Array): void;
  gap(): void;
  end(code: number | null): void;
  tail(): string;
}

export interface JobTable {
  get(id: JobId): JobEntry | undefined;
  byKey(key: JobKey): JobEntry | undefined;
  list(workspace: WorkspaceId): readonly JobEntry[];

  start(id: JobId, digest: string, spawn: () => Promise<void>): Promise<void>;
  add(entry: JobEntry): void;
  update(id: JobId, change: (view: JobView) => JobView): void;
  subscribe(workspace: WorkspaceId, listener: (views: readonly JobView[]) => void): Disposer;
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

export interface ExecutionEnv {
  readonly identity: EnvironmentIdentity;
  readonly cwd: string;
  readonly files: FilesApi;
  exec(
    command: string | readonly string[],
    options?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      readonly signal?: AbortSignal;
      readonly pty?: { readonly columns: number; readonly rows: number };
    },
  ): Promise<Job>;
  close(): Promise<void>;
}

export type EnvironmentWrap = (
  inner: ExecutionEnv,
) => ExecutionEnv & { readonly browser?: BrowserApi };

export interface SnapshotsApi {
  before(run: RunId): Promise<SnapshotId>;
  after(run: RunId): Promise<SnapshotId>;
  diff(from: SnapshotId, to: SnapshotId): Promise<ChangeSet>;
  patches(
    from: SnapshotId,
    to: SnapshotId,
    paths: readonly string[],
    options?: DiffOptions,
  ): Promise<readonly PatchEntry[]>;
}

export interface EnvironmentProvider {
  readonly kind: string;
  inspect(target: WorkspaceTarget): Promise<{
    readonly identity: EnvironmentIdentity;
    readonly availability: Availability;
    readonly projectSources: readonly string[];
  }>;
  attach(target: WorkspaceTarget): Promise<ExecutionEnv>;
  readonly git?: (env: ExecutionEnv) => GitApi | undefined;
  readonly snapshots?: (env: ExecutionEnv) => SnapshotsApi | undefined;
  readonly browser?: (env: ExecutionEnv) => BrowserApi;
  destroy?(target: WorkspaceTarget): Promise<void>;
}

export interface Resources {
  readonly user: FilesApi | null;
  readonly project: FilesApi | null;
  readonly skills: readonly {
    readonly name: string;
    readonly location: string;
    readonly scope: "user" | "project" | "path";
    readonly description: string;
  }[];
  readonly contextFiles: readonly {
    readonly path: string;
    readonly scope: "user" | "ancestor" | "project";
    readonly content: string;
  }[];
  readonly prompt: {
    readonly system: string | null;
    readonly append: string | null;
    readonly scope: "user" | "project" | null;
  };
  readonly prompts: readonly {
    readonly name: string;
    readonly location: string;
    readonly scope: "user" | "project";
  }[];
}

export type EnvironmentCapabilities = {
  readonly files: Capability<FilesApi>;
  readonly git: Capability<GitApi>;
  readonly browser: Capability<BrowserApi>;
};

export interface EnvironmentRegistry {
  providers(): readonly EnvironmentProvider[];
  provider(kind: string): EnvironmentProvider | undefined;

  attach(session: SessionId): Promise<ExecutionEnv>;
  wrap(session: SessionId, wrap: EnvironmentWrap): Disposer;
  snapshots(session: SessionId): Promise<SnapshotsApi | null>;

  capabilities(session: SessionId, holder?: PageHolder | null): Promise<EnvironmentCapabilities>;

  detach(session: SessionId): Promise<void>;

  attachWorkspace(workspace: WorkspaceId): Promise<ExecutionEnv>;
  workspaceSnapshots(workspace: WorkspaceId): Promise<SnapshotsApi | null>;
  workspaceCapabilities(
    workspace: WorkspaceId,
    holder?: PageHolder | null,
  ): Promise<EnvironmentCapabilities>;
  detachWorkspace(workspace: WorkspaceId): Promise<void>;
}

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
    readonly contents: string | Uint8Array | { readonly blob: BlobId };
    readonly expect?: FileVersion | "absent";
  }): FileBatch;
  remove(input: { readonly path: string; readonly expect?: FileVersion }): FileBatch;
  apply(): Promise<Receipt<BatchOutcome>>;
}

export type FileScope = { readonly session: SessionId } | { readonly workspace: WorkspaceId };

export type BatchEntry =
  | {
      readonly kind: "put";
      readonly path: string;
      readonly contents: string | Uint8Array | { readonly blob: BlobId };
      readonly expect?: FileVersion | "absent";
    }
  | { readonly kind: "remove"; readonly path: string; readonly expect?: FileVersion };

export type HeldBatch = {
  readonly receipt: Receipt<BatchOutcome>;
  readonly workspace: WorkspaceId;
  readonly digest: string;
};

export interface BrowserApi {
  open(input: { readonly url: string }): Promise<Page>;

  adopt(id: PageId): Promise<Page>;

  list(): Promise<readonly PageInfo[]>;

  watch(): AsyncIterable<readonly PageInfo[]>;
}

export interface Page {
  readonly id: PageId;

  view(): Promise<PageView>;

  watch(): AsyncIterable<PageView>;

  snapshot(input?: { readonly ref?: string }): Promise<PageSnapshot>;

  navigate(url: string): Promise<PageOutcome>;

  back(): Promise<PageOutcome>;

  forward(): Promise<PageOutcome>;

  reload(): Promise<PageOutcome>;

  stopLoading(): Promise<PageOutcome>;

  click(input: {
    readonly ref: string;
    readonly button?: "left" | "right" | "middle";
    readonly double?: boolean;
    readonly expect?: DocumentRevision;
  }): Promise<PageOutcome>;

  type(input: {
    readonly ref: string;
    readonly text: string;
    readonly clear?: boolean;
    readonly submit?: boolean;
    readonly expect?: DocumentRevision;
  }): Promise<PageOutcome>;

  press(input: { readonly key: string; readonly ref?: string }): Promise<PageOutcome>;

  scroll(input: {
    readonly direction: "up" | "down" | "top" | "bottom";
    readonly ref?: string;
    readonly pages?: number;
  }): Promise<PageOutcome>;

  wait(
    condition:
      | { readonly kind: "loaded" }
      | { readonly kind: "text"; readonly text: string; readonly present: boolean }
      | { readonly kind: "delay"; readonly ms: number },
  ): Promise<PageOutcome>;

  console(input?: {
    readonly limit?: number;
    readonly clear?: boolean;
  }): Promise<readonly ConsoleEntry[]>;

  capture(): Promise<ByteReader>;

  evaluate(
    expression: string,
    options?: { readonly ref?: string },
  ): Promise<
    | { readonly kind: "value"; readonly value: Json }
    | { readonly kind: "threw"; readonly message: string }
  >;

  close(): Promise<void>;

  [Symbol.asyncDispose](): Promise<void>;
}

export type PageHolder = {
  readonly client: object | null;
  readonly origin: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null;
};

export type PageRelease =
  | { readonly session: SessionId }
  | { readonly run: RunId }
  | { readonly client: object };

export interface PageTable {
  hold(page: Page, title: string, holder: PageHolder | null): Page;

  open(request: {
    readonly id?: string;
    readonly input: Json;
    open(): Promise<Page>;
  }): Promise<Page>;
  page(id: PageId): Page | undefined;
  holders(id: PageId): number;

  release(holder: PageRelease): Promise<void>;
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

export interface Workspaces {
  list(): Promise<readonly WorkspaceInfo[]>;

  inspect(target: WorkspaceTarget): Promise<WorkspaceInspection>;

  add(
    target: WorkspaceTarget,
    options?: {
      /** Trusts (`true`) or declines (`false`) the folder's project files; by default it inherits the nearest registered parent folder's decision. */
      readonly projectResources?: boolean;
      readonly expect?: { readonly identity: EnvironmentIdentity };
    },
  ): Promise<AddOutcome>;

  forget(id: WorkspaceId): Promise<ForgetOutcome>;
}

export interface Workspace {
  readonly id: WorkspaceId;

  info(): Promise<WorkspaceInfo>;

  watch(): AsyncIterable<WorkspaceInfo>;

  /** The workspace's MCP servers; see {@link McpApi}. */
  readonly mcp: McpApi;

  /**
   * Records the user's trust decision for the folder's project files: `true`
   * loads them, `false` skips them, `null` forgets the decision so the host's
   * `workspaceTrust` mode applies. Live sessions reload with the change.
   */
  update(patch: {
    readonly projectResources?: boolean | null;
  }): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;

  reload(): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  readonly jobs: Jobs;

  job(id: JobId): Job;

  changes(run: RunId): Promise<ChangeSet>;

  patches(run: RunId, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;

  files(): Promise<Capability<FilesApi>>;

  git(): Promise<Capability<GitApi>>;

  browser(): Promise<Capability<BrowserApi>>;
}

export type HeldEntry = PatchEntry & { readonly fresh: boolean };

export type PatchSlot = {
  done: boolean;
  value: HeldEntry | null;
  readonly read: Promise<HeldEntry | null>;
};

export type PatchCache = { readonly revision: SnapshotId; readonly slots: Map<string, PatchSlot> };

export interface WorkspaceState {
  readonly listeners: Set<(id: WorkspaceId) => void>;
  readonly patches: Map<string, PatchCache>;
  readonly scans: Map<
    SessionId,
    { readonly workspace: WorkspaceId; readonly resources: Promise<Resources> }
  >;
  home: Promise<FilesApi | null> | null;
  readonly batches: Map<ReceiptId, AbortController>;
  readonly held: Map<ReceiptId, HeldBatch>;
}

/**
 * The workspace a hub call is about. Core builds it from the workspace record;
 * a hub reads `root` and `trusted` to decide which `mcp.json` files apply.
 *
 * @category mcp
 * @since 0.1.0
 */
export type McpWorkspace = {
  readonly id: WorkspaceId;
  /** The workspace folder on the host's machine, or `null` when the workspace lives elsewhere: then only user-level servers apply. */
  readonly root: string | null;
  /** True when the user allowed project resources, so the hub may read `<root>/.nyte/mcp.json`. */
  readonly trusted: boolean;
};

/**
 * The host's MCP servers. Implement it once per host and pass its factory as
 * `OpenOptions.mcp`; core then puts the tools in every session (plugin id
 * `mcp`) and serves {@link McpApi} as `workspace(id).mcp` to clients. A host
 * without one answers every `workspace(id).mcp` call with `unavailable`.
 *
 * The hub owns configuration, connections and sign-in; sessions never connect
 * to a server themselves. `watch` opens a workspace's connections and keeps
 * them while any watcher iterates; watchers of the same workspace, root and
 * trust share one set.
 *
 * @example
 * ```ts
 * import { createMcpHub, openHost } from "@nyte-ai/host";
 *
 * const host = await openHost({ ...options, mcp: createMcpHub({ home: homedir() }) });
 * ```
 *
 * @category mcp
 * @since 0.1.0
 */
export interface McpHub {
  /**
   * Yields the workspace's servers at once, then again after any change to a
   * server's state or its `mcp.json`. Iterate it for as long as you need the
   * connections; when the last watcher stops, the hub may close them.
   */
  watch(workspace: McpWorkspace): AsyncIterable<McpView>;

  /**
   * Returns the tools of the workspace's connected servers, named
   * `mcp__<server>__<tool>` with each server's exposure applied, or `[]` when
   * nothing watches the workspace. It is synchronous and never waits for a
   * connection, so call it on every tool derive and reload on each view.
   */
  tools(workspace: McpWorkspace): readonly ToolDefinition[];

  /**
   * Resolves once every server of the workspace's watched connections has
   * finished its first connection attempt (connected, failed or waiting for
   * sign-in), or when `signal` aborts. A server retrying after a failure is
   * not waited for. Core awaits it, bounded, before each model request so the
   * first request after launch carries the servers' tools.
   */
  ready(workspace: WorkspaceId, signal: AbortSignal): Promise<void>;

  /** See {@link McpApi.reconnect}. */
  reconnect(workspace: McpWorkspace, server: string): Promise<McpChange>;

  /** See {@link McpApi.setEnabled}. */
  setEnabled(workspace: McpWorkspace, server: string, enabled: boolean): Promise<McpChange>;

  /** See {@link McpApi.login}. */
  login(workspace: McpWorkspace, server: string): Login;

  /** See {@link McpApi.logout}. */
  logout(workspace: McpWorkspace, server: string): Promise<McpChange>;

  /** See {@link McpApi.add}. */
  add(
    workspace: McpWorkspace,
    server: string,
    config: McpServerConfig,
    scope: McpScope,
  ): Promise<McpChange>;

  /** See {@link McpApi.remove}. */
  remove(workspace: McpWorkspace, server: string, scope: McpScope): Promise<McpChange>;

  /** Disconnects every server. Core calls it when the host closes. */
  close(): Promise<void>;
}

/**
 * The MCP servers a workspace's sessions use, as `workspace(id).mcp`. Every
 * call needs owner authority and throws `unavailable` on a host without MCP.
 * Actions answer an {@link McpChange}: `missing` when no server has that
 * name, `invalid` with a message when the change cannot be made. Changes to
 * `mcp.json` keep the rest of the file as it was.
 *
 * @example
 * ```ts
 * const mcp = connection.workspace(id).mcp;
 *
 * await mcp.add("docs", { url: "https://docs.example.com/mcp" }, "user");
 *
 * for await (const view of mcp.watch()) {
 *   const docs = view.servers.find((server) => server.name === "docs");
 *
 *   if (docs?.state.kind === "needs-sign-in") {
 *     for await (const step of mcp.login("docs").steps())
 *       if (step.kind === "open") console.log("Open", step.url);
 *   }
 * }
 * ```
 *
 * @category mcp
 * @since 0.1.0
 */
export interface McpApi {
  /**
   * Yields the workspace's servers at once and again whenever a server
   * connects, fails, asks for sign-in, or its `mcp.json` changes. Iterating
   * keeps the workspace's connections open.
   */
  watch(): AsyncIterable<McpView>;

  /** Drops the server's connection and connects again, for one that failed or after fixing its credentials. */
  reconnect(server: string): Promise<McpChange>;

  /**
   * Turns a server on or off by writing `enabled` to the `mcp.json` that
   * defines it, or to the project override of a user server when there is one.
   */
  setEnabled(server: string, enabled: boolean): Promise<McpChange>;

  /**
   * Signs in to a url server with OAuth. Steps: `open` with the authorization
   * page, then `paste` for the redirect URL from the browser's address bar
   * (answer it when the browser cannot reach this machine, such as over SSH;
   * a browser that can finishes on its own), `done` or `failed`. The server
   * reconnects once signed in.
   */
  login(server: string): Login;

  /** Deletes the server's stored OAuth credentials; it asks for sign-in again. */
  logout(server: string): Promise<McpChange>;

  /**
   * Adds or replaces a server in `~/.nyte/mcp.json` (`user`) or the trusted
   * workspace's `.nyte/mcp.json` (`project`). It does not wait for the
   * server to connect; watch for that.
   */
  add(server: string, config: McpServerConfig, scope: McpScope): Promise<McpChange>;

  /** Removes a server from one `mcp.json`; its stored OAuth credentials stay. */
  remove(server: string, scope: McpScope): Promise<McpChange>;
}

/**
 * Builds the host's hub after the kernel exists. Store OAuth tokens in
 * `secrets`: they are sealed with the host's key and shared by every session.
 *
 * @category mcp
 * @since 0.1.0
 */
export type McpHubFactory = (context: { readonly secrets: PluginStorage["secrets"] }) => McpHub;
