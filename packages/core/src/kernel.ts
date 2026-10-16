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
import type { PageTable } from "./browser.ts";
import type { SessionBus } from "./bus.ts";
import type { ModelsApi, OpenOptions, SettingsApi } from "./connection.ts";
import type { McpHub } from "./mcp.ts";
import type { StepOutcome } from "./durable.ts";
import type { EnvironmentRegistry, ExecutionEnv, Resources, SnapshotsApi } from "./environment.ts";
import type { ExecutionState } from "./execution.ts";
import type { Host, HostState } from "./host.ts";
import type { JobTable } from "./jobs.ts";
import type { Contributions } from "./models.ts";
import type { ModelState } from "./model-state.ts";
import type { PartDefinitions } from "./part-definitions.ts";
import type { Part, PartDefinition, PartState, PartTable } from "./parts.ts";
import type { PluginRuntime, PluginState } from "./plugin-runtime.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import type { ConnectionContext, ConnectionRegistry } from "./principals.ts";
import type { StoreConnection } from "./store.ts";
import type { ToolSource } from "./tool-runner.ts";
import type { Durable } from "./tools.ts";
import type { WaitRegistry } from "./waits.ts";
import type { FoldCache, Follow, LiveStream } from "./watch.ts";
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
