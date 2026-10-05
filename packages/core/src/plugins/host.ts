import type { Skill } from "@nyte-ai/schema";
import type { ExecutionEnv } from "../kernel/loop/env.ts";
import type { AgentTool } from "../kernel/loop/types.ts";
import { bindSessionApi, type PluginSessionStorage } from "./api.ts";
import type { Hooks } from "./hooks.ts";
import { ContributionRegistry, MapDraft, ToolMapDraft, type RegistryDiff } from "./registry.ts";
import { PluginScope, withBudget } from "./scope.ts";
import { ModelContextDraft } from "./model-context.ts";
import { pluginSource, type PluginSourceInfo } from "./source.ts";
import type { SessionEvent } from "../kernel/sdk/types.ts";
import type {
  Agent,
  Command,
  Disposer,
  EnvironmentWrap,
  Plugin,
  ModelContextPolicy,
  Notification,
  PluginInfo,
  PluginSetting,
  PromptSection,
  SessionTransition,
  StatusItem,
  PluginReplacement,
} from "./types.ts";

export interface PluginRegistries {
  readonly agents: ContributionRegistry<Agent, MapDraft<Agent>>;
  readonly tools: ContributionRegistry<AgentTool, ToolMapDraft>;
  readonly commands: ContributionRegistry<Command, MapDraft<Command>>;
  readonly prompt: ContributionRegistry<PromptSection, MapDraft<PromptSection>>;
  readonly resources: ContributionRegistry<Skill, MapDraft<Skill>>;
  readonly settings: ContributionRegistry<PluginSetting, MapDraft<PluginSetting>>;
  readonly status: ContributionRegistry<StatusItem, MapDraft<StatusItem>>;
  readonly modelContext: ContributionRegistry<ModelContextPolicy, ModelContextDraft>;
  readonly environmentWraps: ContributionRegistry<EnvironmentWrap, MapDraft<EnvironmentWrap>>;
}

export function createRegistries(): PluginRegistries {
  // Binding must not make an unchanged contribution appear changed on every rebuild.
  const toolBindings = new WeakMap<object, AgentTool>();

  return {
    agents: new ContributionRegistry(() => new MapDraft<Agent>()),
    tools: new ContributionRegistry(() => new ToolMapDraft(toolBindings)),
    commands: new ContributionRegistry(() => new MapDraft<Command>()),
    prompt: new ContributionRegistry(() => new MapDraft<PromptSection>()),
    resources: new ContributionRegistry(() => new MapDraft<Skill>()),
    settings: new ContributionRegistry(() => new MapDraft<PluginSetting>()),
    status: new ContributionRegistry(() => new MapDraft<StatusItem>()),
    modelContext: new ContributionRegistry(() => new ModelContextDraft()),
    environmentWraps: new ContributionRegistry(() => new MapDraft<EnvironmentWrap>()),
  };
}

/** Process-local notices emitted by plugin activation and diagnostics. */
export type PluginNotice =
  | {
      readonly kind: "diagnostic";
      readonly owner: string;
      readonly level: "warn" | "error";
      readonly message: string;
    }
  | { readonly kind: "plugins_changed"; readonly plugins: readonly PluginInfo[] }
  | ({ readonly kind: "notification"; readonly owner: string } & Notification)
  | { readonly kind: "status_changed"; readonly items: readonly string[] };

/** The session's event stream and the transitions the host derives from it, for plugin listeners. */
export interface PluginEventSource {
  subscribe(listener: (event: SessionEvent) => void | Promise<void>): Disposer;
  transitions(listener: (transition: SessionTransition) => void | Promise<void>): Disposer;
}

/** What the host needs from one session activation. */
export interface PluginHostTarget {
  readonly hooks: Hooks;
  readonly registries: PluginRegistries;
  readonly session: PluginSessionStorage;
  readonly events: PluginEventSource;
  readonly env: ExecutionEnv;
  subscribe(listener: (event: PluginNotice) => void | Promise<void>): Disposer;
  /** Replay every registry; a contribution that throws is reported as a diagnostic. */
  rebuildAll(): void;
  publish(commit: () => void): boolean;
  defer(action: () => void): void;
  emit(event: PluginNotice): Promise<void>;
}

export type PluginHostApiTarget = Omit<PluginHostTarget, "subscribe"> & {
  readonly staging: boolean;
  report(cause: unknown): void;
};

export type PreparedPluginReplacement =
  | { readonly kind: "ready"; publish(): PluginReplacement; cancel(): void }
  | Extract<PluginReplacement, { kind: "rejected" }>;

interface ActivePlugin {
  plugin: RuntimePlugin;
  scope: PluginScope;
}

