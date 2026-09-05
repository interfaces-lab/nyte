/**
 * The TUI's host over the SDK: one `Uji` per workspace, one active session,
 * and the synchronous caches a terminal needs (slash commands, skills, setting
 * badges, run state). Replaces the harness-rebuilding `HarnessHost`: a model
 * or thinking change is `sessions.configure`, a plugin reload is `setPlugins`,
 * a provider switch re-points the runtime the stream closures read, and a
 * session switch re-points the host. Nothing rebuilds.
 *
 * The host also holds its own `SessionStorage` handle for the active session.
 * That is deliberate and legal: the TUI is a host, and hosts read `/store`
 * (design record, import rules). The durable transcript fold rides that
 * handle; the SDK's `watch` carries the live overlays.
 */
import { join } from "node:path";
import process from "node:process";
import {
  clampThinkingLevel,
  fetchAnthropicAccountLimits,
  fetchOpenAICodexAccountLimits,
  hasApi,
  type AccountLimits,
  type Api,
  type Model,
} from "@uji-ai/ai";
import { createUji, isThinkingLevel, sessionId as parseSessionId } from "@uji-ai/core";
import type {
  AskPresenter,
  CommandInfo,
  Disposer,
  SessionEvent,
  SessionId,
  SessionInfo,
  ThinkingLevel,
  TrustedWorkspace,
  Uji,
} from "@uji-ai/core";
import type { Skill } from "@uji-ai/schema";
import { requireModel } from "./catalog.ts";
import { resolveCliPlugins, resolveRunModelId, type ResolvedRuntime } from "./run.ts";
import type { ResolvedSettings } from "./settings.ts";
import { SqliteSessionRepo, type SessionStorage } from "@uji-ai/core/store";

/** What the status line says the active session is doing, folded from `watch`. */
export type HostRunState =
  | "idle"
  | "working"
  | "compacting"
  | "navigating"
  | "retrying"
  | "resuming"
  | "running tool";

export interface UjiHostOptions {
  workspace: TrustedWorkspace;
  settings: ResolvedSettings;
  runtime: ResolvedRuntime;
  /** Composition fallbacks; a session's declared config wins per run. */
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  ask: AskPresenter;
  /**
   * Where the sessions live. Defaults to the workspace's own store; `/cd`
   * passes the launch workspace's path, because changing the tool directory
   * must not strand the conversation in another database.
   */
  storePath?: string;
  /** Plugin load failures and other host chatter, for the transcript. */
  report?: (message: string) => void;
}

export type HostResumeTarget =
  | { kind: "new" }
  | { kind: "latest" }
  | { kind: "session"; id: string };

interface UjiHostSession {
  readonly info: SessionInfo;
  /** The host's own handle; the durable transcript fold reads it. */
  readonly storage: SessionStorage;
}

/**
 * One workspace's SDK composition plus the active-session pointer. Constructed
 * by `openUjiHost`, which resolves plugins behind the workspace trust the
 * caller already holds.
 */
export class UjiHost {
  readonly sdk: Uji;
  readonly store: SqliteSessionRepo;
  readonly cwd: string;

  /** Composition fallback; `model` reports the session's effective choice. */
  fallbackModel: Model<Api>;
  fallbackThinking: ThinkingLevel;

  /** The box the stream and catalog closures read per call. */
  private readonly runtimeBox: { current: ResolvedRuntime };

  private active: UjiHostSession;
  private detach: Disposer | undefined;
  private watchStop: AbortController | undefined;
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private runState: HostRunState = "idle";
  private currentModel: Model<Api>;
  private currentThinking: ThinkingLevel;
  private commandCache: ReadonlyMap<string, CommandInfo> = new Map();
  private skillCache: ReadonlyMap<string, Skill> = new Map();
  private readonly limitsByProvider = new Map<string, AccountLimits>();
  private closed = false;

  private constructor(
    options: UjiHostOptions,
    sdk: Uji,
    store: SqliteSessionRepo,
    active: UjiHostSession,
    runtimeBox: { current: ResolvedRuntime },
  ) {
    this.sdk = sdk;
    this.store = store;
    this.cwd = options.workspace.cwd;
    this.runtimeBox = runtimeBox;
    this.fallbackModel = options.model;
    this.fallbackThinking = options.thinkingLevel;
    this.currentModel = options.model;
    this.currentThinking = options.thinkingLevel;
    this.active = active;
  }

