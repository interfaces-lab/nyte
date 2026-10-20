import type {
  Activation,
  CallId,
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
  ModelRef,
  ModelRequestInput,
  ModelRequestOutcome,
  PartId,
  PluginLoadOutcome,
  PrincipalId,
  Revision,
  RunEnd,
  RunId,
  RunView,
  SessionCatalogView,
  SessionId,
  ToolInfo,
  Usage,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { KeyedSerial } from "@nyte-ai/schema/serial";
import type { FoldCache, LogPublisher, SessionBus } from "./fold.ts";
import type {
  Connection,
  ConnectionContext,
  ConnectionRegistry,
  Host,
  HostState,
  ImageProcessor,
  ModelState,
  OpenOptions,
} from "./host.ts";
import type { PartDefinition, PartDefinitions, PartTable } from "./parts.ts";
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
import type { Presence } from "../engine/presence.ts";
import type { CallRecord } from "./records.ts";
import type { Session } from "./session.ts";
import type { StoreConnection } from "./store.ts";
import type { ToolDefinition } from "./tools.ts";
import type {
  EnvironmentRegistry,
  ExecutionEnv,
  GitHubAccountApi,
  JobTable,
  McpHub,
  PageTable,
  WorkspaceState,
} from "./workspace.ts";

export interface Kernel {
  readonly hostId: HostId;

  readonly instance: string;

  readonly presence: Presence | null;

  readonly poll: number | null;

  readonly externalCommits: Set<() => void>;

  readonly store: StoreConnection;

  readonly description: HostDescription;

  readonly bus: SessionBus;

  readonly publisher: LogPublisher;

  readonly host: HostState;

  readonly folds: FoldCache;

  readonly executionState: ExecutionState;
  readonly workspaceState: WorkspaceState;

  readonly sessions: SessionDirectory;

  readonly execution: NonNullable<OpenOptions["execution"]>;

  readonly runs: RunTable;

  readonly wakes: Wakes;

  readonly turn: TurnDriver;

  readonly summarize: Summarizer;

  readonly compact: Compactor;

  readonly resolveConfiguration: ConfigurationResolver;

  readonly rememberChoice: (choice: Configuration, scope: "model" | "thinking") => Promise<void>;

  readonly modelSteers: (model: ModelRef) => boolean;

  readonly waits: WaitRegistry;

  readonly modelState: ModelState;

  readonly partDefinitions: PartDefinitions;

  readonly partTable: PartTable;

  readonly home: string | null;

  readonly environments: EnvironmentRegistry;

  readonly jobs: JobTable;

  readonly pages: PageTable;

  readonly connections: ConnectionRegistry;

  request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;

  readonly secrets: NonNullable<OpenOptions["secrets"]> | null;

  readonly mcp: McpHub | null;

  readonly github: GitHubAccountApi | null;

  readonly images: ImageProcessor | null;

  readonly plugins: PluginHost;

  readonly handles: Handles;

  stopStart(session: SessionId): Promise<MessageId | null>;
}

export interface PluginHost {
  readonly builtins: readonly Plugin<"core">[];

  host: readonly Plugin<"core">[];

  readonly sources: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;

  readonly state: PluginState;

  runtime(session: SessionId): PluginRuntime;

  reload(session: SessionId): Promise<void>;

  runtimes(): ReadonlyMap<SessionId, PluginRuntime>;

  close(session: SessionId): Promise<void>;

  api(owner: string, session: SessionId): PluginApi<"core">;

  replace(
    plugins: readonly Plugin<"core">[],
    scope?: { readonly session: SessionId },
  ): ReturnType<Host["plugins"]["replace"]>;

  check(plugins: readonly Plugin<"core">[]): ReturnType<Host["plugins"]["check"]>;

  load(paths: readonly string[]): Promise<readonly Plugin<"core">[]>;
}

export interface SessionDirectory {
  activation(session: SessionId): Activation;

  setActivation(session: SessionId, activation: Activation): void;

  catalog(session: SessionId): SessionCatalogView;

  setCatalog(session: SessionId, catalog: SessionCatalogView): void;

  forget(session: SessionId): void;
}

interface Handles {
  connection(context: ConnectionContext): Connection;

  session(context: ConnectionContext, session: SessionId): Session;

  activationSession(context: ConnectionContext, session: SessionId): Session;
}

export interface RunTable {
  start(session: SessionId, run: RunId): AbortController;

  abort(run: RunId): void;

  signal(run: RunId): AbortSignal | null;

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

export interface WaitRegistry {
  park(entry: ParkedWait): Promise<void>;

  runEnded(session: SessionId, run: RunId, end: RunEnd): Promise<boolean>;

  jobEnded(job: JobId, end: JobEnd): Promise<boolean>;

  partAnswered(
    session: SessionId,
    part: PartId,
    answer: { readonly action: string; readonly input: Json },
  ): Promise<void>;

  partClosed(session: SessionId, part: PartId): Promise<void>;

  inputAdmitted(session: SessionId, head: HeadName, message: MessageId): Promise<void>;

  runStopped(session: SessionId, run: RunId): Promise<void>;

  callStopped(session: SessionId, call: CallId): Promise<void>;

  tick(now: number): Promise<void>;

  rerun(session: SessionId, call: CallId): void;

  refresh(): Promise<void>;

  onWoken(session: SessionId, call: CallId, resume: () => void): Disposer;

  onReceipt(session: SessionId, receipt: string, listener: () => void): Disposer;

  receiptSettled(session: SessionId, receipt: string): void;
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
  readonly driving: Map<RunId, SessionId>;
  readonly covers: Map<object, ExecutionCoverage>;
  readonly advancing: Set<string>;
  readonly undrained: Set<string>;
  readonly leaseQueue: KeyedSerial<string>;
  readonly pending: Map<string, boolean>;
  readonly summaries: Set<string>;
  readonly callQueue: KeyedSerial<string>;
  readonly starting: Map<
    SessionId,
    { readonly done: Promise<void>; readonly abort: AbortController }
  >;
  timer: ReturnType<typeof setInterval> | null;
  closing: AbortController;
}
