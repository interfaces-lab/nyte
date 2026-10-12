import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Activation,
  CallId,
  CommandOutcome,
  CommitId,
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  Decision,
  Delivery,
  Disposer,
  FileChange,
  HeadName,
  HostDescription,
  HostId,
  Json,
  MessageId,
  ModelRequestInput,
  ModelRequestOutcome,
  PartId,
  Placement,
  PrincipalId,
  PruneReport,
  RunEnd,
  RunId,
  RunView,
  SessionCatalogView,
  SessionId,
  SnapshotId,
  Submission,
  ToolCall,
  ToolOutcome,
  Usage,
  WorkspaceId,
} from "@nyte-ai/schema";
import { createPageTable } from "./browser.ts";
import type { PageTable } from "./browser.ts";
import { createBus } from "./bus.ts";
import type { SessionBus } from "./bus.ts";
import type { ModelsApi, OpenOptions, SettingsApi } from "./connection.ts";
import { runAction } from "./durable.ts";
import type { StepOutcome } from "./durable.ts";
import { createEnvironmentRegistry } from "./environment.ts";
import type {
  EnvironmentRegistry,
  EnvironmentWrap,
  ExecutionEnv,
  Resources,
  SnapshotsApi,
} from "./environment.ts";
import { SdkError } from "./error.ts";
import { createExecutionState } from "./execution.ts";
import type { ExecutionState } from "./execution.ts";
import { EMPTY_CATALOG } from "./fold.ts";
import { gateSubmission } from "./hooks.ts";
import type { Host, HostState } from "./host.ts";
import { createJobTable } from "./jobs.ts";
import type { JobTable } from "./jobs.ts";
import type { Contributions } from "./models.ts";
import { createPartDefinitions } from "./part-definitions.ts";
import type { PartDefinitions } from "./part-definitions.ts";
import { createPartsApi } from "./parts-api.ts";
import { createPartTable } from "./parts.ts";
import type { Part, PartDefinition, PartState, PartTable } from "./parts.ts";
import {
  checkPlugins,
  createPluginRuntime,
  createPluginState,
  replacePlugins,
} from "./plugin-runtime.ts";
import type { PluginRuntime, PluginState } from "./plugin-runtime.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import { CORE_CONTEXT, createConnectionRegistry, createPrincipals } from "./principals.ts";
import type { ConnectionContext, ConnectionRegistry } from "./principals.ts";
import { prune } from "./prune.ts";
import { runCommand, toolSource } from "./registry.ts";
import { scanResources } from "./resources.ts";
import { dispatchHead } from "./session-state.ts";
import { createSettingsApi } from "./settings.ts";
import type { StoreConnection } from "./store.ts";
import { stoppableTool } from "./tool-runner.ts";
import type { ToolSource } from "./tool-runner.ts";
import type { Durable } from "./tools.ts";
import { createWaitRegistry } from "./waits.ts";
import type { WaitRegistry } from "./waits.ts";
import { createFoldCache, trackStreams } from "./watch.ts";
import type { FoldCache, Follow, LiveStream } from "./watch.ts";
import { createWorkspaceState, createWorkspaces, workspaceHandle } from "./workspaces.ts";
import type { Workspace, WorkspaceState, Workspaces } from "./workspaces.ts";

