import type {
  Awaitable,
  CompactionPlan,
  Decision,
  Disposer,
  HeadName,
  ModelContext,
  ModelRef,
  ModelRequest,
  ModelRequestInput,
  ModelRequestOutcome,
  Placement,
  PromptOverride,
  RunEnd,
  RunId,
  RunView,
  Schema,
  SessionId,
  SubmitDraft,
  Submission,
  Thinking,
  ToolCall,
  ToolOutcome,
  Transcript,
  Usage,
  UserContent,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { Connection, PluginStorage } from "./connection.ts";
import type {
  EnvironmentProvider,
  EnvironmentWrap,
  ExecutionEnv,
  Resources,
} from "./environment.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { Session } from "./session.ts";
import type { Durable, ToolDefinition } from "./tools.ts";

/**
 * Holds one contribution kind: add items, derive them at reload, list the
 * materialised set.
 *
 * **Details**
 *
 * Reload order within one pass: tools → agents → prompt → the rest; a derive
 * reads siblings materialised earlier in the pass. Writes schedule a reload;
 * external state (an MCP server reconnected) calls `api.reload()`.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Registry<T, S extends Side = Side, Handle = Disposer> {
  /** Adds a static item; the handle removes it. */
  add(item: T): Handle & Disposer;
  /**
   * Adds a derivation run at each reload: a server's catalog, or wrapping
   * another plugin's item. `siblings` are the other registries as of this
   * reload, so prompt can read tools in the same pass.
   */
  add(derive: (draft: RegistryDraft<T>, siblings: Registries<S>) => void): Disposer;
  /** Returns the items materialised after the last reload; the system prompt names the real set. */
  list(): readonly T[];
}

/**
 * Returns the mutable set a derivation edits during one reload.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface RegistryDraft<T> {
  /** Adds or replaces an item. */
  set(id: string, item: T): void;
  /** Returns an item, or undefined. */
  get(id: string): T | undefined;
  /** Removes an item. */
  delete(id: string): void;
  /** Returns every id in the draft. */
  ids(): readonly string[];
  /** Replaces one item's behaviour, keeping its identity. */
  wrap(id: string, wrap: (inner: T) => T): void;
}

/**
 * Describes a setting a plugin contributes.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface SettingDefinition<T = unknown> {
  readonly id: string;
  readonly label: string;
  /** Choices, numbers, text, lists: the client renders from the JSON Schema. */
  readonly schema: Schema<T>;
  /** For enum schemas: labels and a badge shown while current. */
  readonly choices?: readonly {
    readonly value: T;
    readonly label: string;
    readonly badge?: string;
  }[];
  readonly default: T;
  readonly scope: "host" | "session";
}

/**
 * Returns a plugin's handle on its own setting, from `contribute.settings.add`.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Setting<T = unknown> {
  /** Returns the current value. */
  get(): Promise<T>;
  /** Stores a value. */
  set(value: T): Promise<void>;
  /**
   * Yields the value as any host or client changes it, until deactivation.
   *
   * @stream watch
   */
  watch(): AsyncIterable<T>;
}

/**
 * Describes a palette command and what it runs.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Command<Args = unknown, S extends Side = Side> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Absent = runs on pick. */
  readonly arguments?: Schema<Args>;
  readonly category?: string;
  readonly keywords?: readonly string[];
  /** Runs the command: text shows; a prompt is sent by core with source action `{ label: title, command: name }`. */
  run(
    args: Args,
    context: { readonly signal: AbortSignal; readonly api: PluginApi<S> },
  ): Awaitable<string | { readonly prompt: UserContent } | void>;
}

