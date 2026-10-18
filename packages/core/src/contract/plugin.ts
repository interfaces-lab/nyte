import type {
  Awaitable,
  CommandCompletion,
  CompactionPlan,
  Decision,
  Disposer,
  HeadName,
  ModelRef,
  ModelRequest,
  ModelRequestInput,
  ModelRequestOutcome,
  Placement,
  PrincipalId,
  PromptOverride,
  RunEnd,
  RunId,
  RunView,
  Schema,
  SessionId,
  Submission,
  SubmitDraft,
  Thinking,
  ToolCall,
  ToolClass,
  ToolOutcome,
  Transcript,
  Usage,
  UserContent,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { Connection, PluginStorage } from "./host.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { Session } from "./session.ts";
import type { Durable, ToolDefinition } from "./tools.ts";
import type { EnvironmentProvider, EnvironmentWrap, ExecutionEnv, Resources } from "./workspace.ts";

export interface Registry<T, S extends Side = Side, Handle = Disposer> {
  add(item: T): Handle & Disposer;

  add(derive: (draft: RegistryDraft<T>, siblings: Registries<S>) => void): Disposer;

  list(): readonly T[];
}

export interface RegistryDraft<T> {
  set(id: string, item: T): void;

  get(id: string): T | undefined;

  delete(id: string): void;

  ids(): readonly string[];

  wrap(id: string, wrap: (inner: T) => T): void;
}

export interface SettingDefinition<T = unknown> {
  readonly id: string;
  readonly label: string;

  readonly schema: Schema<T>;

  readonly choices?: readonly {
    readonly value: T;
    readonly label: string;
    readonly badge?: string;
  }[];
  readonly default: T;
  readonly scope: "host" | "session";
}

export interface Setting<T = unknown> {
  get(): Promise<T>;

  set(value: T): Promise<void>;

  watch(): AsyncIterable<T>;
}

export interface Command<S extends Side = Side> {
  /**
   * What a user types after `/`, so name it for everyone (`websearch-key`, not `key`), in
   * lowercase letters, digits and `-`. The host refuses a name a client keeps for its own
   * commands; a later plugin's command of the same name replaces this one. Both are reported.
   */
  readonly name: string;
  readonly title: string;
  readonly description: string;

  /** Picking the command waits for text after its name instead of running it at once. */
  readonly takesText?: boolean;
  readonly category?: string;
  readonly keywords?: readonly string[];

  /**
   * Suggests the text after the name from what is typed there so far, untrimmed, as a client's
   * `/` menu asks while the user types; a command with it takes text. A suggestion's `value`
   * replaces all of that text. A throw is reported and suggests nothing.
   */
  complete?(
    prefix: string,
    context: { readonly signal: AbortSignal; readonly api: PluginApi<S> },
  ): Awaitable<readonly CommandCompletion[]>;

  /** Runs with the text typed after the name, trimmed; `""` when there is none. */
  run(
    text: string,
    context: {
      readonly signal: AbortSignal;
      readonly api: PluginApi<S>;
      readonly caller: PrincipalId;
    },
  ): Awaitable<string | { readonly prompt: UserContent } | void>;
}

export interface Agent {
  readonly id: string;
  readonly description?: string;

  readonly mode?: "primary" | "subagent" | "all";
  readonly model?: ModelRef;

  readonly prompt?: PromptOverride;

  readonly tools?: readonly string[];
}

export interface PromptSection {
  readonly id: string;
  readonly text: string;
  readonly order?: number;
}

export interface ModelContextPolicy {
  readonly model: ModelRef;
  readonly contextWindow: number;
  readonly compactAt: number;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly location: string;
}

export interface Keybinding {
  readonly key: string;
  readonly command: string;
  readonly when?: string;
}

/** A tool call another agent runtime asks to run: the runtime's own tool name (`Bash`, `execute`), which grants key on, and the class Nyte shows it by. */
export interface RuntimeCall {
  readonly name: string;
  readonly class: ToolClass;
}

/** Whether a runtime call may run, with the reason its runtime reads when it may not. */
export type RuntimeVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string };

