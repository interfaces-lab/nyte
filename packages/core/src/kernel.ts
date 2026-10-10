import { asSeq } from "@nyte-ai/schema";
import type {
  Activation,
  CallId,
  ChangeSet,
  CommandOutcome,
  CommitId,
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  Decision,
  Disposer,
  HeadName,
  HostDescription,
  HostId,
  JobId,
  Json,
  MessageId,
  ModelRequestInput,
  ModelRequestOutcome,
  PartId,
  Placement,
  PrincipalId,
  PruneReport,
  Revision,
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
import { createBus } from "./bus.ts";
import type { SessionBus } from "./bus.ts";
import type { ModelsApi, OpenOptions, SettingsApi } from "./connection.ts";
import { runAction } from "./durable.ts";
import type { StepOutcome } from "./durable.ts";
import type { EnvironmentWrap, ExecutionEnv, Resources } from "./environment.ts";
import { SdkError } from "./error.ts";
import { EMPTY_CATALOG } from "./fold.ts";
import type { Host } from "./host.ts";
import type { HostState } from "./host-view.ts";
import type { Job, Jobs } from "./jobs.ts";
import { createPartDefinitions } from "./part-definitions.ts";
import type { PartDefinitions } from "./part-definitions.ts";
import { createPartsApi } from "./parts-api.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import { createPluginRuntime } from "./plugin-runtime.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import type { ConnectionContext } from "./principals.ts";
import type { StoreConnection } from "./store.ts";
import { stoppableTool } from "./tool-runner.ts";
import type { ToolSource } from "./tool-runner.ts";
import type { Durable } from "./tools.ts";
import { createWaitRegistry } from "./wait-registry.ts";
import type { WaitRegistry } from "./wait-registry.ts";
import { createFoldCache } from "./watch.ts";
import type { FoldCache } from "./watch.ts";
import type { Workspace, Workspaces } from "./workspace.ts";

/** Returns the in-process context every kernel operation closes over; later work orders add fields, none are removed. */
export interface Kernel {
  /** The host this kernel runs as. */
  readonly hostId: HostId;
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
  /** Each ref's latest revision as `publishSet` recorded it, by ref name; `project` stamps `SessionView.revision` from the head ref's. */
  readonly revisions: Map<string, Revision>;
  /** Returns whether this host serves a session's workspace; in memory, default `{ kind: "inactive" }`. */
  activation(session: SessionId): Activation;
  /** Sets a session's activation in memory and publishes an `activation` event to it. */
  setActivation(session: SessionId, activation: Activation): void;
  /** Where a root session acts when `create` names no workspace (decision 5); null until the composer registers one. */
  readonly defaultWorkspace: WorkspaceId | null;
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
  /** Dispatches `before_send` for a submission; core-f fills it. Default continue. */
  readonly admit: AdmissionGate;
  /** Runs a core command in a session; core-f fills it. Default `unknown`. */
  readonly command: CommandRunner;
  /** The durable waits parked in this process, by what wakes them; core-e fills it. */
  readonly waits: WaitRegistry;
  /** Providers, credentials and the model catalog; core-f fills it. */
  readonly models: ModelsApi;
  /** Host-scope settings; core-f fills it. */
  readonly settings: SettingsApi;
  /** The workspaces registered on this host; core-f fills it. */
  readonly workspaces: Workspaces;
  /** Returns a handle on a workspace by id; core-f fills it. */
  workspace(id: WorkspaceId): Workspace;
  /** Creates parts and binds part handles; core-d fills it. */
  readonly parts: PartProvider;
  /** The part definitions this host knows, by kind, with their owners. */
  readonly partDefinitions: PartDefinitions;
  /** Runs part actions as durable steps; core-e fills it. */
  readonly durable: DurableProvider;
  /** Returns the tools a session can call, with deferred tools activated for `run` alone; core-f fills it from the registries. Default: none. */
  tools(session: SessionId, run: RunId | null): ToolSource;
  /** Dispatches `before_tool` for a call; core-f fills it. Default continue. */
  readonly beforeTool: ToolGate;
  /** Dispatches `after_tool` over a call's outcome; core-f fills it. Default: the outcome as given. */
  readonly afterTool: ToolOutcomeRewriter;
  /** Resolves the snapshots of a session's environment around a run, or null when it takes none; the provider attaches lazily. core-f fills it. Default null. */
  snapshots(session: SessionId): Promise<RunSnapshots | null>;
  /** Resolves the environment a session's tools run against; core-f fills it. */
  env(session: SessionId): Promise<ExecutionEnv>;
  /** Layers a wrap on a session's environment, the disposer removing it: `PluginApi.wrapEnv`; core-f (f2) fills it. */
  wrapEnv(session: SessionId, wrap: EnvironmentWrap): Disposer;
  /** Resolves what core scanned for a session, gated by its workspace's `projectResources`: `PluginApi.inputs`; core-f (f2) fills it. */
  resources(session: SessionId): Promise<Resources>;
  /** Sends one non-run model request charged to a session: `PluginApi.request`; core-f (f3) fills it. */
  request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;
  /** The key core encrypts plugin secrets with (decision 10); null when the composer gave none, and then `secrets.set` answers `unavailable`. */
  readonly secrets: NonNullable<OpenOptions["secrets"]> | null;
  /** The core plugins every session loads, in host registration order: what the composer passes; a host-wide `plugins.replace` replaces it. Default none. */
  hostPlugins: readonly Plugin<"core">[];
  /** Returns a session's plugin runtime, created empty on first use and kept for the kernel's life. */
  pluginsFor(session: SessionId): PluginRuntime;
  /** Returns what a session's plugins contributed as last published, in memory; default the empty catalog. */
  catalog(session: SessionId): SessionCatalogView;
  /** Sets a session's catalog in memory and publishes a `catalog` event to it. */
  setCatalog(session: SessionId, catalog: SessionCatalogView): void;
  /** Returns the api of the plugin that owns a part definition, in a session; core-f fills it. */
  pluginApi(owner: string, session: SessionId): PluginApi<"core">;
  /** Hot plugin replacement and preflight; core-f fills it. */
  readonly plugins: Host["plugins"];
  /** Who may connect; core-f fills it. */
  readonly principals: Host["principals"];
  /** Collects unreachable history; core-f fills it. */
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

/** Runs one run's assistant turn until it ends; `boundary()` lands the inputs that joined since the last boundary and returns their ids. */
export interface TurnDriver {
  /** Runs the turn and returns how the run ended. */
  run(input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView;
    readonly signal: AbortSignal;
    boundary(): Promise<readonly MessageId[]>;
  }): Promise<RunEnd>;
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

/** Resolves a head's stored selection and an optional patch or exact configuration to the `Configuration` admission records, or the `configure` failure. */
export interface ConfigurationResolver {
  (input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly selected: Configuration | null;
    readonly patch: Configuration | ConfigurationPatch | null;
  }): Promise<Configuration | Exclude<ConfigureOutcome, { readonly kind: "configured" }>>;
}

/** Decides whether a submission is admitted as is, modified, rejected or failed: the `before_send` dispatch. `run` is the sending connection's origin run, null for a client. */
export interface AdmissionGate {
  (
    submission: Submission,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly principal: PrincipalId;
      readonly run: RunId | null;
    },
  ): Promise<Decision<Submission>>;
}

