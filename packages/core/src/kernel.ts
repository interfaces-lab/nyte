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
  HeadName,
  HostDescription,
  HostId,
  Json,
  MessageId,
  MessageSource,
  ModelRequestInput,
  ModelRequestOutcome,
  PartId,
  Placement,
  PrincipalId,
  RunEnd,
  RunId,
  RunView,
  SessionCatalogView,
  SessionId,
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
import type { McpHub } from "./mcp.ts";
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
import { createModelState } from "./model-state.ts";
import type { ModelState } from "./model-state.ts";
import { createPartDefinitions } from "./part-definitions.ts";
import { createPart, partHandle } from "./part-handle.ts";
import type { PartDefinitions } from "./part-definitions.ts";
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
import { bumpGeneration, runCommand, toolSource } from "./registry.ts";
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
import { createWorkspaceState, createWorkspaces } from "./workspaces.ts";
import type { WorkspaceState, Workspaces } from "./workspaces.ts";

export interface Kernel {
  readonly hostId: HostId;

  readonly instance: string;

  readonly poll: number | null;

  readonly store: StoreConnection;

  readonly description: HostDescription;

  readonly bus: SessionBus;

  readonly host: HostState;

  readonly folds: FoldCache;

  readonly streams: Map<SessionId, Map<PartId, LiveStream>>;

  readonly follows: Map<SessionId, Follow>;

  readonly driving: Map<RunId, SessionId>;
  readonly executionState: ExecutionState;
  readonly pluginState: PluginState;
  readonly workspaceState: WorkspaceState;

  readonly receipts: Map<string, Set<() => void>>;

  readonly calls: Map<string, Set<AbortController>>;

  activation(session: SessionId): Activation;

  setActivation(session: SessionId, activation: Activation): void;

  defaultWorkspace: WorkspaceId | null;

  readonly execution: NonNullable<OpenOptions["execution"]>;

  readonly runs: RunTable;

  readonly wakes: Wakes;

  readonly turn: TurnDriver;

  readonly summarize: Summarizer;

  readonly compact: Compactor;

  readonly resolveConfiguration: ConfigurationResolver;

  readonly admit: AdmissionGate;

  readonly command: CommandRunner;

  readonly waits: WaitRegistry;

  readonly models: ModelsApi;
  readonly modelState: ModelState;

  readonly settings: SettingsApi;

  readonly workspaces: Workspaces;

  readonly parts: PartProvider;

  readonly partDefinitions: PartDefinitions;

  readonly partTable: PartTable;

  readonly durable: DurableProvider;

  tools(runtime: PluginRuntime): ToolSource;

  readonly beforeTool: ToolGate;

  readonly afterTool: ToolOutcomeRewriter;

  snapshots(session: SessionId): Promise<SnapshotsApi | null>;

  env(session: SessionId): Promise<ExecutionEnv>;

  wrapEnv(session: SessionId, wrap: EnvironmentWrap): Disposer;

  resources(session: SessionId): Promise<Resources>;

  readonly home: string | null;

  readonly environments: EnvironmentRegistry;

  readonly jobs: JobTable;

  readonly pages: PageTable;

  readonly connections: ConnectionRegistry;

  request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;

  readonly secrets: NonNullable<OpenOptions["secrets"]> | null;

  readonly mcp: McpHub | null;

  readonly builtins: readonly Plugin<"core">[];

  hostPlugins: readonly Plugin<"core">[];

  readonly pluginSources: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;

  pluginsFor(session: SessionId): PluginRuntime;

  reloadPlugins(session: SessionId): Promise<void>;

  runtimes(): ReadonlyMap<SessionId, PluginRuntime>;

  closePlugins(session: SessionId): Promise<void>;

  catalog(session: SessionId): SessionCatalogView;

  setCatalog(session: SessionId, catalog: SessionCatalogView): void;

  forget(session: SessionId): void;

  pluginApi(owner: string, session: SessionId): PluginApi<"core">;

  readonly plugins: {
    replace(
      plugins: readonly Plugin<"core">[],
      scope?: { readonly session: SessionId },
    ): ReturnType<Host["plugins"]["replace"]>;
    check(plugins: readonly Plugin<"core">[]): ReturnType<Host["plugins"]["check"]>;
  };

  loadPlugins(paths: readonly string[]): Promise<readonly Plugin<"core">[]>;

  readonly principals: Host["principals"];
}

export interface RunTable {
  get(run: RunId): { readonly controller: AbortController; readonly stopping: boolean } | undefined;

  start(run: RunId): AbortController;

  markStopping(run: RunId): Disposer;

  abort(run: RunId): void;

  isStopping(run: RunId): boolean;

  signal(run: RunId): AbortSignal | null;

  end(run: RunId): void;
}

export interface Wakes {
  notify(session: SessionId, head: HeadName): void;

  subscribe(listener: (session: SessionId, head: HeadName) => void): Disposer;
}

export interface LandedInput {
  readonly message: MessageId;
  readonly delivery: Delivery;
  readonly source: MessageSource;
}

