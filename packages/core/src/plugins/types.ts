/**
 * The plugin contract: what a plugin module exports and what the host
 * hands its `session` factory. Built-ins under `./builtin` and files under
 * `.nyte/plugins` both use this and nothing else.
 *
 * Design: packages/docs/content/docs/design.mdx, "Plugins". Contract from pi
 * dev's extensions-v2 notes, runtime form from opencode v2
 * (`define({ id, effect(ctx) })`, a scope per plugin).
 */
import type { JsonValue, Message, Skill } from "@nyte-ai/schema";
import type { PluginSource, SettingChoice } from "@nyte-ai/protocol";
import type { SessionEvent } from "../kernel/sdk/types.ts";
import type { AgentTool } from "../types.ts";
import type { HookHandler, HookName } from "./hooks.ts";

export type Disposer = () => void;

/**
 * `PluginSource`, `PluginInfo`, `SettingChoice`, and `SettingInfo` are what
 * clients read, so they are declared in `@nyte-ai/protocol` and re-exported.
 */
export type { PluginInfo, PluginSource, SettingChoice, SettingInfo } from "@nyte-ai/protocol";

export interface Plugin {
  readonly id: string;
  session(api: SessionApi): void | Promise<void>;
}

/** A plugin the host can activate: the module plus the identity that decides reloads. */
export interface LoadedPlugin {
  readonly id: string;
  /** Changed bytes give a new version; the host reloads a plugin only when its version changes. */
  readonly version: string;
  readonly source: PluginSource;
  readonly module: Plugin;
  readonly path?: string;
}

export interface Draft<T> {
  set(id: string, value: T): void;
  update(id: string, fn: (current: T) => T): void;
  delete(id: string): void;
  has(id: string): boolean;
  get(id: string): T | undefined;
  ids(): readonly string[];
}

export interface ToolDraft extends Draft<AgentTool> {
  /** Replace a tool's `execute` with one that can call the previous implementation. */
  wrap(id: string, wrap: (inner: AgentTool["execute"]) => AgentTool["execute"]): void;
}

/**
 * The `tools` contribution registry, plus `list`: the materialized tools after
 * the last rebuild. `tools` rebuilds before `prompt`, so the `system-prompt`
 * builtin reads the real catalog and names it in the prompt rather than
 * guessing at a fixed set.
 */
export interface ToolRegistry extends Registry<ToolDraft> {
  list(): readonly AgentTool[];
}

/**
 * A declared agent: one record that describes the agent a user talks to, a
 * delegate a parent invokes, or a hidden utility turn. There is no separate
 * subagent type; `mode` is subtractive over a default of `all`. Argued in
 * design.mdx, "Agents".
 */
export interface Agent {
  readonly id: string;
  /** Default `all`. `primary` withholds from parents; `subagent` from the user's picker. */
  readonly mode?: "primary" | "subagent" | "all";
  /** Hide from both the picker and the delegate list without changing run rights. */
  readonly hidden?: boolean;
  /** What a parent reads to decide whether to delegate. */
  readonly description?: string;
  /** A `provider/model` ref the catalog resolves; omitted inherits the run's fallback model. */
  readonly model?: string;
  /** Persona layered onto the base system prompt, never replacing it. */
  readonly system?: string;
  /**
   * The tools this agent may call, by name. Omitted, it calls every tool the
   * session has. A name the session lacks is skipped, not an error, so a
   * read-only agent declared once works in a host that lacks some of its tools.
   */
  readonly tools?: readonly string[];
  /** A step-count ceiling, not a wall-clock budget (design.mdx invariant 23). */
  readonly steps?: number;
  readonly disabled?: boolean;
}

/**
 * The `agents` contribution registry. Like every registry a plugin `add`s to
 * and `rebuild`s, plus `list`: the materialized agents after the last rebuild,
 * so a plugin that projects agents into a tool reads them while contributing it.
 */
export interface AgentRegistry extends Registry<Draft<Agent>> {
  list(): readonly Agent[];
}

export interface PromptSection {
  readonly text: string;
  /** Lower renders first. Default 100. */
  readonly order?: number;
}

/** Text is shown to the user; a `prompt` is sent as the user's next message. */
export type CommandResult = string | CommandPrompt | undefined;

export interface CommandPrompt {
  readonly prompt: string;
}

export function isCommandPrompt(result: NonNullable<CommandResult>): result is CommandPrompt {
  return typeof result !== "string";
}

export interface Command {
  readonly description: string;
  /** Runs on the host that owns the command, at once: a command never waits in the composer. */
  run(argument: string): Promise<CommandResult> | CommandResult;
}

/**
 * A session policy a plugin declares to clients: a label, the choices it can
 * take, and the storage key holding the current one. The host resolves the
 * value and performs the write, so listing settings is one storage scan and
 * applying one is a fact append any host can make. Clients render settings
 * generically; nothing about a specific plugin leaks into them.
 */
export interface PluginSetting {
  readonly label: string;
  /** Non-empty by construction: a setting always has something to select. */
  readonly choices: readonly [SettingChoice, ...SettingChoice[]];
  /** Key under this plugin's storage prefix holding the current choice id. */
  readonly key: string;
  /** Choice used when storage holds nothing or a choice that no longer exists. Defaults to the first. */
  readonly fallback?: string;
}

export type ApplySettingOutcome =
  | { kind: "applied" }
  | { kind: "not_found" }
  | { kind: "invalid_choice" };

export interface RegistryDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly errors: readonly { owner: string; message: string }[];
}

export interface Registry<D> {
  /** Register a synchronous contribution. It runs on every rebuild, in plugin order. No I/O inside. */
  add(contribution: (draft: D) => void): Disposer;
  /** Replay every contribution over a fresh draft and swap the result in. */
  rebuild(): RegistryDiff;
}

export interface PluginStorage {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
}

export interface PluginEnv {
  readonly cwd: string;
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

/** The session's own event stream, the same one a client folds. Observation only: nothing returned is read. */
export interface PluginEvents {
  subscribe(listener: (event: SessionEvent) => void): Disposer;
}

export interface SessionApi {
  readonly env: PluginEnv;

  // 1. contribute
  readonly tools: ToolRegistry;
  readonly commands: Registry<Draft<Command>>;
  readonly prompt: Registry<Draft<PromptSection>>;
  readonly resources: Registry<Draft<Skill>>;
  readonly settings: Registry<Draft<PluginSetting>>;
  readonly agents: AgentRegistry;
  readonly status: Registry<Draft<StatusItem>>;

  // 2. hook: intercept a live operation and return a typed result
  hook<TName extends HookName>(name: TName, handler: HookHandler<TName>): Disposer;

  // 3. observe and act on the session the plugin is bound to
  readonly events: PluginEvents;
  readonly session: PluginSession;

  readonly storage: PluginStorage;
  readonly diagnostics: Diagnostics;
}

/** Reads and writes on the session itself, as opposed to the plugin's own storage. */
export interface PluginSession {
  /** The name, if any, and whether this session is a child another session spawned. */
  info(): Promise<{ readonly name?: string; readonly child: boolean }>;
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

/** Wrap a plugin object as a loaded plugin without a loader. */
export function inlinePlugin(plugin: Plugin, options: { version?: string } = {}): LoadedPlugin {
  return { id: plugin.id, version: options.version ?? "inline", source: "inline", module: plugin };
}