/**
 * Describes an agent preset: model, prompt and tools.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Agent {
  readonly id: string;
  readonly description?: string;
  /** Default all. */
  readonly mode?: "primary" | "subagent" | "all";
  readonly model?: ModelRef;
  /**
   * The agent's prompt section, layered or replacing.
   *
   * **Details**
   *
   * The system prompt is sections: builtins (system-prompt 0, tools, rules,
   * cwd, skills, project-context), `Resources.prompt` from SYSTEM.md /
   * APPEND_SYSTEM.md, and plugins'. `layer` adds one more at an order.
   * `replace` makes the whole prompt this text, every section suppressed,
   * byte for byte: what a cached reviewer role needs. Tools are declared
   * through the API, not the prompt, so replace hides guidance, never a tool.
   * When several replace: `sessions.create({ prompt })` › `Agent.prompt` ›
   * project SYSTEM.md › user SYSTEM.md.
   */
  readonly prompt?: PromptOverride;
  /** By name; omitted = every tool the session has. */
  readonly tools?: readonly string[];
}

/**
 * Describes one system prompt section.
 *
 * **Details**
 *
 * Order is 0..9999, default 100; declared as `<order>-<id>` so the model is
 * told when one changes. Ids are global: a later source overrides
 * "system-prompt" on purpose.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface PromptSection {
  readonly id: string;
  readonly text: string;
  readonly order?: number;
}

/**
 * Describes one model's context limits; folded into `ModelInfo` for that
 * model.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface ModelContextPolicy {
  readonly model: ModelRef;
  readonly contextWindow: number;
  readonly compactAt: number;
}

/**
 * Describes a skill the model can load on demand.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly modelInvocable?: boolean;
  load(): Promise<string>;
}

/**
 * Binds a key to a command, optionally under a context.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Keybinding {
  readonly key: string;
  readonly command: string;
  readonly when?: string;
}

/**
 * Maps each side to what it adds to the plugin api and to the plugin object.
 * Table 1 of three; every other plugin type is derived.
 *
 * @category plugins
 * @since 0.1.0
 */
export type SideTable = {
  core: {
    api: {
      /** Activated once per session; the real handle. */
      readonly session: Session;
      /** The session's environment. */
      readonly env: ExecutionEnv;
      /** Layers on the environment; may add a browser to one that lacks it: the desktop adds its viewport browser to local. */
      wrapEnv(wrap: EnvironmentWrap): Disposer;
      /** What core scanned for this session; gated by projectResources. Skills and context files read this, never the raw tree. */
      readonly inputs: Resources;
      /** Sends one non-turn request, charged to the session. Nothing streams; nothing is a run. */
      request<T = string>(input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;
    };
    plugin: { readonly environment?: EnvironmentProvider };
  };
  client: { api: ClientApi; plugin: {} };
};

/**
 * Names a plugin side: core or client.
 *
 * **Details**
 *
 * There is no desktop, tui or web side. A client plugin cannot know which
 * app hosts it, as a tool cannot know which environment runs it. It declares
 * what it renders for; the client mounts what it can.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Side = keyof SideTable;

/**
 * Returns what a client plugin's api adds: the client, the session on
 * screen, and notifications.
 *
 * **Details**
 *
 * Asking is a part some plugin declared, rendered by that plugin's renderer.
 * A client plugin that wants a dialog creates that part on its own
 * connection. There is no dialog API on any side.
 *
 * **Example** (A client plugin that asks once at startup, with a part it declares)
 *
 * ```tsx
 * import type { Plugin } from "@nyte-ai/plugin/client";
 * import { z } from "zod";
 *
 * const consent = definePart({
 *   kind: "welcome/consent",
 *   state: z.object({}),
 *   actions: { yes: { input: z.object({}) }, no: { input: z.object({}) } },
 *   fallback: () => "Enable telemetry?",
 * });
 *
 * export default {
 *   id: "welcome",
 *   contribute: {
 *     renderers: [
 *       {
 *         kind: consent,
 *         framework: "react",
 *         render: (_part, act) => <Dialog onYes={() => act("yes", {})} onNo={() => act("no", {})} />,
 *       },
 *     ],
 *   },
 *   hooks: {
 *     app_ready: async (_event, { api }) => {
 *       if (api.session === null) return;
 *       const part = await api.session.parts.create(consent, { state: {}, placement: { kind: "modal" } });
 *       const answer = await part.answer();
 *       if (answer !== null) await api.storage.set("telemetry", answer.action === "yes");
 *     },
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @category plugins
 * @since 0.1.0
 */
export interface ClientApi {
  /** "desktop", "tui", "web", "acme-portal": informational. Branch on frameworks, never on name. */
  readonly client: { readonly name: string; readonly frameworks: readonly string[] };
  /** The one on screen. */
  readonly session: Session | null;
  readonly ui: {
    /** Shows a notification. */
    notify(input: {
      readonly title?: string;
      readonly message: string;
      readonly level?: "info" | "warning" | "error";
      readonly sound?: boolean;
    }): void;
  };
}

/**
 * Describes how a client plugin draws one part kind in one framework.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface Renderer<K extends PartDefinition = PartDefinition, View = unknown> {
  /** Import type from the core plugin for typed state; unknown otherwise. */
  readonly kind: K;
  /** What render returns; a client mounts renderers for its framework and draws fallback for the rest. A plugin may ship one per framework. */
  readonly framework: "react" | "tui" | string;
  /** Which placement kinds this renderer draws; omitted = any. */
  readonly placements?: readonly string[];
  /** Returns the framework's view for a part's state. */
  render(
    part: { readonly state: PartState<K>; readonly version: number; readonly placement: Placement },
    act: Part<K>["act"],
  ): View;
}