interface RuntimePlugin extends PluginSourceInfo {
  readonly id: string;
  readonly module: Plugin;
  readonly revision: Plugin | string;
}

interface FailedPlugin {
  readonly revision: Plugin | string;
  readonly error: string;
}

export class PluginHost {
  private readonly target: PluginHostTarget;
  private readonly active = new Map<string, ActivePlugin>();
  /** Plugins whose `session()` failed, kept by revision so a reload retries only a changed one. */
  private failed = new Map<string, FailedPlugin>();
  private inventory: PluginInfo[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly budgetMs: number;

  constructor(target: PluginHostTarget, budgetMs = 5_000) {
    this.target = target;
    this.budgetMs = budgetMs;
  }

  list(): readonly PluginInfo[] {
    return this.inventory;
  }

  async activate(next: readonly Plugin[], applied?: () => void): Promise<PluginReplacement> {
    const prepared = await this.prepare(next, applied);
    return prepared.kind === "rejected" ? prepared : prepared.publish();
  }

  prepare(next: readonly Plugin[], applied?: () => void): Promise<PreparedPluginReplacement> {
    const prepared = next.map((plugin): RuntimePlugin => {
      const source = pluginSource(plugin);
      return {
        ...(source ?? { source: "inline", version: "inline" }),
        id: plugin.id,
        module: plugin,
        revision: source?.version ?? plugin,
      };
    });
    const run = this.tail.then(() => this.prepareNow(prepared, applied));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private pending: (() => void) | undefined;
  private readonly retiring = new Map<PluginScope, Promise<void>>();

  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.active.values()) entry.scope.controller.abort();
    for (const scope of this.retiring.keys()) scope.controller.abort();
    await this.tail;
    this.pending?.();
    this.pending = undefined;
    for (const entry of this.active.values()) this.retire(entry.scope);
    this.active.clear();
    this.inventory = [];
    await Promise.all(this.retiring.values());
  }

  private retire(scope: PluginScope): void {
    if (this.retiring.has(scope)) return;
    const done = scope.dispose();
    this.retiring.set(scope, done);
    void done.finally(() => this.retiring.delete(scope));
  }

