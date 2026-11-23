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
  SessionInfo,
  SettingModeInfo,
  SettingPage,
  Submission,
  SubmitDraft,
  Thinking,
  ToolCall,
  ToolClass,
  ToolInfo,
  ToolOutcome,
  Usage,
  UserContent,
  ValidationIssue,
  WorkspaceId,
} from "@nyte-ai/schema";
import { SecretValueType, standard } from "@nyte-ai/schema";
import type { Provider } from "@nyte-ai/ai";
import { Type } from "typebox";
import { readTint } from "../util/tint.ts";
import type { Connection, PluginStorage } from "./host.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { Session } from "./session.ts";
import type { Durable, ToolDefinition } from "./tools.ts";
import type { EnvironmentProvider, EnvironmentWrap, ExecutionEnv, Resources } from "./workspace.ts";

export interface Registry<T> {
  list(): readonly T[];
}

/** Edits a registry's entries once every plugin's plain items are in, in load order. It runs again whenever the session's contributions change. */
export type Derive<T, S extends Side = Side> = (
  draft: RegistryDraft<T>,
  siblings: Registries<S>,
) => void;

/** What a `when` reads about the chat it is asked for. */
export interface Chat {
  /** The chat this one was started from, or null for a top-level chat. */
  readonly parent: SessionId | null;
  /** Every setting's current value in this chat, by id. A secret reads `{ secret: true }` once one is saved, never its value. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** The search providers plugins added. */
  readonly searchProviders: readonly SearchProvider[];
}

/**
 * Whether an item is in a chat. Core asks when the chat's plugins load and again whenever a
 * setting changes or a plugin's items do. It answers at once and never awaits. Only `true` keeps
 * the item; a throw is reported on the plugin and leaves the item out. An item without `when` is
 * always there. Client plugins have no `when`.
 */
export type When = (chat: Chat) => boolean;

export interface RegistryDraft<T> {
  set(id: string, item: T): void;

  get(id: string): T | undefined;

  delete(id: string): void;

  ids(): readonly string[];

  wrap(id: string, wrap: (inner: T) => T): void;
}

type Choices<T> = readonly {
  readonly value: T;
  readonly title: string;
  /** A short line beside the choice, saying what picking it does. */
  readonly note?: string;
}[];

/**
 * A value the user sets. `type` names the field a client draws and the value it holds:
 *
 * - `"text"`: a text field holding a string, `""` by default.
 * - `"number"` and `"integer"`: a number field, `0` by default.
 * - `"switch"`: a switch holding a boolean, `false` by default.
 * - `"secret"`: a masked field holding a `SecretValue`, `null` until one is saved.
 *
 * With `choices` the field is a menu, and the default is the first choice unless `default` names
 * another. A setting whose value fits none of these gives a `schema` and a `default` in place of
 * `type`; a client draws it only when the schema is one of the shapes above, and otherwise it
 * has no field and changes through `settings.apply`.
 */
export type SettingDefinition<T = unknown> = {
  readonly id: string;
  readonly title: string;
  /** One sentence under the field, saying what the setting changes. */
  readonly description?: string;
  /** What an empty text, number or secret field shows. */
  readonly placeholder?: string;
  /** Who shares the value: `"host"` (the default) is one value for every chat, `"chat"` one per chat. */
  readonly scope?: "host" | "chat";
  /**
   * Where a client shows the setting. A `PresetPage` puts it on that page; any other
   * text is the title of a page of its own, which settings with the same text share; without it
   * the setting is a general one. A client that lacks a named page shows the setting as general.
   */
  readonly page?: SettingPage;
  /** Whether the setting is in a chat. Its stored value stays while it is out. */
  readonly when?: When;
} & (
  | { readonly type: "text"; readonly default?: string; readonly choices?: Choices<string> }
  | {
      readonly type: "number" | "integer";
      readonly default?: number;
      readonly choices?: Choices<number>;
    }
  | { readonly type: "switch"; readonly default?: boolean; readonly mode?: undefined }
  | {
      readonly type: "switch";
      readonly default?: never;
      readonly scope: "chat";
      /**
       * Shows the switch as a composer mode: a chip while it is on, and a step of the mode key.
       * Modes are exclusive: turning one on from the composer turns the chat's others off.
       */
      readonly mode: SettingMode;
    }
  | { readonly type: "secret" }
  | {
      readonly schema: Schema<T>;
      readonly default: T;
      readonly choices?: Choices<T>;
      /**
       * The value holds secrets: it is a `SecretValue`, or an object whose entries are
       * `{ secret: true, value }`. The host seals each `value` and sends clients
       * `{ secret: true }` in its place; a write without `value` keeps the one stored. Host
       * scope only.
       */
      readonly secret?: true;
    }
);

/**
 * How a chat switch shows as a composer mode. `icon` names a glyph from the client's icon set.
 * `color` is any CSS colour, such as `#8b5cf6` or `oklch(0.62 0.21 293)`; the chip keeps its hue
 * and chroma, and a colour that doesn't parse is reported on the plugin.
 */
