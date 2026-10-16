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
  ExecutionCoverage,
  HeadName,
  HostDescription,
  HostId,
  HostView,
  JobEnd,
  JobId,
  Json,
  MessageId,
  MessageSource,
  ModelRequestInput,
  ModelRequestOutcome,
  PartId,
  Placement,
  PluginLoadOutcome,
  PrincipalId,
  Revision,
  RunEnd,
  RunId,
  RunView,
  SessionCatalogView,
  SessionId,
  Submission,
  ToolCall,
  ToolInfo,
  ToolOutcome,
  Usage,
  ValidationIssue,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { FoldCache, LiveStream, LogPublisher, SessionBus } from "./fold.ts";
import type {
  Connection,
  ConnectionContext,
  ConnectionRegistry,
  Host,
  HostState,
  ModelsApi,
  ModelState,
  OpenOptions,
  SettingsApi,
} from "./host.ts";
import type { Part, PartDefinition, PartDefinitions, PartState, PartTable } from "./parts.ts";
import type {
  Agent,
  ContributionTable,
  HookEntry,
  HookName,
  HookTable,
  Plugin,
  PluginApi,
  Registries,
  Registry,
  SettingDefinition,
  SettingsRegistry,
} from "./plugin.ts";
import type { CallRecord } from "./records.ts";
import type { Session } from "./session.ts";
import type { StoreConnection } from "./store.ts";
import type { Durable, ToolDefinition } from "./tools.ts";
import type {
  EnvironmentRegistry,
  ExecutionEnv,
  JobTable,
  McpHub,
  PageTable,
  Resources,
  SnapshotsApi,
  Workspaces,
  WorkspaceState,
} from "./workspace.ts";

export interface Kernel {
  readonly hostId: HostId;

  readonly instance: string;

  readonly poll: number | null;

  /** Listeners the store poll calls when another process has committed, for readers of what the bus does not carry, such as the session directory. */
  readonly externalCommits: Set<() => void>;

  readonly store: StoreConnection;

  readonly description: HostDescription;

  readonly bus: SessionBus;

  /** The one way logged events reach the bus: once each, in seq order per session. */
  readonly publisher: LogPublisher;

  readonly host: HostState;

  readonly folds: FoldCache;

  readonly streams: Map<SessionId, Map<PartId, LiveStream>>;

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

  /** Builds the public connection and session handles, so engine and plugin code never import the api layer. */
  readonly handles: Handles;
}

export interface Handles {
  connection(context: ConnectionContext): Connection;

  session(context: ConnectionContext, session: SessionId): Session;

  /** The session handle a plugin's `activate` receives: its main head sends without waiting on the activation. */
  activationSession(context: ConnectionContext, session: SessionId): Session;
}

/** This process's abort controllers for the runs it works on. Whether a run is stopping is its record's `stopping`; this table only follows that record's logged stop fence. */
export interface RunTable {
  /** The controller of a run this process works on, created on first use, following the session's bus for the run's stop fence. */
  start(session: SessionId, run: RunId): AbortController;

  abort(run: RunId): void;

  signal(run: RunId): AbortSignal | null;

  /** Whether the run's stop fence reached this process's bus, or its work here was aborted. */
  fenced(run: RunId): boolean;

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

  /** Runs a parked part action again once its wait resolves. */
  rerun(session: SessionId, call: CallId): Promise<void>;
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

export type StepEnd<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "interrupted" };

export type StepOutcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "parked" }
  | { readonly kind: "interrupted"; readonly value: T };

export interface ParkedWait {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly target: NonNullable<CallRecord["waiting"]>;
  readonly partial: CallRecord["partial"];
  readonly index: number;
}

/** Wakes parked calls: each target event offers its outcome to the waits the store-side index lists under it, and `tick` to the timers and deadlines that are due. */
export interface WaitRegistry {
  /** Checks a just-parked wait against what it waits on, completing it at once when that already happened. */
  park(entry: ParkedWait): Promise<void>;

  /** Offers a run's end to its waiters; whether any took it. */
  runEnded(session: SessionId, run: RunId, end: RunEnd): Promise<boolean>;

  /** Offers a job's end to its waiters; whether any took it. */
  jobEnded(job: JobId, end: JobEnd): Promise<boolean>;

  partAnswered(
    session: SessionId,
    part: PartId,
    answer: { readonly action: string; readonly input: Json },
  ): Promise<void>;

  partClosed(session: SessionId, part: PartId): Promise<void>;

  /** Ends the waits on a head that stop at its next input. */
  inputAdmitted(session: SessionId, head: HeadName, message: MessageId): Promise<void>;

  /** Ends the waits a run's parked calls hold, stopped. */
  runStopped(session: SessionId, run: RunId): Promise<void>;