/**
 * Returns one contribution row: item type, owning sides, and what `add`
 * returns.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Row<Item, S extends Side, Handle = Disposer> = {
  readonly item: Item;
  readonly sides: S;
  readonly handle: Handle;
};

/**
 * Maps each contribution kind to its item type and the sides that may own
 * it. Table 2 of three; adding a contribution is one row.
 *
 * **Details**
 *
 * Status, panels, dialogs and decorations are not contribution kinds: they
 * are parts with a placement. `settings.add()` returns the `Setting` handle,
 * so the plugin reads and watches its own value.
 *
 * @category plugins
 * @since 0.1.0
 */
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

/**
 * Returns the rows of a table whose sides overlap `S`.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Available<Table, S extends Side> = {
  [
    K in keyof Table as Table[K] extends { readonly sides: infer Owners }
      ? [Extract<S, Owners>] extends [never]
        ? never
        : K
      : never
  ]: Table[K];
};

/**
 * Returns one registry per contribution kind available to a side.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Registries<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]: K extends "settings"
    ? SettingsRegistry<S>
    : Registry<
        ContributionTable[K & keyof ContributionTable]["item"],
        S,
        ContributionTable[K & keyof ContributionTable]["handle"]
      >;
};

/**
 * Returns the settings registry: a registry that also reads the settings
 * this plugin declared, statically in `contribute.settings` or through
 * `add`, so no plugin declares a setting twice to hold its handle.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface SettingsRegistry<S extends Side = Side> extends Registry<
  SettingDefinition,
  S,
  Setting<unknown>
> {
  /**
   * Returns the current value of a setting this plugin declared: the
   * session layer, else the host value, else the default.
   *
   * @throws {SdkError} unknown when this plugin declares no setting with this id.
   */
  value(id: string): Promise<unknown>;
  /**
   * Yields the value of a setting this plugin declared, then each change,
   * until the plugin deactivates.
   *
   * @stream watch
   * @throws {SdkError} unknown when this plugin declares no setting with this id.
   */
  watch(id: string): AsyncIterable<unknown>;
}

