/**
 * Binds one plugin to one activation. Every registration goes through the
 * plugin's scope, so disposing the scope removes the plugin completely.
 */
import type { JsonValue } from "@nyte-ai/schema";
import type { AgentTool } from "../kernel/loop/types.ts";
import type { HookHandler, HookName } from "./hooks.ts";
import type { PluginHostApiTarget } from "./host.ts";
import type { ContributionRegistry, MapDraft, ToolMapDraft } from "./registry.ts";
import type { PluginScope } from "./scope.ts";
import { pluginFactKey } from "./storage.ts";
import type {
  Agent,
  AgentRegistry,
  Disposer,
  Draft,
  LoadedPlugin,
  PluginSession,
  Registry,
  SessionApi,
  ToolRegistry,
} from "./types.ts";

/** The session operations exposed to plugins, plus host-only fact access. */
export interface PluginSessionStorage extends PluginSession {
  getFact(fact: string): Promise<JsonValue | undefined>;
  setFact(fact: string, value: JsonValue | undefined): Promise<void>;
}

export function bindSessionApi(
  target: PluginHostApiTarget,
  plugin: LoadedPlugin,
  scope: PluginScope,
  order: number,
): SessionApi {
  const registry = <T, D extends Draft<T>>(inner: ContributionRegistry<T, D>): Registry<D> => ({
    add: (contribution) => scope.track(inner.add(plugin.id, order, contribution)),
    rebuild: () => {
      const diff = inner.rebuild();
      target.rebuildAll();
      return diff;
    },
  });

  const agentRegistry = (inner: ContributionRegistry<Agent, MapDraft<Agent>>): AgentRegistry => ({
    ...registry(inner),
    list: () => inner.values(),
  });

  const toolRegistry = (inner: ContributionRegistry<AgentTool, ToolMapDraft>): ToolRegistry => ({
    ...registry(inner),
    list: () => inner.values(),
  });

  return {
    env: target.env,

    tools: toolRegistry(target.registries.tools),
    commands: registry(target.registries.commands),
    prompt: registry(target.registries.prompt),
    resources: registry(target.registries.resources),
    settings: registry(target.registries.settings),
    agents: agentRegistry(target.registries.agents),
    status: registry(target.registries.status),
    modelContext: registry(target.registries.modelContext),

    hook<TName extends HookName>(name: TName, handler: HookHandler<TName>): Disposer {
      return scope.track(target.hooks.on(name, handler, { id: plugin.id }));
    },

    events: { subscribe: (listener) => scope.track(target.events.subscribe(listener)) },
    session: {
      info: () => target.session.info(),
      rename: (name) => target.session.rename(name),
      context: () => target.session.context(),
    },
    storage: {
      get: (key) => target.session.getFact(pluginFactKey(plugin.id, key)),
      set: (key, value) => target.session.setFact(pluginFactKey(plugin.id, key), value),
    },
    diagnostics: {
      warn: (message) => {
        void target.emit({ kind: "diagnostic", owner: plugin.id, level: "warn", message });
      },
      notify: (notification) => {
        void target.emit({ kind: "notification", owner: plugin.id, ...notification });
      },
    },
    signal: scope.signal,
  };
}