/** Runs a core command by name in a session. */
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
  run<T>(input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly action: string;
    readonly call: CallId;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<T>;
  }): Promise<StepOutcome<T>>;
}

/** Decides whether a tool call runs as is, with rewritten args, or not at all: the `before_tool` dispatch. It runs as a durable step, so a handler may park on `durable.wait`. */
export interface ToolGate {
  (
    call: ToolCall,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly run: RunId;
      readonly principal: PrincipalId;
      readonly durable: Durable;
    },
  ): Promise<Decision<ToolCall>>;
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
    },
  ): Promise<ToolOutcome>;
}

/** Takes content-addressed snapshots of a session's environment before and after a run and diffs them: where a tool call's `changes` come from. */
export interface RunSnapshots {
  /** Returns the snapshot taken before the run. */
  before(run: RunId): Promise<SnapshotId>;
  /** Returns the snapshot taken after the run. */
  after(run: RunId): Promise<SnapshotId>;
  /** Returns what changed between two snapshots. */
  diff(from: SnapshotId, to: SnapshotId): Promise<ChangeSet>;
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

const NO_SETTINGS: SettingsApi = { apply: async () => unavailable("settings") };

const NO_WORKSPACES: Workspaces = {
  list: async () => unavailable("workspaces"),
  inspect: async () => unavailable("workspaces"),
  add: async () => unavailable("workspaces"),
  forget: async () => unavailable("workspaces"),
};

const NO_JOBS: Jobs = {
  start: async () => unavailable("workspace"),
  recover: async () => unavailable("workspace"),
  list: async () => unavailable("workspace"),
  watch: () => unavailableStream("workspace"),
};

const NO_TOOLS: ToolSource = {
  get: () => undefined,
  list: () => [],
  activate: async () => undefined,
};

const NO_PLUGINS: Host["plugins"] = {
  replace: async () => unavailable("plugins"),
  check: async () => unavailable("plugins"),
};

const NO_PRINCIPALS: Host["principals"] = {
  list: async () => unavailable("principals"),
  pair: async () => unavailable("principals"),
  revoke: async () => unavailable("principals"),
};

/** Returns a kernel over an open store, with a fresh bus, fold cache, activation table, catalog table, run table, wakes and part definition registry (built on first use, its `tool` built-in's `stop` action wired over this kernel); every slot not given answers `unavailable`, except `admit` (continue), `command` (unknown), `parts` (this kernel's `createPartsApi`), `durable` (each action a durable step of kind `action` through `runAction`), `tools` (none), `beforeTool` (continue), `afterTool` (the outcome as given), `snapshots` (null), `secrets` (null), `hostPlugins` (none), `waits` (`createWaitRegistry` over this kernel, built on first use once the kernel object exists) and `pluginsFor` (a `createPluginRuntime` per session over this kernel, built on first use). */
export function createKernel(
  input: Pick<Kernel, "hostId" | "store" | "description" | "host"> &
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
        | "secrets"
        | "hostPlugins"
        | "pluginsFor"
        | "pluginApi"
        | "plugins"
        | "principals"
        | "prune"
      >
    >,
): Kernel {
  const bus = createBus();
  const revisions = new Map<string, Revision>();
  const activations = new Map<SessionId, Activation>();
  const inactive: Activation = { kind: "inactive" };
  const activation = (session: SessionId): Activation => activations.get(session) ?? inactive;
  const catalogs = new Map<SessionId, SessionCatalogView>();
  const runtimes = new Map<SessionId, PluginRuntime>();
  let waits = input.waits ?? null;
  let definitions = input.partDefinitions ?? null;

  const kernel: Kernel = {
    hostId: input.hostId,
    store: input.store,
    description: input.description,
    bus,
    host: input.host,
    folds: createFoldCache({ store: input.store, bus, revisions, activation }),
    revisions,
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
    admit: input.admit ?? (async () => ({ action: "continue" })),
    command: input.command ?? (async () => ({ kind: "unknown" })),
    get waits() {
      waits ??= createWaitRegistry(kernel);

      return waits;
    },
    models: input.models ?? NO_MODELS,
    settings: input.settings ?? NO_SETTINGS,
    workspaces: input.workspaces ?? NO_WORKSPACES,
    workspace: input.workspace ?? unavailableWorkspace,
    parts: input.parts ?? {
      create: (context, session, kind, value) =>
        createPartsApi(kernel, context, session).create(kind, value),
      part: (context, session, id) => createPartsApi(kernel, context, session).part(id),
    },
    get partDefinitions() {
      definitions ??= createPartDefinitions({ tool: stoppableTool(kernel) });

      return definitions;
    },
    durable: input.durable ?? { run: (step) => runAction(kernel, step) },
    tools: input.tools ?? (() => NO_TOOLS),
    beforeTool: input.beforeTool ?? (async () => ({ action: "continue" })),
    afterTool: input.afterTool ?? (async (outcome) => outcome),
    snapshots: input.snapshots ?? (async () => null),
    env: input.env ?? (async () => unavailable("env")),
    wrapEnv: input.wrapEnv ?? (() => unavailable("wrapEnv")),
    resources: input.resources ?? (async () => unavailable("resources")),
    request: input.request ?? (async () => unavailable("request")),
    secrets: input.secrets ?? null,
    hostPlugins: input.hostPlugins ?? [],
    pluginsFor:
      input.pluginsFor ??
      ((session) => {
        const known = runtimes.get(session);

        if (known !== undefined) return known;
        const created = createPluginRuntime(kernel, session);
        runtimes.set(session, created);

        return created;
      }),
    catalog: (session) => catalogs.get(session) ?? EMPTY_CATALOG,
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
    pluginApi: input.pluginApi ?? (() => unavailable("pluginApi")),
    plugins: input.plugins ?? NO_PLUGINS,
    principals: input.principals ?? NO_PRINCIPALS,
    prune: input.prune ?? (async () => unavailable("prune")),
  };

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

function unavailableWorkspace(id: WorkspaceId): Workspace {
  return {
    id,
    info: async () => unavailable("workspace"),
    watch: () => unavailableStream("workspace"),
    update: async () => unavailable("workspace"),
    reload: async () => unavailable("workspace"),
    jobs: NO_JOBS,
    job: unavailableJob,
    changes: async () => unavailable("workspace"),
    patches: () => unavailableStream("workspace"),
    files: async () => unavailable("workspace"),
    git: async () => unavailable("workspace"),
    browser: async () => unavailable("workspace"),
  };
}

function unavailableJob(id: JobId): Job {
  return {
    id,
    key: null,
    write: async () => unavailable("workspace"),
    output: () => unavailableStream("workspace"),
    resize: async () => unavailable("workspace"),
    idle: async () => unavailable("workspace"),
    stop: async () => unavailable("workspace"),
    settled: async () => unavailable("workspace"),
    close: async () => unavailable("workspace"),
    [Symbol.asyncDispose]: async () => unavailable("workspace"),
  };
}

function unavailableStream(slot: string): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: async () => unavailable(slot) }) };
}

function unavailable(slot: string): never {
  throw new SdkError("unavailable", `${slot} is not provided`);
}