  /** A provider switch re-points this; the next request follows. */
  get runtime(): ResolvedRuntime {
    return this.runtimeBox.current;
  }

  set runtime(next: ResolvedRuntime) {
    this.runtimeBox.current = next;
  }

  static async open(
    options: UjiHostOptions,
    target: HostResumeTarget,
  ): Promise<{ host: UjiHost; created: boolean }> {
    const store = new SqliteSessionRepo(
      options.storePath ?? join(options.workspace.cwd, ".uji", "sessions.db"),
    );
    let sdk: Uji | undefined;
    let host: UjiHost | undefined;
    try {
      const resolved = await resolveCliPlugins(options.workspace, {
        model: options.model,
        models: options.runtime.models,
      });
      for (const failure of resolved.failures) {
        options.report?.(`plugin ${failure.path}: ${failure.error}`);
      }
      // Delegating closures: a provider switch re-points `host.runtime` and the
      // next request follows, with no composition rebuild.
      const runtimeBox = { current: options.runtime };
      sdk = await createUji({
        store,
        streamFn: (model, context, streamOptions) =>
          runtimeBox.current.models.streamSimple(model, context, {
            ...streamOptions,
            onAccountLimits: (limits) => {
              host?.observeAccountLimits(limits);
            },
          }),
        models: {
          getModels: (provider) => runtimeBox.current.models.getModels(provider),
          getModel: (provider, id) => runtimeBox.current.models.getModel(provider, id),
          checkAuth: (provider) => runtimeBox.current.models.checkAuth(provider),
          getProvider: (id) => runtimeBox.current.models.getProvider(id),
        },
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        plugins: resolved.plugins,
        env: { cwd: options.workspace.cwd },
        compaction: options.settings.compaction,
        streamOptions: { transport: options.settings.transport },
        ask: options.ask,
      });
      const { info, created } = await openTarget(sdk, target);
      const storage = await store.open(info.sessionId);
      host = new UjiHost(options, sdk, store, { info, storage }, runtimeBox);
      host.detach = sdk.attach();
      await host.syncSessionConfig();
      await host.refreshContributions();
      host.startWatch();
      return { host, created };
    } catch (error) {
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  get sessionId(): SessionId {
    return this.active.info.sessionId;
  }

  get storage(): SessionStorage {
    return this.active.storage;
  }

  /** The model the next run would use: the branch's declared config, else the fallback. */
  get model(): Model<Api> {
    return this.currentModel;
  }

  get thinkingLevel(): ThinkingLevel {
    return this.currentThinking;
  }

  get state(): { runState: HostRunState; busy: boolean } {
    return { runState: this.runState, busy: this.runState !== "idle" };
  }

  /** Plugin commands, cached for synchronous autocomplete. */
  get commands(): ReadonlyMap<string, CommandInfo> {
    return this.commandCache;
  }

  /** Skills, cached for synchronous autocomplete and inline expansion. */
  get skills(): ReadonlyMap<string, Skill> {
    return this.skillCache;
  }

  /** Live `SessionEvent`s for the active session; survives session switches. */
  subscribe(listener: (event: SessionEvent) => void): Disposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Account state this process has already observed. No network. */
  cachedAccountLimits(): readonly AccountLimits[] {
    return [...this.limitsByProvider.values()];
  }

  /** Whether `/usage` has active or cached subscription headroom to refresh. */
  shouldRefreshAccountLimits(): boolean {
    return ["anthropic", "openai-codex"].some(
      (provider) => this.currentModel.provider === provider || this.limitsByProvider.has(provider),
    );
  }

  /** Refresh fetchable limits and return all account state observed by this host. */
  async accountLimits(signal?: AbortSignal): Promise<readonly AccountLimits[]> {
    const providers = new Set([this.currentModel.provider, ...this.limitsByProvider.keys()]);
    const refreshes: Promise<void>[] = [];
    if (providers.has("anthropic")) refreshes.push(this.refreshAnthropicAccountLimits(signal));
    if (providers.has("openai-codex")) refreshes.push(this.refreshOpenAICodexAccountLimits(signal));
    await Promise.all(refreshes);
    return [...this.limitsByProvider.values()];
  }

  /** Declare the session's model in the tree and adopt it for status lines. */
  async configureModel(model: Model<Api>): Promise<"applied" | "deferred"> {
    const outcome = await this.sdk.sessions.configure({
      sessionId: this.sessionId,
      model: { provider: model.provider, id: model.id },
    });
    if (outcome.kind === "unknown_model" || outcome.kind === "unknown_agent") {
      throw new Error(`Unknown model: ${model.id}`);
    }
    this.currentModel = model;
    return outcome.kind;
  }

  async configureThinking(level: ThinkingLevel): Promise<"applied" | "deferred"> {
    const outcome = await this.sdk.sessions.configure({
      sessionId: this.sessionId,
      thinkingLevel: level,
    });
    if (outcome.kind === "unknown_model" || outcome.kind === "unknown_agent") {
      throw new Error("unreachable: no model or agent in input");
    }
    this.currentThinking = level;
    return outcome.kind;
  }

  /** Re-resolve the workspace's plugins and activate every open session on them. */
  async reloadPlugins(workspace: TrustedWorkspace): Promise<void> {
    const resolved = await resolveCliPlugins(workspace, {
      model: this.currentModel,
      models: this.runtime.models,
    });
    for (const failure of resolved.failures) {
      this.report(`plugin ${failure.path}: ${failure.error}`);
    }
    await this.sdk.setPlugins(resolved.plugins);
    await this.refreshContributions();
  }

  /** Point the host at another session in this workspace. */
  async activateSession(sessionId: SessionId): Promise<SessionInfo> {
    const info = await this.sdk.sessions.get({ sessionId });
    if (info === undefined) throw new Error(`Session not found: ${sessionId}`);
    await this.swapActive(info);
    return info;
  }

  async newSession(): Promise<SessionInfo> {
    const info = await this.sdk.sessions.create();
    await this.swapActive(info);
    return info;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.watchStop?.abort();
    this.detach?.();
    await this.active.storage.close().catch(() => undefined);
    await this.sdk.close().catch(() => undefined);
    await this.store.close().catch(() => undefined);
  }

  /** Let the active session finish what it is doing, then close. For `/cd`. */
  async parkAndClose(): Promise<void> {
    await this.sdk.runs.wait({ sessionId: this.sessionId }).catch(() => undefined);
    await this.close();
  }

  private async refreshAnthropicAccountLimits(signal?: AbortSignal): Promise<void> {
    try {
      const model = this.runtime.models
        .getModels("anthropic")
        .find((candidate) => candidate.api === "anthropic-messages");
      if (model === undefined || !hasApi(model, "anthropic-messages")) return;
      const auth = await this.runtime.models.getAuth(model, { signal });
      if (auth?.auth.apiKey === undefined || !auth.auth.apiKey.includes("sk-ant-oat")) return;
      const requestModel: Model<"anthropic-messages"> = {
        ...model,
        ...(auth.auth.baseUrl === undefined ? {} : { baseUrl: auth.auth.baseUrl }),
      };
      this.observeAccountLimits(
        await fetchAnthropicAccountLimits(requestModel, {
          apiKey: auth.auth.apiKey,
          headers: auth.auth.headers,
          signal,
          timeoutMs: 10_000,
        }),
      );
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }

  private async refreshOpenAICodexAccountLimits(signal?: AbortSignal): Promise<void> {
    try {
      const model = this.runtime.models
        .getModels("openai-codex")
        .find((candidate) => candidate.api === "openai-codex-responses");
      if (model === undefined) return;
      const auth = await this.runtime.models.getAuth(model, { signal });
      if (auth?.auth.apiKey === undefined) return;
      const requestModel: Model<"openai-codex-responses"> = {
        ...model,
        api: "openai-codex-responses",
        ...(auth.auth.baseUrl === undefined ? {} : { baseUrl: auth.auth.baseUrl }),
      };
      this.observeAccountLimits(
        await fetchOpenAICodexAccountLimits(requestModel, {
          apiKey: auth.auth.apiKey,
          headers: auth.auth.headers,
          signal,
          timeoutMs: 10_000,
        }),
      );
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }

  private observeAccountLimits(limits: AccountLimits): void {
    const previous = this.limitsByProvider.get(limits.providerId);
    if (previous === undefined) {
      this.limitsByProvider.set(limits.providerId, limits);
      return;
    }
    const windows = new Map(previous.windows.map((window) => [window.id, window]));
    for (const window of limits.windows) windows.set(window.id, window);
    this.limitsByProvider.set(limits.providerId, {
      providerId: limits.providerId,
      ...(limits.plan === undefined && previous.plan === undefined
        ? {}
        : { plan: limits.plan ?? previous.plan }),
      windows: [...windows.values()],
      observedAt: Math.max(previous.observedAt, limits.observedAt),
    });
  }

  private report(message: string): void {
    for (const listener of this.listeners) {
      listener({ kind: "diagnostic", owner: "host", level: "warn", message });
    }
  }

  private async swapActive(info: SessionInfo): Promise<void> {
    const previous = this.active;
    const storage = await this.store.open(info.sessionId);
    this.active = { info, storage };
    this.runState = "idle";
    await previous.storage.close().catch(() => undefined);
    await this.syncSessionConfig();
    this.startWatch();
  }

  /** Adopt the branch's declared run inputs, falling back to the composition's. */
  private async syncSessionConfig(): Promise<void> {
    const info = await this.sdk.sessions.get({ sessionId: this.sessionId });
    const declared = info?.config.model;
    this.currentModel =
      (declared?.provider !== undefined
        ? this.runtime.models.getModel(declared.provider, declared.id)
        : undefined) ?? this.fallbackModel;
    this.currentThinking = info?.config.thinkingLevel ?? this.fallbackThinking;
  }

  private async refreshContributions(): Promise<void> {
    const sessionId = this.sessionId;
    const [commands, skills] = await Promise.all([
      this.sdk.plugins.commands.list({ sessionId }),
      this.sdk.plugins.resources.list({ sessionId }),
    ]);
    this.commandCache = new Map(commands.map((command) => [command.name, command]));
    this.skillCache = new Map(skills.map((skill) => [skill.name, skill]));
  }

  /** One live watch per active session, folded into run state and re-broadcast. */
  private startWatch(): void {
    this.watchStop?.abort();
    const stop = new AbortController();
    this.watchStop = stop;
    const sessionId = this.sessionId;
    void (async () => {
      try {
        for await (const event of this.sdk.watch({
          sessionId,
          live: true,
          signal: stop.signal,
        })) {
          if (stop.signal.aborted) return;
          this.fold(event);
          for (const listener of this.listeners) listener(event);
        }
      } catch (error) {
        if (stop.signal.aborted || this.closed) return;
        this.report(
          `session watch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }

  private fold(event: SessionEvent): void {
    switch (event.kind) {
      case "run_started":
        this.runState =
          event.operation === "compaction"
            ? "compacting"
            : event.operation === "navigation"
              ? "navigating"
              : "working";
        return;
      case "run_finished":
        this.runState = "idle";
        return;
      case "retry_scheduled":
        this.runState = "retrying";
        return;
      case "retry_started":
        this.runState = "working";
        return;
      case "compacting":
        this.runState = "compacting";
        return;
      case "plugins_changed":
        void this.refreshContributions().catch(() => undefined);
        return;
      default:
        return;
    }
  }
}

/** The session a launch targets, through SDK verbs alone. */
async function openTarget(
  sdk: Uji,
  target: HostResumeTarget,
): Promise<{ info: SessionInfo; created: boolean }> {
  switch (target.kind) {
    case "new":
      return { info: await sdk.sessions.create(), created: true };
    case "latest": {
      // Skip sessions that were created by a launch and never written to.
      const { items } = await sdk.sessions.list();
      const used = [...items].reverse().find((info) => info.heads[0]?.entryId !== null);
      if (used !== undefined) return { info: used, created: false };
      return { info: await sdk.sessions.create(), created: true };
    }
    case "session": {
      const info = await sdk.sessions.get({ sessionId: parseSessionId(target.id) });
      if (info === undefined) throw new Error(`Session not found: ${target.id}`);
      return { info, created: false };
    }
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/** Resolve the composition fallbacks a workspace launch starts from. */
export function hostFallbacks(
  runtime: ResolvedRuntime,
  settings: ResolvedSettings,
  flags: { model?: string; effort?: string },
): { model: Model<Api>; thinkingLevel: ThinkingLevel } {
  const modelId = resolveRunModelId(runtime.models, runtime.provider.id, {
    flag: flags.model,
    environment: process.env["UJI_MODEL"],
    settings,
  });
  const model = requireModel(runtime.models, runtime.provider.id, modelId);
  const requested = flags.effort ?? process.env["UJI_EFFORT"];
  const effort =
    requested !== undefined && isThinkingLevel(requested)
      ? requested
      : (settings.defaultThinkingLevel ?? "medium");
  return { model, thinkingLevel: clampThinkingLevel(model, effort) };
}