/** Returns the in-process context every kernel operation closes over; later work orders add fields, none are removed. */
export interface Kernel {
  /** The host this kernel runs as. */
  readonly hostId: HostId;
  /** A random id minted per kernel, written as a lease's `instance` beside its `holder`, so two kernels over one store never both drive a head (§42b, §42j, §42q). */
  readonly instance: string;
  /** The interval in ms at which `pollStore` re-reads the store this kernel shares with other instances, or null when it reads only what it writes (`KernelOptions.poll`, §42h). */
  readonly poll: number | null;
  /** The open store. */
  readonly store: StoreConnection;
  /** Name, platform and version, as `HostView` carries them. */
  readonly description: HostDescription;
  /** Every session's live events, durable and transient. */
  readonly bus: SessionBus;
  /** The host-level fields `watchHost` yields. */
  readonly host: HostState;
  /** One shared fold per session per principal. */
  readonly folds: FoldCache;
  /** Each live part's streamed state in this process, by session: what a feed that starts mid-stream gets first (§54b). */
  readonly streams: Map<SessionId, Map<PartId, LiveStream>>;
  /** The sessions this kernel's bus carries, with their feeds and publish marks. */
  readonly follows: Map<SessionId, Follow>;
  /** The runs a turn drives in this process, each with its session. */
  readonly driving: Map<RunId, SessionId>;
  readonly executionState: ExecutionState;
  readonly pluginState: PluginState;
  readonly workspaceState: WorkspaceState;
  /** The listeners waiting on a receipt in this process, by `<session>/<receipt>`. */
  readonly receipts: Map<string, Set<() => void>>;
  /** The abort controllers of the tool calls running in this process, by call. */
  readonly calls: Map<string, Set<AbortController>>;
  /** Each run's latest snapshot this process took around a call that may write. */
  readonly marks: Map<RunId, SnapshotId>;
  /** Each session's changed files as this process last merged them. */
  readonly changes: Map<SessionId, readonly FileChange[]>;
  /** Returns whether this host serves a session's workspace; in memory, default `{ kind: "inactive" }`. */
  activation(session: SessionId): Activation;
  /** Sets a session's activation in memory and publishes an `activation` event to it. */
  setActivation(session: SessionId, activation: Activation): void;
  /** Where a root session acts when `create` names no workspace (decision 5); `composeHost` sets it once it has registered `OpenOptions.workspace` (§38p). */
  defaultWorkspace: WorkspaceId | null;
  /** Whether this host runs the sessions it admits, and which; admission reads it for `covered`. Default run, covering all. */
  readonly execution: NonNullable<OpenOptions["execution"]>;
  /** The runs live in this process: their abort controllers and stop fences. */
  readonly runs: RunTable;
  /** Tells the driver a head is owed a step. */
  readonly wakes: Wakes;
  /** Runs the assistant turn of one run; core-f fills it. */
  readonly turn: TurnDriver;
  /** Summarises an abandoned path for `move({ abandoned: summarize })`; core-f fills it. */
  readonly summarize: Summarizer;
  /** Starts a compaction of a head's context; core-f fills it. */
  readonly compact: Compactor;
  /** Resolves a head's selection and a patch to a `Configuration`, or says why it cannot; core-f fills it. */
  readonly resolveConfiguration: ConfigurationResolver;
  /** Dispatches `before_send` for a submission. Default: the session's hook dispatch (`gateSubmission`). */
  readonly admit: AdmissionGate;
  /** Runs a core command in a session. Default `runCommand`. */
  readonly command: CommandRunner;
  /** The durable waits parked in this process, by what wakes them; core-e fills it. */
  readonly waits: WaitRegistry;
  /** Providers, credentials and the model catalog; core-f fills it. */
  readonly models: ModelsApi;
  /** Host-scope settings. Default `createSettingsApi`. */
  readonly settings: SettingsApi;
  /** The workspaces registered on this host. Default `createWorkspaces` as `CORE_CONTEXT`, built on first use. */
  readonly workspaces: Workspaces;
  /** Returns a handle on a workspace by id. Default `workspaceHandle` as `CORE_CONTEXT`. */
  workspace(id: WorkspaceId): Workspace;
  /** Creates parts and binds part handles; core-d fills it. */
  readonly parts: PartProvider;
  /** The part definitions this host knows, by kind, with their owners. */
  readonly partDefinitions: PartDefinitions;
  /** What this process knows of its parts in memory: creating definitions, closes, stored answers, `answer()` waiters and acts in flight. */
  readonly partTable: PartTable;
  /** Runs part actions as durable steps; core-e fills it. */
  readonly durable: DurableProvider;
  /** Returns the tools a session's runtime offers, with deferred tools activated for `run` alone. Default `toolSource`, from the runtime's registries. */
  tools(runtime: PluginRuntime, run: RunId | null): ToolSource;
  /** Dispatches `before_tool` for a call. Default: the session's hook dispatch, as the step `hook:before_tool:<call>`. */
  readonly beforeTool: ToolGate;
  /** Dispatches `after_tool` over a call's outcome. Default: the session's hook dispatch. */
  readonly afterTool: ToolOutcomeRewriter;
  /** Resolves the snapshots of a session's environment around a run, or null when it takes none; the provider attaches lazily. Default `environments.snapshots`. */
  snapshots(session: SessionId): Promise<SnapshotsApi | null>;
  /** Resolves the environment a session's tools run against. Default `environments.attach`. */
  env(session: SessionId): Promise<ExecutionEnv>;
  /** Layers a wrap on a session's environment, the disposer removing it: `PluginApi.wrapEnv`. Default `environments.wrap`. */
  wrapEnv(session: SessionId, wrap: EnvironmentWrap): Disposer;
  /** Resolves what core scanned for a session, gated by its workspace's `projectResources`: `PluginApi.inputs`. Default `scanResources`. */
  resources(session: SessionId): Promise<Resources>;
  /** The host's home directory as the composer passes it; `Resources.user` attaches the `"local"` provider there (decision 9). Default null: no user resources, as on a durable object. */
  readonly home: string | null;
  /** The environment providers the loaded plugins supply and the environments attached through them. Default `createEnvironmentRegistry`, built on first use. */
  readonly environments: EnvironmentRegistry;
  /** The jobs this process started, in memory. Default `createJobTable`, built on first use. */
  readonly jobs: JobTable;
  /** The browser pages held through this kernel, in memory, with their holds (§37i). Default `createPageTable`, built on first use. */
  readonly pages: PageTable;
  /** The open connections by principal, so revoking a principal drops its streams. Default `createConnectionRegistry`. */
  readonly connections: ConnectionRegistry;
  /** Sends one non-run model request charged to a session: `PluginApi.request`; core-f (f3) fills it. */
  request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;
  /** The key core encrypts plugin secrets with (decision 10); null when the composer gave none, and then `secrets.set` answers `unavailable`. */
  readonly secrets: NonNullable<OpenOptions["secrets"]> | null;
  /** The decision-13 built-ins every session loads before its list, kept apart from `hostPlugins` so no `plugins.replace` drops them (§36a); f3's composer sets them. Default none. */
  readonly builtins: readonly Plugin<"core">[];
  /** The core plugins every session loads after the built-ins, in host registration order: what the composer passes; a host-wide `plugins.replace` replaces it. Default none. */
  hostPlugins: readonly Plugin<"core">[];
  /** Where each host plugin loaded from a file came from: its `.nyte/plugins` scope and path, read by `hostPluginRows` for `HostView.plugins` (§41e); a plugin it does not hold is `inline`. Default empty. */
  readonly pluginSources: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;
  /** Returns a session's plugin runtime, the one place a session activates in this process (§44a): created on first use, which starts its activation, and kept until `closePlugins` or a reload installs another. */
  pluginsFor(session: SessionId): PluginRuntime;
  /** Installs a new runtime for a session in place of the one held (§44c) and resolves with its `ready`; callers holding the old runtime finish on it. */
  reloadPlugins(session: SessionId): Promise<void>;
  /** Returns every session's plugin runtime this kernel holds: the one map `pluginsFor` fills. */
  runtimes(): ReadonlyMap<SessionId, PluginRuntime>;
  /** Deactivates a session's plugins and forgets its runtime: what removing the session does. */
  closePlugins(session: SessionId): Promise<void>;
  /** Returns what a session's plugins contributed as last published, in memory; default the empty catalog. */
  catalog(session: SessionId): SessionCatalogView;
  /** Sets a session's catalog in memory and publishes a `catalog` event to it. */
  setCatalog(session: SessionId, catalog: SessionCatalogView): void;
  /** Returns the api of the plugin that owns a part definition, in a session: the active plugin's, or core's own for `core`; throws `unavailable` when no such plugin is active there. */
  pluginApi(owner: string, session: SessionId): PluginApi<"core">;
  /** Hot plugin replacement and preflight over plugin objects; the connection's `PluginsApi` hands it what it loaded. */
  readonly plugins: {
    replace(
      plugins: readonly Plugin<"core">[],
      scope?: { readonly session: SessionId },
    ): ReturnType<Host["plugins"]["replace"]>;
    check(plugins: readonly Plugin<"core">[]): ReturnType<Host["plugins"]["check"]>;
  };
  /** Loads plugin files by path, in path order: what `PluginsApi` hands the files it is given. Default answers `unavailable`; `openHost` passes its plugin loader (§47l). */
  loadPlugins(paths: readonly string[]): Promise<readonly Plugin<"core">[]>;
  /** Who may connect. Default `createPrincipals`, built on first use. */
  readonly principals: Host["principals"];
  /** Collects unreachable history. Default `prune`, which reports reachability and leaves collection to the store driver (§37e). */
  prune(): Promise<PruneReport>;
}

