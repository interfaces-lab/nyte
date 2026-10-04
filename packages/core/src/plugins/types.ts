/**
 * The plugin contract: what a plugin module exports and what the host
 * hands its `session` factory. Built-ins under `./builtin` and files under
 * `.nyte/plugins` both use this and nothing else.
 *
 * Design: packages/lab/src/core/guide.tsx, "Plugins". Contract from pi
 * dev's extensions-v2 notes, runtime form from opencode v2
 * (`define({ id, effect(ctx) })`, a scope per plugin).
 */
import type { Api, JsonValue, Message, Model, Skill } from "@nyte-ai/schema";
import { schemas } from "@nyte-ai/protocol";
import type {
  CommandSelection,
  HeadName,
  RunInfo,
  RunPhase,
  Selection,
  SelectionReply,
  SettingChoice,
} from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import type { SessionEvent, Workspace } from "../kernel/sdk/types.ts";
import { Type, type TSchema } from "typebox";
import type { EnvOps, ExecutionEnv } from "../kernel/loop/env.ts";
import type { AgentTool, ToolDefinition } from "../kernel/loop/types.ts";
import type { HookHandler, HookName } from "./hooks.ts";

export type Disposer = () => void;

export type PluginReplacement =
  | { readonly kind: "applied" }
  | { readonly kind: "queued" }
  | { readonly kind: "rejected"; readonly error: string };

/**
 * `PluginSource`, `PluginInfo`, `SettingChoice`, and `SettingInfo` are what
 * clients read, so they are declared in `@nyte-ai/protocol` and re-exported.
 */
export type { PluginInfo, PluginSource, SettingChoice, SettingInfo } from "@nyte-ai/protocol";

export interface Plugin {
  readonly id: string;
  /** Opens workspaces of one kind. Only `NyteOptions.plugins` are consulted; a workspace's own plugins load after it opens. */
  readonly environment?: EnvironmentProvider;
  session(api: SessionApi): void | Promise<void>;
}

export interface EnvironmentProvider {
  /** The workspace kind this provider opens. One provider per kind. */
  readonly kind: string;
  /** The workspace is unreachable if this rejects or returns another `id` or `cwd`. */
  open(workspace: Workspace): Promise<ExecutionEnv>;
}

export type EnvironmentPlugin = Plugin & { readonly environment: EnvironmentProvider };

/** Extends an environment's operations. */
export type EnvironmentWrap = (
  inner: EnvOps,
) => EnvOps & { readonly id?: never; readonly cwd?: never };

export interface Draft<T> {
  set(id: string, value: T): void;
  update(id: string, fn: (current: T) => T): void;
  delete(id: string): void;
  has(id: string): boolean;
  get(id: string): T | undefined;
  ids(): readonly string[];
}

export interface ToolDraft extends Draft<AgentTool> {
  set<T extends TSchema, Details>(id: string, tool: AgentTool<T, Details>): void;
  /** Replace a tool's `execute` with one that can call the previous implementation. */
  wrap(id: string, wrap: (inner: AgentTool["execute"]) => AgentTool["execute"]): void;
}

/**
 * The `tools` contribution registry, plus `list`: the materialized tools after
 * the last rebuild. `tools` rebuilds before `prompt`, so the `system-prompt`
 * builtin reads the real catalog and names it in the prompt rather than
 * guessing at a fixed set.
 */
export interface ToolRegistry {
  /** One tool under `name`; the host stamps the name on it. */
  add<T extends TSchema, Details>(name: string, tool: ToolDefinition<T, Details>): Disposer;
  /** Tools derived at rebuild time: a server's catalog, or another plugin's tool to wrap. */
  add(contribution: (tools: ToolDraft) => void): Disposer;
  list(): readonly AgentTool[];
}

/** A declared session preset. Delegated tasks choose their model and role per call instead. */
export interface Agent {
  readonly id: string;
  /** Default `all`. `subagent` presets are omitted from the user's picker. */
  readonly mode?: "primary" | "subagent" | "all";
  /** Hide from the picker without changing run rights. */
  readonly hidden?: boolean;
  /** Description shown when choosing a session preset. */
  readonly description?: string;
  /** Model pin for a session using this preset. */
  readonly model?: Pick<Model<Api>, "provider" | "id">;
  /** Persona layered onto the base system prompt, never replacing it. */
  readonly system?: string;
  /**
   * The tools this agent may call, by name. Omitted, it calls every tool the
   * session has. A name the session lacks is skipped, not an error, so a
   * read-only agent declared once works in a host that lacks some of its tools.
   */
  readonly tools?: readonly string[];
  /** A step-count ceiling, not a wall-clock budget. */
  readonly steps?: number;
  readonly disabled?: boolean;
}