/**
 * Returns the static contribution arrays a plugin may declare for a side.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Declared<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]?: readonly ContributionTable[K &
    keyof ContributionTable]["item"][];
};

/**
 * Returns an observe row: the result is ignored and awaited by the
 * dispatcher, never by the operation.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Observe<Event, S extends Side> = {
  event: Event;
  result: void;
  sides: S;
  phase: "observe";
};

/**
 * Returns a transform row: handlers chain, each seeing the previous result.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Transform<Value, S extends Side> = {
  event: Value;
  result: Value;
  sides: S;
  phase: "transform";
};

/**
 * Returns a decide row: handlers return a {@link Decision}; reject
 * short-circuits, error fails the operation.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Decide<Value, S extends Side> = {
  event: Value;
  result: Decision<Value>;
  sides: S;
  phase: "decide";
};

/**
 * Maps each hook to its event, result, sides and phase. Table 3 of three;
 * adding a hook is one row.
 *
 * **Details**
 *
 * Phases:
 *
 * - observe: result ignored; awaited by the dispatcher, never by the operation.
 * - transform: handlers chain; each sees the previous result.
 * - decide: continue | modify | reject | error; reject short-circuits, error
 *   fails the operation.
 *
 * Lifecycle, core, per session: create instance → install declared
 * contribute/hooks → await activate, in host registration order →
 * `session_activated`. Activation failure rolls back. A turn: send →
 * `before_send` → admission → `run_started` → `transform_context` →
 * `transform_transcript` → [`before_compaction` → compact]? →
 * `before_request` → model → [`before_tool` → execute → `after_tool`]* →
 * (another model request, from `transform_context`)* → `run_ended`.
 * Teardown: abort signal → remove contributions.
 *
 * Lifecycle, client, per app: mount → install declared → await activate →
 * `app_ready` (sends admitted after this) → `session_opened` →
 * `before_submit` per Enter → `session_closed` on switch → `app_closing`.
 * Parts are usable from `app_ready` on; their answers never gate the app.
 *
 * Handlers run by ascending order, then registration sequence. Declared
 * hooks register before that plugin's activate.
 *
 * **Example** (A consent gate on before_tool)
 *
 * ```ts
 * import type { Plugin } from "@nyte-ai/plugin/core";
 *
 * declare const approve: PartDefinition<{ readonly command: string }>;
 *
 * export default {
 *   id: "shell-gate",
 *   hooks: {
 *     before_tool: async (call, { api, wait }) => {
 *       if (call.class.kind !== "shell") return { action: "continue" };
 *       const part = await api.session.parts.create(approve, {
 *         state: { command: call.class.command },
 *         placement: { kind: "modal" },
 *       });
 *       const outcome = await wait({ kind: "part", part: part.id });
 *       return outcome.kind === "part" && outcome.answer?.action === "allow"
 *         ? { action: "continue" }
 *         : { action: "reject", reason: "The user declined." };
 *     },
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookTable = {
  /** After a session's plugins activate. */
  session_activated: Observe<{ readonly session: Session }, "core">;
  /** Every caller: user, tool, child, job. */
  before_send: Decide<Submission, "core">;
  /** When a run starts. */
  run_started: Observe<RunView, "core">;
  /** Rewrites what the kernel assembled for a request. */
  transform_context: Transform<ModelContext, "core">;
  /** Rewrites the exact request body. */
  transform_transcript: Transform<Transcript, "core">;
  /** Changes what is summarised, or supplies the summary. */
  before_compaction: Transform<CompactionPlan, "core">;
  /** Changes model, thinking or options per provider request. */
  before_request: Transform<ModelRequest, "core">;
  /** Allows, rewrites or rejects a tool call. */
  before_tool: Decide<ToolCall, "core">;
  /** Redaction and truncation rewrite what the model sees. */
  after_tool: Transform<ToolOutcome, "core">;
  /** What a telemetry plugin reads. */
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
  /** When a run ends. */
  run_ended: Observe<RunEnd, "core">;
  /** Any session this client can see; the notifier's hook. */
  run_ended_anywhere: Observe<
    { readonly session: SessionId; readonly run: RunId; readonly end: RunEnd },
    "client"
  >;
  /** After client plugins activate; sends are admitted from here on. */
  app_ready: Observe<{ readonly restored: boolean }, "client">;
  /** When a session comes on screen. */
  session_opened: Observe<{ readonly session: Session }, "client">;
  /** UI sends only; calling `Head.send` directly bypasses it. */
  before_submit: Decide<SubmitDraft, "client">;
  /** When a session leaves the screen. */
  session_closed: Observe<{ readonly session: Session }, "client">;
  /** Before the app closes. */
  app_closing: Observe<void, "client">;
};

