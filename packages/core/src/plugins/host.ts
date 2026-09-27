/**
 * The plugin host owns one map: plugin id to live scope. `activate(list)` is
 * the only mutation; reload, add, remove, and option changes are all
 * `activate` with a different list. Plugins whose (id, version) did not change
 * are left alone. A changed plugin is loaded beside its previous version and
 * only then replaces it, so its hooks never lapse; a plugin whose factory
 * throws or outlives its budget is recorded as failed and the previous
 * version, if any, stays.
 *
 * Modeled on opencode v2 `Plugin.activate` (packages/core/src/plugin.ts).
 */
import type { Skill } from "@nyte-ai/schema";
import { Result } from "../kernel/result.ts";
import type { AgentTool } from "../kernel/loop/types.ts";
import { bindSessionApi, type PluginSessionStorage } from "./api.ts";
import type { Hooks } from "./hooks.ts";
import { ContributionRegistry, MapDraft, ToolMapDraft } from "./registry.ts";
import { PluginScope, withBudget } from "./scope.ts";
import { ModelContextDraft } from "./model-context.ts";
import type {
  Agent,
  Command,
  Disposer,
  LoadedPlugin,
  ModelContextPolicy,
  Notification,
  PluginEnv,
  PluginEvents,
  PluginInfo,
  PluginSetting,
  PromptSection,
  StatusItem,
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

/** What the host needs from one session activation. */
export interface PluginHostTarget {
  readonly hooks: Hooks;
  readonly registries: PluginRegistries;
  readonly session: PluginSessionStorage;
  readonly events: PluginEvents;
  readonly env: PluginEnv;
  subscribe(listener: (event: PluginNotice) => void | Promise<void>): Disposer;
  /** Replay every registry; a contribution that throws is reported as a diagnostic. */
  rebuildAll(): void;
  emit(event: PluginNotice): Promise<void>;
}

export type PluginHostApiTarget = Omit<PluginHostTarget, "subscribe">;

interface ActivePlugin {
  plugin: LoadedPlugin;
  scope: PluginScope;
}

export class PluginHost {
  private readonly target: PluginHostTarget;
  private readonly active = new Map<string, ActivePlugin>();
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

  activate(next: readonly LoadedPlugin[]): Promise<readonly PluginInfo[]> {
    const run = this.tail.then(() => this.activateNow(next));
    this.tail = run.catch(() => undefined);

    return run;
  }

  async close(): Promise<void> {
    await this.activate([]);
    this.closed = true;
  }

  private async activateNow(next: readonly LoadedPlugin[]): Promise<readonly PluginInfo[]> {
    if (this.closed) throw new Error("plugin host is closed");
    assertUniqueIds(next);
    const nextIds = new Set(next.map((plugin) => plugin.id));
    const info: PluginInfo[] = [];
    let changed = false;

    for (const [index, plugin] of next.entries()) {
      const previous = this.active.get(plugin.id);

      if (previous !== undefined && previous.plugin.version === plugin.version) {
        info.push(activeInfo(plugin));
        continue;
      }

      changed = true;
      const loaded = await this.load(plugin, index);

      if (!loaded.ok) {
        info.push({ ...activeInfo(plugin), status: "failed", error: loaded.error });
        continue;
      }

      this.active.set(plugin.id, loaded.value);
      info.push(activeInfo(plugin));
      await previous?.scope.dispose();
    }

    for (const [id, entry] of [...this.active].reverse()) {
      if (nextIds.has(id)) continue;
      changed = true;
      this.active.delete(id);
      await entry.scope.dispose();
    }

    if (changed) this.target.rebuildAll();
    this.inventory = info;

    if (changed) await this.target.emit({ kind: "plugins_changed", plugins: info });

    return info;
  }

  private async load(plugin: LoadedPlugin, order: number): Promise<Result<ActivePlugin, string>> {
    const scope = new PluginScope(plugin.id, (error) => {
      void this.target.emit({
        kind: "diagnostic",
        owner: `plugin ${plugin.id}`,
        level: "error",
        message: error.message,
      });
    });

    const api = bindSessionApi(this.target, plugin, scope, order);

    try {
      await withBudget({ what: `plugin ${plugin.id} session()`, ms: this.budgetMs }, () =>
        plugin.module.session(api),
      );

      return Result.ok({ plugin, scope });
    } catch (error) {
      await scope.dispose();

      return Result.err(error instanceof Error ? error.message : String(error));
    }
  }
}

function activeInfo(plugin: LoadedPlugin): Extract<PluginInfo, { status: "active" }> {
  const { id, version, source, path } = plugin;

  return path === undefined
    ? { id, version, source, status: "active" }
    : { id, version, source, path, status: "active" };
}

function assertUniqueIds(plugins: readonly LoadedPlugin[]): void {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (seen.has(plugin.id)) throw new Error(`duplicate plugin id: ${plugin.id}`);
    seen.add(plugin.id);
  }
}