/** Holds the runs live in this process by id: each one's abort controller and whether its stop fence is passed. */
export interface RunTable {
  /** Returns the run's controller and fence, or undefined when it is not live here. */
  get(run: RunId): { readonly controller: AbortController; readonly stopping: boolean } | undefined;
  /** Records the run as live and returns its controller; a run already live keeps the one it has. */
  start(run: RunId): AbortController;
  /** Marks the run stopping, recording it first when it is not live here, so its patches drop from now on; its signal is not aborted. */
  markStopping(run: RunId): void;
  /** Aborts the run's signal: a stop's cleanup, called only once its fence is logged. */
  abort(run: RunId): void;
  /** Returns whether the run's stop fence is passed. */
  isStopping(run: RunId): boolean;
  /** Returns the run's abort signal, or null when it is not live here. */
  signal(run: RunId): AbortSignal | null;
  /** Forgets the run. */
  end(run: RunId): void;
}

/** Carries "this head is owed a step" from admission and run ends to the driver. */
export interface Wakes {
  /** Calls every listener with the head. */
  notify(session: SessionId, head: HeadName): void;
  /** Calls the listener on every notify; the disposer stops it. */
  subscribe(listener: (session: SessionId, head: HeadName) => void): Disposer;
}

/** Returns one input a boundary landed in a run: its message and how it was delivered. */
export interface LandedInput {
  readonly message: MessageId;
  readonly delivery: Delivery;
}