/**
 * The `agents` contribution registry, plus `list`: the materialized agents
 * after the last rebuild, so a plugin that projects agents into a tool reads
 * them while contributing it.
 */
export interface AgentRegistry {
  /** One preset under `name`; the host stamps the id on it. */
  add(name: string, agent: Omit<Agent, "id">): Disposer;
  add(contribution: (agents: Draft<Agent>) => void): Disposer;
  list(): readonly Agent[];
}

/** Session-local limits for an exact `provider/model` catalog reference. */
export interface ModelContextPolicy {
  readonly contextWindow: number;
  /** Start automatic compaction at this token count, independently of summary output reserves. */
  readonly compactAt: number;
}

/**
 * One named section of the system prompt. The branch declares each section
 * under `<order>-<id>` and the model is told when one changes, so keep each
 * section self-delimiting (a heading, a tag).
 */
export interface PromptSection {
  readonly text: string;
  /** Lower renders first; equal orders render by id. Integer 0 to 9999, default 100. */
  readonly order?: number;
}

/** Text is shown to the user; a `prompt` is sent as the user's next message. */
export type CommandResult = string | CommandPrompt | undefined;

export interface CommandPrompt {
  readonly prompt: string;
}

const CommandPromptSchema = Type.Object({ prompt: Type.String() });

export function isCommandPrompt(result: NonNullable<CommandResult>): result is CommandPrompt {
  return Value.Check(CommandPromptSchema, result);
}

export interface Command {
  readonly description: string;
  readonly selection?: CommandSelection;
  /**
   * Runs on the host that owns the command, at once: a command never waits in
   * the composer. `signal` aborts when the host's budget for the call runs out.
   */
  run(argument: string, signal: AbortSignal): Promise<CommandResult> | CommandResult;
}

/** A `SettingChoice` whose id the compiler keeps, so a setting's handle is typed by its choices. */
type ChoiceOf<Id extends string> = Omit<SettingChoice, "id"> & { readonly id: Id };

/**
 * A session policy a plugin declares to clients: a label and the choices it
 * can take. The host resolves the current choice and performs the write, so
 * listing settings is one storage scan and applying one is a fact append any
 * host can make. Clients render settings generically; nothing about a
 * specific plugin leaks into them.
 */
export interface SettingDefinition<Id extends string = string> {
  readonly label: string;
  /** Non-empty by construction: a setting always has something to select. */
  readonly choices: readonly [ChoiceOf<Id>, ...ChoiceOf<Id>[]];
  /** Choice used when storage holds nothing or a choice that no longer exists. */
  readonly default: NoInfer<Id>;
}

/** A setting as the registry holds it: its definition and the storage key behind it. */
export interface PluginSetting extends SettingDefinition {
  /** Key under this plugin's storage prefix holding the current choice id. */
  readonly key: string;
}

/** The current choice of one setting, typed by its choice ids. */
export interface Setting<Id extends string> {
  get(): Promise<Id>;
  set(choice: Id): Promise<void>;
  /** Called with the new choice whenever any host changes it, until the plugin is deactivated. */
  subscribe(listener: (choice: Id) => void | Promise<void>): Disposer;
}

export interface SettingRegistry {
  /** One setting under `name`, stored under that key, read and written through the returned handle. */
  add<const Id extends string>(name: string, setting: SettingDefinition<Id>): Setting<Id>;
  /** Settings derived at rebuild time: one per configured server, or choices that depend on other plugins. */
  add(contribution: (settings: Draft<PluginSetting>) => void): Disposer;
}

export type ApplySettingOutcome =
  | { kind: "applied" }
  | { kind: "not_found" }
  | { kind: "invalid_choice" };

export interface Registry<T, D extends Draft<T> = Draft<T>> {
  /** One entry under `name`. */
  add(name: string, value: T): Disposer;
  /** Entries derived at rebuild time. Runs on every rebuild, in plugin order, synchronously. No I/O inside. */
  add(contribution: (draft: D) => void): Disposer;
}