export type SideTable = {
  core: {
    api: {
      readonly session: Session;

      readonly env: ExecutionEnv;

      wrapEnv(wrap: EnvironmentWrap): Disposer;

      readonly inputs: Resources;

      request<T = string>(input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;

      /** Asks the session's active plugins that declare `approve` whether a call another agent runtime runs may run, in load order: the first denial stands, and a session where none declares it allows. Aborting `signal` ends the asking with a denial. */
      approve(call: RuntimeCall, signal: AbortSignal): Promise<RuntimeVerdict>;
    };
    plugin: {
      readonly environment?: EnvironmentProvider;
      /** Decides a call another agent runtime (Claude Code, an ACP agent) asks to run in the session, outside Nyte's agent loop, with this plugin's own api. */
      readonly approve?: (
        call: RuntimeCall,
        context: { readonly api: PluginApi<"core">; readonly signal: AbortSignal },
      ) => Promise<RuntimeVerdict>;
    };
  };
  client: { api: ClientApi; plugin: {} };
};

export type Side = keyof SideTable;

export interface ClientApi {
  readonly client: { readonly name: string; readonly frameworks: readonly string[] };

  readonly session: Session | null;
  readonly ui: {
    notify(input: {
      readonly title?: string;
      readonly message: string;
      readonly level?: "info" | "warning" | "error";
      readonly sound?: boolean;
    }): void;
  };
}

export interface Renderer<K extends PartDefinition = PartDefinition, View = unknown> {
  readonly kind: K;

  readonly framework: string;

  readonly placements?: readonly string[];

  render(
    part: { readonly state: PartState<K>; readonly version: number; readonly placement: Placement },
    act: Part<K>["act"],
  ): View;
}

export type Row<Item, S extends Side, Handle = Disposer> = {
  readonly item: Item;
  readonly sides: S;
  readonly handle: Handle;
};

export type ContributionTable = {
  tools: Row<ToolDefinition, "core">;
  prompt: Row<PromptSection, "core">;
  agents: Row<Agent, "core">;
  modelContext: Row<ModelContextPolicy, "core">;
  skills: Row<Skill, "core">;
  parts: Row<PartDefinition, "core">;
  commands: Row<Command, Side>;
  settings: Row<SettingDefinition, Side, Setting<unknown>>;
  renderers: Row<Renderer, "client">;
  keybindings: Row<Keybinding, "client">;
};

export type Available<Table, S extends Side> = {
  [
    K in keyof Table as Table[K] extends { readonly sides: infer Owners }
      ? [Extract<S, Owners>] extends [never]
        ? never
        : K
      : never
  ]: Table[K];
};

export type Registries<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]: K extends "settings"
    ? SettingsRegistry<S>
    : Registry<
        ContributionTable[K & keyof ContributionTable]["item"],
        S,
        ContributionTable[K & keyof ContributionTable]["handle"]
      >;
};

export interface SettingsRegistry<S extends Side = Side> extends Registry<
  SettingDefinition,
  S,
  Setting<unknown>
> {
  value(id: string): Promise<unknown>;

  watch(id: string): AsyncIterable<unknown>;
}

export type Declared<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]?: readonly ContributionTable[K &
    keyof ContributionTable]["item"][];
};

export type Observe<Event, S extends Side> = {
  event: Event;
  result: void;
  sides: S;
  phase: "observe";
};

export type Transform<Value, S extends Side> = {
  event: Value;
  result: Value;
  sides: S;
  phase: "transform";
};

export type Decide<Value, S extends Side> = {
  event: Value;
  result: Decision<Value>;
  sides: S;
  phase: "decide";
};

export type HookTable = {
  session_activated: Observe<{ readonly session: Session }, "core">;

  before_send: Decide<Submission, "core">;

  run_started: Observe<RunView, "core">;

  transform_transcript: Transform<Transcript, "core">;

  before_compaction: Transform<CompactionPlan, "core">;

  before_request: Transform<ModelRequest, "core">;

  before_tool: Decide<ToolCall, "core">;

  after_tool: Transform<ToolOutcome, "core">;

  after_request: Observe<
    {
      readonly model: ModelRef;
      readonly thinking: Thinking;
      readonly usage: Usage;
      readonly durationMs: number;
      readonly step: "assistant" | "compaction" | "summary" | "plugin";
    },
    "core"
  >;

  run_ended: Observe<RunEnd, "core">;

  run_ended_anywhere: Observe<
    { readonly session: SessionId; readonly run: RunId; readonly end: RunEnd },
    "client"
  >;

  app_ready: Observe<{ readonly restored: boolean }, "client">;

  session_opened: Observe<{ readonly session: Session }, "client">;

  before_submit: Decide<SubmitDraft, "client">;

  session_closed: Observe<{ readonly session: Session }, "client">;

  app_closing: Observe<void, "client">;
};

export type HookName<S extends Side> = keyof Available<HookTable, S>;

export type HookHandler<S extends Side, N extends HookName<S>> = (
  event: Readonly<HookTable[N & keyof HookTable]["event"]>,
  context: {
    readonly api: PluginApi<S>;

    readonly signal: AbortSignal;
    readonly session: SessionId | null;
    readonly head: HeadName | null;
    readonly run: RunId | null;
  } & (HookTable[N & keyof HookTable]["phase"] extends "decide"
    ? S extends "core"
      ? Durable
      : {}
    : {}),
) => Awaitable<HookTable[N & keyof HookTable]["result"]>;

export type HookEntry<S extends Side, N extends HookName<S>> =
  | HookHandler<S, N>
  | { readonly order?: number; readonly run: HookHandler<S, N> };

export type PluginApi<S extends Side> = S extends Side
  ? {
      readonly side: S;

      readonly sdk: Connection;

      readonly contribute: Registries<S>;

      readonly storage: PluginStorage;

      readonly signal: AbortSignal;

      hook<N extends HookName<S>>(name: N, entry: HookEntry<S, N>): Disposer;

      report(issue: ValidationIssue): void;

      reload(): void;
    } & SideTable[S]["api"]
  : never;

export type Plugin<S extends Side> = {
  readonly id: string;

  readonly contribute?: Declared<S>;

  readonly hooks?: { readonly [N in HookName<S>]?: HookEntry<S, N> };

  readonly activate?: (api: PluginApi<S>) => Awaitable<void>;
} & ([S] extends ["core"] ? SideTable["core"]["plugin"] : {});