/**
 * Returns the hook names available to a side.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookName<S extends Side> = keyof Available<HookTable, S>;

/**
 * Returns a hook handler's signature, inferred from {@link HookTable}.
 *
 * **Details**
 *
 * A core decide hook is a durable step: its context includes {@link Durable},
 * so it may park on a modal part. The budget covers compute, not the park.
 * This is how a consent gate lives on `before_tool`.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookHandler<S extends Side, N extends HookName<S>> = (
  event: Readonly<HookTable[N & keyof HookTable]["event"]>,
  context: {
    readonly api: PluginApi<S>;
    /** This invocation's budget; before_compaction gets 300 s, others 5 s. Deactivation also fires it. */
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

/**
 * Returns a hook entry: a handler, or a handler with an order.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookEntry<S extends Side, N extends HookName<S>> =
  | HookHandler<S, N>
  | { readonly order?: number; readonly run: HookHandler<S, N> };

/**
 * Returns what a plugin's `activate` and handlers receive on a side.
 *
 * @category plugins
 * @since 0.1.0
 */
export type PluginApi<S extends Side> = S extends Side
  ? {
      readonly side: S;
      /**
       * Core: the host; client: the app's own connection.
       *
       * **Gotchas**
       *
       * On core, a send to the plugin's own session from `activate` goes through `api.session`:
       * through `sdk` it waits on that session's activation, which is waiting on `activate`.
       */
      readonly sdk: Connection;
      /** One registry per contribution kind on this side. */
      readonly contribute: Registries<S>;
      /** This plugin's storage. */
      readonly storage: PluginStorage;
      /** Deactivation: reload, removal, session or app closing. */
      readonly signal: AbortSignal;
      /** Registers a hook handler; the disposer removes it. */
      hook<N extends HookName<S>>(name: N, entry: HookEntry<S, N>): Disposer;
      /** Reports an issue at any time; shown live on `HostView.plugins[].issues`. An MCP server failing later reports here. */
      report(issue: ValidationIssue): void;
      /**
       * Re-derives this plugin's contributions against external state that
       * changed (an MCP server reconnected).
       *
       * **Details**
       *
       * A hot reload of what it offers, not of the plugin: that is
       * `host.plugins.replace`. A registry write already schedules one.
       */
      reload(): void;
    } & SideTable[S]["api"]
  : never;

/**
 * Returns a plugin for one side: an id, static contributions, hooks and an
 * activate function.
 *
 * **Details**
 *
 * One `Plugin<Side>`; three tables ({@link SideTable},
 * {@link ContributionTable}, {@link HookTable}) are the source of truth.
 * Composition is plain code: spread another plugin's contribute arrays into
 * yours and call its activate from your activate. No API.
 *
 * The subpath fixes the side, and authoring is `satisfies Plugin`; no
 * factory. Hook parameters are inferred from `HookTable`; the payload names
 * exist for hover and for anyone factoring a helper. No plugin imports them.
 *
 * **Example** (Authoring a core plugin)
 *
 * ```ts
 * import type { Plugin } from "@nyte-ai/plugin/core";
 *
 * export default {
 *   id: "hello",
 *   hooks: {
 *     before_compaction: (plan) => ({ ...plan, result: { kind: "summary", text: "hello world" } }),
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @see {@link PluginApi}
 * @category plugins
 * @since 0.1.0
 */
export type Plugin<S extends Side> = {
  readonly id: string;
  /** Static items; registries for derived ones. */
  readonly contribute?: Declared<S>;
  /** Hook handlers by name, installed before activate. */
  readonly hooks?: { readonly [N in HookName<S>]?: HookEntry<S, N> };
  /** Runs once per session on core, once per app on a client. */
  readonly activate?: (api: PluginApi<S>) => Awaitable<void>;
} & ([S] extends ["core"] ? SideTable["core"]["plugin"] : {});