export interface SettingMode {
  readonly icon: string;
  readonly color?: string;
}

/** A setting with every default filled in: what core stores, checks and sends. */
export interface ResolvedSetting<T = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly schema: Schema<T>;
  readonly choices?: Choices<T>;
  readonly default: T;
  readonly scope: "host" | "chat";
  readonly page?: string;
  readonly secret?: true;
  readonly mode?: SettingModeInfo;
  readonly when?: When;
}

const TEXT = standard(Type.String());

const NUMBER = standard(Type.Number());

const INTEGER = standard(Type.Integer());

const SWITCH = standard(Type.Boolean());

const SECRET = standard(SecretValueType);

export function resolveSetting(definition: SettingDefinition): ResolvedSetting {
  const shared = {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    placeholder: definition.placeholder,
    scope: definition.scope ?? "host",
    page: definition.page,
    when: definition.when,
  };

  if ("schema" in definition) {
    return {
      ...shared,
      schema: definition.schema,
      choices: definition.choices,
      default: definition.default,
      secret: definition.secret,
    };
  }

  switch (definition.type) {
    case "text":
      return {
        ...shared,
        schema: TEXT,
        choices: definition.choices,
        default: definition.default ?? definition.choices?.[0]?.value ?? "",
      };
    case "number":
    case "integer":
      return {
        ...shared,
        schema: definition.type === "integer" ? INTEGER : NUMBER,
        choices: definition.choices,
        default: definition.default ?? definition.choices?.[0]?.value ?? 0,
      };
    case "switch":
      return {
        ...shared,
        schema: SWITCH,
        default: definition.default ?? false,
        mode:
          definition.mode === undefined
            ? undefined
            : { icon: definition.mode.icon, tint: readTint(definition.mode.color) },
      };
    case "secret":
      return { ...shared, schema: SECRET, default: null, secret: true };
    default: {
      const _exhaustive: never = definition;

      return _exhaustive;
    }
  }
}

export interface SecretEntry {
  readonly secret: boolean;
  readonly value?: string;
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
  /**
   * Leaves the command out of the session catalog, so no `/` menu offers it; a client still runs
   * it by name. For a plugin's own client calls, such as a value that must not be stored.
   */
  readonly hidden?: boolean;
  readonly category?: string;
  readonly keywords?: readonly string[];
  /** Whether the command is in a chat. */
  readonly when?: When;

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
  ): Awaitable<CommandReturn>;
}

/**
 * What a command's `run` answers: text to show, a `prompt` the chat sends, or a `workspace` the
 * chat moves to once the command returns, which in a chat not yet started is the folder it starts in.
 */
export type CommandReturn =
  | string
  | { readonly prompt: UserContent; readonly workspace?: never }
  | { readonly workspace: WorkspaceId; readonly output?: string; readonly prompt?: never }
  | void;

export interface Agent {
  readonly id: string;
  readonly description?: string;

  readonly mode?: "primary" | "subagent" | "all";
  readonly model?: ModelRef;

  readonly prompt?: PromptOverride;

  readonly tools?: readonly string[];
}

export type PromptSection = {
  readonly id: string;
  /** The text, or a function core calls as it builds each request, for text that follows live state. A changed result reaches the model as an update after the conversation so far, so the cached start of the conversation stays as it was. `null` leaves the section out. */
  readonly text:
    | string
    | ((context: {
        readonly model: ModelRef;
        readonly api: PluginApi<"core">;
      }) => Awaitable<string | null>);
  /** Whether the section is in a chat. */
  readonly when?: When;
} & (
  | { readonly delivery?: "system"; readonly order?: number }
  | {
      readonly delivery: "reminder";
      /** Said when the section leaves the chat. */
      readonly gone: string;
    }
);

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

/** One web search hit; `published` is milliseconds since the Unix epoch. */
export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly published?: number;
}

/** A web search backend the `web_search` tool routes to by `id`; a throw fails the call. */
export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  search(input: {
    readonly query: string;
    readonly signal: AbortSignal;
  }): Promise<readonly SearchResult[]>;
}

export interface Keybinding {
  readonly key: string;
  readonly command: string;
}

import type {
  ProviderRunsApi,
  RuntimeLaunchPolicy,
  RuntimePolicyApi,
  RuntimeScope,
} from "./provider.ts";

export interface RuntimeCall {
  readonly scope?: RuntimeScope;
  readonly name: string;
  readonly class: ToolClass;
}

export type RuntimeVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string };