export interface TurnDriver {
  run(input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView;
    readonly signal: AbortSignal;
    boundary(): Promise<readonly LandedInput[]>;
  }): Promise<RunEnd | { readonly kind: "parked" }>;
}

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

export interface ConfigurationResolver {
  (input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly selected: Configuration | null;
    readonly patch: Configuration | ConfigurationPatch | null;
    readonly contributions: Contributions;
  }): Promise<Configuration | Exclude<ConfigureOutcome, { readonly kind: "configured" }>>;
}

export interface AdmissionGate {
  (
    submission: Submission,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly principal: PrincipalId;
      readonly run: RunId | null;
      readonly message: MessageId;
      readonly signal: AbortSignal;
    },
  ): Promise<Decision<Submission>>;
}

export interface CommandRunner {
  (
    context: ConnectionContext,
    session: SessionId,
    name: string,
    args?: Json,
  ): Promise<CommandOutcome>;
}

export interface PartProvider {
  create<K extends PartDefinition>(
    context: ConnectionContext,
    session: SessionId,
    kind: K,
    input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId },
  ): Promise<Part<K>>;

  part(context: ConnectionContext, session: SessionId, id: PartId): Part<PartDefinition>;
}

export interface DurableProvider {
  run(input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly action: string;
    readonly call: CallId;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<unknown>;
  }): Promise<StepOutcome<unknown>>;
}

export interface ToolGate {
  (
    call: ToolCall,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly run: RunId;
      readonly principal: PrincipalId;
      readonly signal: AbortSignal;
      readonly runtime: PluginRuntime;
    },
  ): Promise<StepOutcome<Decision<ToolCall>>>;
}

export interface ToolOutcomeRewriter {
  (
    outcome: ToolOutcome,
    context: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly run: RunId;
      readonly call: CallId;
      readonly principal: PrincipalId;
      readonly runtime: PluginRuntime;
    },
  ): Promise<ToolOutcome>;
}

const RUN_ALL: Kernel["execution"] = { kind: "run", coverage: { kind: "all" } };

const NO_TURN: TurnDriver = { run: async () => unavailable("turn") };

const NO_MODELS: ModelsApi = {
  list: async () => unavailable("models"),
  accounts: async () => unavailable("models"),
  selectAccount: async () => unavailable("models"),
  usage: async () => unavailable("models"),
  refresh: async () => unavailable("models"),
  setDefault: async () => unavailable("models"),
  verify: async () => unavailable("models"),
  login: () => unavailable("models"),
  logout: async () => unavailable("models"),
};

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
      | "mcp"
      | "builtins"
      | "hostPlugins"
      | "pluginSources"
      | "pluginApi"
      | "plugins"
      | "loadPlugins"
      | "principals"
    >
  > & {
    readonly poll?: number;
  };

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
    command:
      input.command ??
      ((context, session, name, args) => runCommand(kernel, context, session, name, args)),
    get waits() {
      return (waits ??= createWaitRegistry(kernel));
    },
    models: input.models ?? NO_MODELS,
    modelState: createModelState(() => bumpGeneration(kernel)),
    get settings() {
      return (settings ??= createSettingsApi(kernel));
    },
    get workspaces() {
      return (workspaces ??= createWorkspaces(kernel, CORE_CONTEXT));
    },
    parts: input.parts ?? {
      create: (context, session, kind, value) => createPart(kernel, context, session, kind, value),
      part: (context, session, id) => partHandle(kernel, context, session, id),
    },
    get partDefinitions() {
      return (definitions ??= createPartDefinitions({ tool: stoppableTool(kernel) }));
    },
    partTable: createPartTable(),
    durable: input.durable ?? { run: (step) => runAction(kernel, step) },
    tools: input.tools ?? toolSource,
    beforeTool:
      input.beforeTool ??
      ((call, { runtime, ...context }) =>
        runtime.hooks.decide("before_tool", call, context, {
          call: asId<"call">(`hook:before_tool:${call.call}`),
          run: context.run,
          head: context.head,
          part: null,
          signal: context.signal,
        })),
    afterTool:
      input.afterTool ??
      ((outcome, { runtime, ...context }) =>
        runtime.hooks.transform("after_tool", outcome, context)),
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
    mcp: input.mcp ?? null,
    builtins: input.builtins ?? [],
    hostPlugins: input.hostPlugins ?? [],
    pluginSources: input.pluginSources ?? new Map(),
    pluginsFor: (session) => runtimes.get(session) ?? install(session, null),
    reloadPlugins: (session) => install(session, runtimes.get(session) ?? null).ready,
    runtimes: () => runtimes,
    async closePlugins(session) {
      const runtime = runtimes.get(session);

      if (runtime === undefined) return;
      runtimes.delete(session);
      await runtime.close();
    },
    catalog,
    forget(session) {
      catalogs.delete(session);
      activations.delete(session);
    },
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
      const entry = enter(run);
      entry.stopping = true;

      return () => {
        entry.stopping = false;
      };
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