/** Runs one run's assistant turn until it ends; `boundary()` lands the inputs waiting since the last boundary and returns each with its delivery. */
export interface TurnDriver {
  /** Runs the turn and returns how the run ended, or `parked` when a call parked and the run waits (§34d). */
  run(input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView;
    readonly signal: AbortSignal;
    boundary(): Promise<readonly LandedInput[]>;
  }): Promise<RunEnd | { readonly kind: "parked" }>;
}

/** Summarises abandoned commits with a model into branch summary markdown. */
export interface Summarizer {
  (input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly commits: readonly CommitId[];
    readonly instructions: string | null;
    readonly signal: AbortSignal;
  }): Promise<
    | { readonly kind: "ok"; readonly markdown: string; readonly usage: Usage }
    | { readonly kind: "failed"; readonly reason: string }
  >;
}

/** Starts a compaction of a head's context; the caller has already answered `busy`. */
export interface Compactor {
  (input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly instructions: string | null;
  }): Promise<
    | { readonly kind: "started"; readonly message: MessageId }
    | { readonly kind: "nothing-to-compact" }
  >;
}

/** Resolves a head's stored selection and an optional patch or exact configuration, against the contributions the caller read, to the `Configuration` admission records, or the `configure` failure. */
export interface ConfigurationResolver {
  (input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly selected: Configuration | null;
    readonly patch: Configuration | ConfigurationPatch | null;
    readonly contributions: Contributions;
  }): Promise<Configuration | Exclude<ConfigureOutcome, { readonly kind: "configured" }>>;
}