  /** Ends a call's wait, and those of the calls nested in it, stopped. */
  callStopped(session: SessionId, call: CallId): Promise<void>;

  /** Offers the timers and deadlines due at `now`. */
  tick(now: number): Promise<void>;

  rerun(session: SessionId, call: CallId): void;

  /** Re-reads every unsettled call, after another process committed: see `loadWaits`. */
  refresh(): Promise<void>;

  /** Registers this process's live loop for an action call, resumed when its wait completes. */
  onWoken(session: SessionId, call: CallId, resume: () => void): Disposer;
}

export interface PluginRuntime {
  readonly registries: RegistrySet;
  readonly hooks: HookDispatch;

  readonly ready: Promise<void>;

  load(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;

  outcomes(): readonly PluginLoadOutcome[];

  issues(): readonly HostView["plugins"][number][];
  resolvedUncovered(): boolean;

  api(owner: string): PluginApi<"core"> | undefined;

  plugins(): readonly Plugin<"core">[];

  instance(id: string): PluginInstance | undefined;

  assigned(): readonly Plugin<"core">[] | null;

  hold(): Disposer;

  close(): Promise<void>;
}

export interface PluginInstance {
  readonly plugin: Plugin<"core">;
  readonly api: PluginApi<"core">;

  join(host: InstanceHost): Disposer;
}

export interface InstanceHost {
  readonly registries: RegistrySet;
  readonly hooks: HookDispatch;
  report(owner: string, issue: ValidationIssue): void;
}

export interface PluginState {
  readonly assigned: Map<SessionId, readonly Plugin<"core">[]>;
  readonly holds: Map<PartDefinition, { count: number; readonly dispose: Disposer }>;
  readonly settings: Set<(id: string, session: SessionId | null) => void>;
  readonly publishing: Map<SessionId, Promise<void>>;
  secretKey: Promise<CryptoKey> | null;
}

export type Attached = { readonly env: ExecutionEnv | null };

export interface CoreRegistry<T, Handle = Disposer> extends Registry<T, "core", Handle> {
  owned(owner: string, signal?: AbortSignal): Registry<T, "core", Handle>;

  entries(): readonly { readonly item: T; readonly owner: string }[];

  declared(owner: string): readonly T[];

  materialize(
    siblings: Registries<"core">,
  ): readonly { readonly owner: string; readonly issue: ValidationIssue }[];
}

export type CoreRegistries = {
  readonly [K in keyof Registries<"core">]: CoreRegistry<
    ContributionTable[K & keyof ContributionTable]["item"],
    ContributionTable[K & keyof ContributionTable]["handle"]
  > &
    (K extends "settings" ? Pick<SettingsRegistry<"core">, "value" | "watch"> : {});
};

export interface RegistrySet extends CoreRegistries {
  owned(owner: string, signal?: AbortSignal): Registries<"core">;

  materialize(): Promise<void>;

  reload(): void;
}

export type Contributions = {
  readonly agents: readonly Agent[];
  readonly settings: readonly SettingDefinition[];
};

export type CoreHook<Phase extends HookTable[keyof HookTable]["phase"]> = {
  [N in HookName<"core">]: HookTable[N & keyof HookTable]["phase"] extends Phase ? N : never;
}[HookName<"core">];

export type HookEvent<N extends HookName<"core">> = HookTable[N & keyof HookTable]["event"];

export interface HookContext {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly principal: PrincipalId;
}

export interface HookStep {
  readonly call: CallId;
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

export interface HookDispatch {
  register<N extends HookName<"core">>(
    plugin: string,
    api: PluginApi<"core">,
    name: N,
    entry: HookEntry<"core", N>,
  ): Disposer;

  observe<N extends CoreHook<"observe">>(
    name: N,
    event: HookEvent<N>,
    context: HookContext,
  ): Promise<void>;

  transform<N extends CoreHook<"transform">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
    signal?: AbortSignal,
  ): Promise<HookEvent<N>>;

  decide<N extends CoreHook<"decide">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
    step: HookStep,
  ): Promise<StepOutcome<Decision<HookEvent<N>>>>;
}

export interface ToolSource {
  get(name: string): { readonly definition: ToolDefinition; readonly owner: string } | undefined;

  list(): readonly ToolInfo[];
}

interface Held {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly revision: Revision;
  readonly expiresAt: number;
  readonly owners: Set<object>;
}

export interface ExecutionState {
  readonly held: Map<string, Held>;
  readonly covers: Map<object, ExecutionCoverage>;
  readonly advancing: Set<string>;
  readonly queue: Map<string, Promise<unknown>>;
  readonly pending: Map<string, boolean>;
  readonly summaries: Set<string>;
  readonly callQueues: Map<string, Promise<unknown>>;
  timer: ReturnType<typeof setInterval> | null;
  closing: AbortController;
}