export interface SideTable {
  core: {
    api: {
      readonly session: Session;
      readonly providerRuns: ProviderRunsApi;
      readonly runtimePolicy: RuntimePolicyApi;

      readonly env: ExecutionEnv;

      wrapEnv(wrap: EnvironmentWrap): Disposer;

      readonly project: Resources;

      request<T = string>(input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;

      /** Asks the session's active plugins that declare `approve` whether a call another agent runtime runs may run, in load order: the first denial stands, and a session where none declares it allows. Aborting `signal` ends the asking with a denial. */
      approve(call: RuntimeCall, signal: AbortSignal): Promise<RuntimeVerdict>;
    };
    plugin: {
      readonly environment?: EnvironmentProvider;
      readonly runtimeLaunchPolicy?: (context: {
        readonly api: PluginApi<"core">;
        readonly head: HeadName;
        readonly signal: AbortSignal;
      }) => Promise<RuntimeLaunchPolicy>;
      /** A model provider for the whole host, read from built-in and home plugins; a project or chat plugin's is ignored. Its models are offered in every chat, so a provider that needs the chat reads it through its plugin's `activate`. */
      readonly provider?: Provider;
      readonly approve?: (
        call: RuntimeCall,
        context: { readonly api: PluginApi<"core">; readonly signal: AbortSignal },
      ) => Promise<RuntimeVerdict>;
    };
  };
  client: { api: ClientApi; plugin: {} };
}

export type Side = keyof SideTable;

export interface ClientApi {
  readonly client: { readonly name: string; readonly frameworks: readonly string[] };

  readonly session: Session | null;

  /** Sessions on screen, uncovered, in a focused window. */
  readonly looking: ReadonlySet<SessionId>;
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

export interface Row<Item, S extends Side> {
  readonly item: Item;
  readonly sides: S;
}

export interface ContributionTable {
  tools: Row<ToolDefinition, "core">;
  prompt: Row<PromptSection, "core">;
  agents: Row<Agent, "core">;
  modelContext: Row<ModelContextPolicy, "core">;
  skills: Row<Skill, "core">;
  searchProviders: Row<SearchProvider, "core">;
  parts: Row<PartDefinition, "core">;
  commands: Row<Command, Side>;
  settings: Row<SettingDefinition, Side>;
  renderers: Row<Renderer, "client">;
  keybindings: Row<Keybinding, "client">;
}

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
    ? SettingsRegistry
    : Registry<ContributionTable[K & keyof ContributionTable]["item"]>;
};

/** The session's settings, and the values of the ones the calling plugin declares. */
export interface SettingsRegistry extends Registry<SettingDefinition> {
  value(id: string): Promise<unknown>;

  set(id: string, value: unknown): Promise<void>;

  watch(id: string): AsyncIterable<unknown>;
}

export type Declared<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]?: readonly ContributionTable[K &
    keyof ContributionTable]["item"][];
};

/** What `activate` adds: plain items, and derivations over the items every plugin declared. */
export type Contributed<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]?: readonly (
    | ContributionTable[K & keyof ContributionTable]["item"]
    | Derive<ContributionTable[K & keyof ContributionTable]["item"], S>
  )[];
};

export interface Observe<Event, S extends Side> {
  event: Event;
  result: void;
  sides: S;
  phase: "observe";
}

export interface Transform<Value, S extends Side> {
  event: Value;
  result: Value;
  sides: S;
  phase: "transform";
}

export interface Decide<Value, S extends Side> {
  event: Value;
  result: Decision<Value>;
  sides: S;
  phase: "decide";
}

export interface HookTable {
  session_activated: Observe<{ readonly session: Session }, "core">;

  before_send: Decide<Submission, "core">;

  run_started: Observe<RunView, "core">;

  /** The session's tools a request may declare and a script may call. Return the list without the ones to withhold; added or edited entries are ignored. */
  offer_tools: Transform<readonly ToolInfo[], "core">;

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

  /** A session's `headAttention` alert changed after the client's first list: a run started, began or stopped waiting on the person, or ended, or the session appeared. */
  attention_changed_anywhere: Observe<{ readonly info: SessionInfo }, "client">;

  app_ready: Observe<{ readonly restored: boolean }, "client">;

  session_opened: Observe<{ readonly session: Session }, "client">;

  before_submit: Decide<SubmitDraft, "client">;

  session_closed: Observe<{ readonly session: Session }, "client">;

  app_closing: Observe<void, "client">;
}

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

      readonly host: Connection;

      /** Every registry as the session has it now. A plugin adds to them only through `contribute`, `hooks` and what `activate` returns. */
      readonly registries: Registries<S>;

      readonly storage: PluginStorage;

      readonly signal: AbortSignal;

      report(issue: ValidationIssue): void;

      reload(): void;
    } & SideTable[S]["api"]
  : never;

export type Hooks<S extends Side> = { readonly [N in HookName<S>]?: HookEntry<S, N> };

/** What an activation adds beside the plugin's declared items and hooks. An empty object adds nothing. */
export interface Additions<S extends Side> {
  readonly contribute?: Contributed<S>;
  readonly hooks?: Hooks<S>;
}

export type Plugin<S extends Side> = {
  readonly id: string;

  readonly contribute?: Declared<S>;

  readonly hooks?: Hooks<S>;

  /**
   * Runs once per activation, after the plugin's declared items and hooks are in. It returns what
   * the plugin adds for this session, which is added with them and removed with the plugin;
   * `{}` adds nothing. Nothing is added afterwards. `api.signal` ends whatever else it started.
   */
  readonly activate?: (api: PluginApi<S>) => Awaitable<Additions<S>>;
} & ([S] extends ["core"] ? SideTable["core"]["plugin"] : {});