/** Decides whether a submission is admitted as is, modified, rejected or failed: the `before_send` dispatch, keyed by `message` (§35a); `run` is the sender's origin run, null for a client. */
export interface AdmissionGate {
  (
    submission: Submission,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly principal: PrincipalId;
      readonly run: RunId | null;
      readonly message: MessageId;
    },
  ): Promise<Decision<Submission>>;
}

/** Runs a core command by name in a session; its caller has awaited the session's activation, or is that activation (§44b). */
export interface CommandRunner {
  (session: SessionId, name: string, args?: Json): Promise<CommandOutcome>;
}

/** Creates parts and binds part handles for a connection's principal in a session. */
export interface PartProvider {
  /** Creates a part from a definition with an initial state and a placement. */
  create<K extends PartDefinition>(
    context: ConnectionContext,
    session: SessionId,
    kind: K,
    input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId },
  ): Promise<Part<K>>;
  /** Returns a handle on a part by id. */
  part(context: ConnectionContext, session: SessionId, id: PartId): Part<PartDefinition>;
}

/** Runs a part action as a durable step of kind `action` over the part's call record. */
export interface DurableProvider {
  /** Runs the action's `body` with the step's `Durable` and returns how the step ended; `parked` means the act waits until a wake completes the step in this host's life. */
  run(input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly action: string;
    readonly call: CallId;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<unknown>;
  }): Promise<StepOutcome<unknown>>;
}

/** Decides whether a tool call runs as is, with rewritten args, or not at all: the `before_tool` dispatch, which owns the durable step `hook:before_tool:<call>` (§35a) and may park. */
export interface ToolGate {
  (
    call: ToolCall,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly run: RunId;
      readonly principal: PrincipalId;
      readonly signal: AbortSignal;
    },
  ): Promise<StepOutcome<Decision<ToolCall>>>;
}

/** Rewrites a tool call's outcome before it is recorded: the `after_tool` dispatch. */
export interface ToolOutcomeRewriter {
  (
    outcome: ToolOutcome,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly run: RunId;
      readonly call: CallId;
      readonly principal: PrincipalId;
    },
  ): Promise<ToolOutcome>;
}

const RUN_ALL: Kernel["execution"] = { kind: "run", coverage: { kind: "all" } };

const NO_TURN: TurnDriver = { run: async () => unavailable("turn") };

const NO_MODELS: ModelsApi = {
  list: async () => unavailable("models"),
  refresh: async () => unavailable("models"),
  setDefault: async () => unavailable("models"),
  verify: async () => unavailable("models"),
  login: () => unavailable("models"),
  logout: async () => unavailable("models"),
};

/** Describes what `createKernel` takes: the host's id, store, description and host state, every other slot optional, and `poll`, the interval in ms at which a kernel sharing its store with other instances re-reads it (§42h). */
export type KernelOptions = Pick<Kernel, "hostId" | "store" | "description" | "host"> &
  Partial<
    Pick<
      Kernel,
      | "defaultWorkspace"
      | "execution"
      | "runs"
      | "wakes"
      | "turn"
      | "summarize"
      | "compact"
      | "resolveConfiguration"
      | "admit"
      | "command"
      | "waits"
      | "models"
      | "settings"
      | "workspaces"
      | "workspace"
      | "parts"
      | "partDefinitions"
      | "durable"
      | "tools"
      | "beforeTool"
      | "afterTool"
      | "snapshots"
      | "env"
      | "wrapEnv"
      | "resources"
      | "request"
      | "home"
      | "environments"
      | "jobs"
      | "pages"
      | "connections"
      | "secrets"
      | "builtins"
      | "hostPlugins"
      | "pluginSources"
      | "pluginApi"
      | "plugins"
      | "loadPlugins"
      | "principals"
      | "prune"
    >
  > & {
    readonly poll?: number;
  };