export interface PluginStorage {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
}

/** Something the user should see outside the conversation; the client decides how. */
export interface Notification {
  readonly title?: string;
  readonly message: string;
  /** Ring the terminal bell, or the client's equivalent. */
  readonly sound?: boolean;
}

export interface Diagnostics {
  warn(message: string): void;
  notify(notification: Notification): void;
}

/** One word or phrase a client shows beside the model: what a plugin knows right now. */
export interface StatusItem {
  readonly text: string;
  /** Lower shows first. Default 100. */
  readonly order?: number;
}

/** A run whose phase is final. */
export type EndedRun = Omit<RunInfo, "phase"> & {
  readonly phase: Extract<RunPhase, { kind: "done" | "aborted" | "failed" }>;
};

/**
 * What the host reads off the event stream for plugins: a run that stopped,
 * a call that parked asking a participant for a reply. Each is delivered once
 * per occurrence this activation has seen; a host that restarts starts over.
 */
export type SessionTransition =
  | { readonly kind: "run_ended"; readonly head: HeadName; readonly run: EndedRun }
  | {
      readonly kind: "awaiting_reply";
      readonly runId: string;
      readonly callId: string;
      readonly waitId: string;
      readonly tool: string;
      readonly args: JsonValue;
      readonly selection: Selection;
      readonly until?: number;
    };

export type TransitionName = SessionTransition["kind"];

export type Transition<TName extends TransitionName> = Extract<SessionTransition, { kind: TName }>;

/**
 * The session's own event stream, the same one a client folds. Observation
 * only: nothing returned is read, but a returned promise is awaited under the
 * host's budget so its rejection is reported rather than unhandled. Only what
 * happens after subscribing arrives.
 */
export interface PluginEvents {
  /** One kind of transition, derived and deduplicated by the host. */
  subscribe<TName extends TransitionName>(
    name: TName,
    listener: (transition: Transition<TName>) => void | Promise<void>,
  ): Disposer;
  /** Every projected event. */
  subscribe(listener: (event: SessionEvent) => void | Promise<void>): Disposer;
}

export interface SessionApi {
  /** Where this session acts: its provider's environment through the wraps of the last rebuild. */
  readonly env: ExecutionEnv;
  /** Wrap the environment's operations for this session's tools and plugins, from the next rebuild. */
  wrapEnv(wrap: EnvironmentWrap): Disposer;

  // 1. contribute
  readonly tools: ToolRegistry;
  readonly commands: Registry<Command>;
  readonly prompt: Registry<PromptSection>;
  readonly resources: Registry<Skill>;
  readonly settings: SettingRegistry;
  readonly agents: AgentRegistry;
  readonly status: Registry<StatusItem>;
  readonly modelContext: Registry<ModelContextPolicy>;
  /**
   * Replay every registry's contributions and swap the results in, once this
   * session's active tool cycles and callbacks finish. What a plugin calls
   * after something it derives contributions from has changed.
   */
  refresh(): void;

  // 2. hook: intercept a live operation and return a typed result
  hook<TName extends HookName>(name: TName, handler: HookHandler<TName>): Disposer;

  // 3. observe and act on the session the plugin is bound to
  readonly events: PluginEvents;
  readonly session: PluginSession;

  readonly storage: PluginStorage;
  readonly diagnostics: Diagnostics;
  /** Aborts when the plugin is deactivated: a reload, a removal, or the session closing. */
  readonly signal: AbortSignal;
  /** Queue a synchronous resource change until this session's active tool cycles and callbacks finish. */
  defer(action: () => void): void;
}

/** Reads and writes on the session itself, as opposed to the plugin's own storage. */
export interface PluginSession {
  /** The name, if any, and whether this session is a child another session spawned. */
  info(): Promise<{ readonly id?: string; readonly name?: string; readonly child: boolean }>;
  rename(name: string): Promise<void>;
  /** The main branch as the model would see it next: the prompt and the messages. */
  context(): Promise<PluginContext>;
}

export interface PluginContext {
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/** A wake handler's `reply` as a client sends it for a `Selection`, or nothing if it is some other shape. */
export function selectionReply(reply: JsonValue): SelectionReply | undefined {
  return Value.Check(schemas.SelectionReply, reply) ? reply : undefined;
}