  private async prepareNow(
    next: readonly RuntimePlugin[],
    applied?: () => void,
  ): Promise<PreparedPluginReplacement> {
    if (this.closed) throw new Error("plugin host is closed");
    const duplicate = duplicateId(next);
    if (duplicate !== undefined)
      return { kind: "rejected", error: `duplicate plugin id: ${duplicate}` };
    this.pending?.();
    this.pending = undefined;
    const settled = (plugin: RuntimePlugin): boolean =>
      this.active.get(plugin.id)?.plugin.revision === plugin.revision ||
      this.failed.get(plugin.id)?.revision === plugin.revision;
    if (
      this.active.size + this.failed.size === next.length &&
      next.length === this.inventory.length &&
      next.every((plugin, index) => this.inventory[index]?.id === plugin.id && settled(plugin))
    ) {
      return {
        kind: "ready",
        cancel: () => undefined,
        publish: () => {
          applied?.();
          return { kind: "applied" };
        },
      };
    }
    const excluded = new Set(
      this.active
        .entries()
        .filter(
          ([id, previous]) =>
            !next.some(
              (plugin) => plugin.id === id && plugin.revision === previous.plugin.revision,
            ),
        )
        .map(([id]) => id),
    );
    const orderByOwner = new Map(next.map((plugin, index) => [plugin.id, index]));
    const stages = {
      agents: this.target.registries.agents.stage(excluded, orderByOwner),
      tools: this.target.registries.tools.stage(excluded, orderByOwner),
      commands: this.target.registries.commands.stage(excluded, orderByOwner),
      prompt: this.target.registries.prompt.stage(excluded, orderByOwner),
      resources: this.target.registries.resources.stage(excluded, orderByOwner),
      settings: this.target.registries.settings.stage(excluded, orderByOwner),
      status: this.target.registries.status.stage(excluded, orderByOwner),
      modelContext: this.target.registries.modelContext.stage(excluded, orderByOwner),
      environmentWraps: this.target.registries.environmentWraps.stage(excluded, orderByOwner),
    };
    const registries: PluginRegistries = {
      agents: stages.agents.registry,
      tools: stages.tools.registry,
      commands: stages.commands.registry,
      prompt: stages.prompt.registry,
      resources: stages.resources.registry,
      settings: stages.settings.registry,
      status: stages.status.registry,
      modelContext: stages.modelContext.registry,
      environmentWraps: stages.environmentWraps.registry,
    };
    const candidates = new Map<string, ActivePlugin>();
    const failures = new Map<string, FailedPlugin>();
    let staging = true;
    const report = (cause: unknown): void => {
      void this.target.emit({
        kind: "diagnostic",
        owner: "plugins",
        level: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    };
    const materialize = (): RegistryDiff["errors"] => {
      const failures: RegistryDiff["errors"][number][] = [];
      for (const stage of Object.values(stages)) {
        stage.refresh();
        stage.preview();
      }
      try {
        for (const registry of Object.values(registries))
          failures.push(...registry.rebuild().errors);
      } finally {
        for (const stage of Object.values(stages)) stage.stopPreview();
      }
      return failures;
    };
    const validate = (): void => {
      const errors = materialize();
      if (errors.length)
        throw new Error(errors.map((failure) => `${failure.owner}: ${failure.message}`).join("; "));
    };
    const liveTarget = this.target;
    const apiTarget: PluginHostApiTarget = {
      ...this.target,
      get registries() {
        return staging ? registries : liveTarget.registries;
      },
      get staging() {
        return staging;
      },
      rebuildAll: () => {
        if (staging) materialize();
        else this.target.rebuildAll();
      },
      report,
    };
    try {
      for (const [order, plugin] of next.entries()) {
        const previous = this.active.get(plugin.id);
        if (previous?.plugin.revision === plugin.revision) continue;
        const known = this.failed.get(plugin.id);
        if (known?.revision === plugin.revision) {
          failures.set(plugin.id, known);
          continue;
        }
        const scope = new PluginScope(plugin.id, (cause) => {
          void this.target.emit({
            kind: "diagnostic",
            owner: plugin.id,
            level: "error",
            message: cause.message,
          });
        });
        const api = bindSessionApi(apiTarget, plugin.module, scope, order);
        try {
          await withBudget({ what: `session()`, ms: this.budgetMs }, () =>
            plugin.module.session(api),
          );
          candidates.set(plugin.id, { plugin, scope });
        } catch (cause) {
          // One plugin's failure is its own: its scope goes, the rest of the set loads.
          this.retire(scope);
          const error = cause instanceof Error ? cause.message : String(cause);
          failures.set(plugin.id, { revision: plugin.revision, error });
          report(new Error(`${plugin.id}: ${error}`));
        }
      }
      validate();
    } catch (cause) {
      for (const candidate of candidates.values()) this.retire(candidate.scope);
      const error = cause instanceof Error ? cause.message : String(cause);
      report(cause);
      if (this.active.size === 0 && this.inventory.length === 0)
        this.inventory = next.map((plugin) => ({ ...activeInfo(plugin), status: "failed", error }));
      return { kind: "rejected", error };
    }
    if (this.closed) {
      for (const candidate of candidates.values()) this.retire(candidate.scope);
      return { kind: "rejected", error: "plugin host is closed" };
    }
    let cancelled = false;
    const cancel = (): void => {
      cancelled = true;
      for (const candidate of candidates.values()) this.retire(candidate.scope);
    };
    const commit = (): void => {
      if (cancelled) return;
      this.pending = undefined;
      try {
        validate();
      } catch (cause) {
        cancel();
        report(cause);
        void this.target.emit({ kind: "plugins_changed", plugins: this.inventory });
        return;
      }
      const old = [...this.active].filter(([id]) => excluded.has(id));
      for (const [id] of old) this.active.delete(id);
      for (const stage of Object.values(stages)) stage.commit();
      staging = false;
      for (const [, entry] of old) this.retire(entry.scope);
      for (const [id, candidate] of candidates) {
        this.active.set(id, candidate);
        candidate.scope.publish();
      }
      this.failed = failures;
      this.inventory = next.map((plugin) => {
        const failure = failures.get(plugin.id);
        return failure === undefined
          ? activeInfo(plugin)
          : { ...activeInfo(plugin), status: "failed", error: failure.error };
      });
      applied?.();
      void this.target.emit({ kind: "plugins_changed", plugins: this.inventory });
    };
    this.pending = cancel;
    return {
      kind: "ready",
      cancel,
      publish: () => {
        if (cancelled || this.closed)
          return { kind: "rejected", error: "plugin replacement was cancelled" };
        const published = this.target.publish(commit);
        if (cancelled) return { kind: "rejected", error: "plugin materialization failed" };
        return { kind: published ? "applied" : "queued" };
      },
    };
  }
}

function activeInfo(plugin: RuntimePlugin): Extract<PluginInfo, { status: "active" }> {
  const { id, version, source, path } = plugin;

  return path === undefined
    ? { id, version, source, status: "active" }
    : { id, version, source, path, status: "active" };
}

function duplicateId(plugins: readonly RuntimePlugin[]): string | undefined {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (seen.has(plugin.id)) return plugin.id;
    seen.add(plugin.id);
  }
  return undefined;
}