/** Returns a kernel over an open store with every slot not given at its default: a slot with no core default answers `unavailable`, and the defaults that need the kernel are built on first use, so spreading a kernel is safe. On a `dispatch` kernel every wake is handed to `dispatchHead` after the commit that caused it (§42s). */
export function createKernel(input: KernelOptions): Kernel {
  const bus = createBus();
  const streams = trackStreams(bus);
  const follows = new Map<SessionId, Follow>();
  const activations = new Map<SessionId, Activation>();
  const inactive: Activation = { kind: "inactive" };
  const activation = (session: SessionId): Activation => activations.get(session) ?? inactive;
  const catalogs = new Map<SessionId, SessionCatalogView>();

  const catalog = (session: SessionId): SessionCatalogView =>
    catalogs.get(session) ?? EMPTY_CATALOG;

  const runtimes = new Map<SessionId, PluginRuntime>();

  const install = (session: SessionId, previous: PluginRuntime | null): PluginRuntime => {
    const created = createPluginRuntime(kernel, session, previous);
    runtimes.set(session, created);

    return created;
  };

  let waits = input.waits ?? null;
  let definitions = input.partDefinitions ?? null;
  let settings = input.settings ?? null;
  let workspaces = input.workspaces ?? null;
  let environments = input.environments ?? null;
  let jobs = input.jobs ?? null;
  let pages = input.pages ?? null;
  let principals = input.principals ?? null;

  const kernel: Kernel = {
    hostId: input.hostId,
    instance: crypto.randomUUID(),
    poll: input.poll ?? null,
    store: input.store,
    description: input.description,
    bus,
    host: input.host,
    folds: createFoldCache({
      store: input.store,
      bus,
      follows,
      streams,
      activation,
      catalog,
      get jobs() {
        return kernel.jobs;
      },
      get pages() {
        return kernel.pages;
      },
    }),
    streams,
    follows,
    driving: new Map(),
    executionState: createExecutionState(),
    pluginState: createPluginState(),
    workspaceState: createWorkspaceState(),
    receipts: new Map(),
    calls: new Map(),
    marks: new Map(),
    changes: new Map(),
    activation,
    setActivation(session, value) {
      activations.set(session, value);
      bus.publish(session, {
        seq: asSeq(0),
        at: Date.now(),
        head: null,
        kind: "activation",
        activation: value,
      });
    },
    defaultWorkspace: input.defaultWorkspace ?? null,
    execution: input.execution ?? RUN_ALL,
    runs: input.runs ?? createRunTable(),
    wakes: input.wakes ?? createWakes(),
    turn: input.turn ?? NO_TURN,
    summarize: input.summarize ?? (async () => unavailable("summarize")),
    compact: input.compact ?? (async () => unavailable("compact")),
    resolveConfiguration:
      input.resolveConfiguration ?? (async () => unavailable("resolveConfiguration")),
    admit: input.admit ?? ((submission, context) => gateSubmission(kernel, submission, context)),
    command: input.command ?? ((session, name, args) => runCommand(kernel, session, name, args)),
    get waits() {
      return (waits ??= createWaitRegistry(kernel));
    },
    models: input.models ?? NO_MODELS,
    get settings() {
      return (settings ??= createSettingsApi(kernel));
    },
    get workspaces() {
      return (workspaces ??= createWorkspaces(kernel, CORE_CONTEXT));
    },
    workspace: input.workspace ?? ((id) => workspaceHandle(kernel, CORE_CONTEXT, id)),
    parts: input.parts ?? {
      create: (context, session, kind, value) =>
        createPartsApi(kernel, context, session).create(kind, value),
      part: (context, session, id) => createPartsApi(kernel, context, session).part(id),
    },
    get partDefinitions() {
      return (definitions ??= createPartDefinitions({ tool: stoppableTool(kernel) }));
    },
    partTable: createPartTable(),
    durable: input.durable ?? { run: (step) => runAction(kernel, step) },
    tools: input.tools ?? ((runtime, run) => toolSource(kernel, runtime, run)),
    beforeTool:
      input.beforeTool ??
      ((call, context) =>
        kernel.pluginsFor(context.session).hooks.decide("before_tool", call, context, {
          call: asId<"call">(`hook:before_tool:${call.call}`),
          run: context.run,
          head: context.head,
          part: null,
          signal: context.signal,
        })),
    afterTool:
      input.afterTool ??
      ((outcome, context) =>
        kernel.pluginsFor(context.session).hooks.transform("after_tool", outcome, context)),
    snapshots: input.snapshots ?? ((session) => kernel.environments.snapshots(session)),
    env: input.env ?? ((session) => kernel.environments.attach(session)),
    wrapEnv: input.wrapEnv ?? ((session, wrap) => kernel.environments.wrap(session, wrap)),
    resources: input.resources ?? ((session) => scanResources(kernel, session)),
    request: input.request ?? (async () => unavailable("request")),
    home: input.home ?? null,
    get environments() {
      return (environments ??= createEnvironmentRegistry(kernel));
    },
    get jobs() {
      return (jobs ??= createJobTable(kernel));
    },
    get pages() {
      return (pages ??= createPageTable(kernel));
    },
    connections: input.connections ?? createConnectionRegistry(),
    secrets: input.secrets ?? null,
    builtins: input.builtins ?? [],
    hostPlugins: input.hostPlugins ?? [],
    pluginSources: input.pluginSources ?? new Map(),
    pluginsFor: (session) => runtimes.get(session) ?? install(session, null),
    reloadPlugins: (session) => install(session, runtimes.get(session) ?? null).ready,
    runtimes: () => runtimes,
    async closePlugins(session) {
      const runtime = runtimes.get(session);

      if (runtime === undefined) return;
      await runtime.close();

      if (runtimes.get(session) === runtime) runtimes.delete(session);
    },
    catalog,
    setCatalog(session, value) {
      catalogs.set(session, value);
      bus.publish(session, {
        seq: asSeq(0),
        at: Date.now(),
        head: null,
        kind: "catalog",
        catalog: value,
      });
    },
    pluginApi:
      input.pluginApi ??
      ((owner, session) =>
        kernel.pluginsFor(session).api(owner) ??
        unavailable(`plugin ${owner} in session ${session}`)),
    plugins: input.plugins ?? {
      replace: (plugins, scope) => replacePlugins(kernel, plugins, scope),
      check: async (plugins) => checkPlugins(plugins),
    },
    loadPlugins:
      input.loadPlugins ??
      (async () => unavailable("plugin files: this host has no plugin loader")),
    get principals() {
      return (principals ??= createPrincipals(kernel));
    },
    prune: input.prune ?? (() => prune(kernel)),
  };

  const execution = kernel.execution;

  if (execution.kind === "dispatch")
    kernel.wakes.subscribe((session, head) => dispatchHead(kernel, execution, session, head));

  return kernel;
}

function createRunTable(): RunTable {
  const live = new Map<RunId, { readonly controller: AbortController; stopping: boolean }>();

  const enter = (run: RunId): { readonly controller: AbortController; stopping: boolean } => {
    const entry = live.get(run) ?? { controller: new AbortController(), stopping: false };
    live.set(run, entry);

    return entry;
  };

  return {
    get: (run) => live.get(run),
    start: (run) => enter(run).controller,
    markStopping(run) {
      enter(run).stopping = true;
    },
    abort(run) {
      live.get(run)?.controller.abort();
    },
    isStopping: (run) => live.get(run)?.stopping ?? false,
    signal: (run) => live.get(run)?.controller.signal ?? null,
    end(run) {
      live.delete(run);
    },
  };
}

function createWakes(): Wakes {
  const listeners = new Set<(session: SessionId, head: HeadName) => void>();

  return {
    notify(session, head) {
      for (const listener of listeners) listener(session, head);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function unavailable(slot: string): never {
  throw new SdkError("unavailable", `${slot} is not provided`);
}
