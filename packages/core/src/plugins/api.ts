import type { JsonValue } from "@nyte-ai/schema";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AgentTool, ToolDefinition } from "../kernel/loop/types.ts";
import type { SessionEvent } from "../kernel/sdk/types.ts";
import type { HookHandler, HookName } from "./hooks.ts";
import type { PluginHostApiTarget } from "./host.ts";
import type { ContributionRegistry } from "./registry.ts";
import type { PluginScope } from "./scope.ts";
import { pluginFactKey, storedChoice } from "./storage.ts";
import type {
  Agent,
  Command,
  Disposer,
  Draft,
  Plugin,
  PluginSession,
  PluginSetting,
  Registry,
  SessionApi,
  SessionTransition,
  Setting,
  SettingDefinition,
  ToolDraft,
  Transition,
  TransitionName,
} from "./types.ts";

export interface PluginSessionStorage extends PluginSession {
  getFact(fact: string): Promise<JsonValue | undefined>;
  setFact(fact: string, value: JsonValue | undefined): Promise<void>;
}

export function bindSessionApi(
  target: PluginHostApiTarget,
  plugin: Plugin,
  scope: PluginScope,
  order: number,
): SessionApi {
  const contribute = <T, D extends Draft<T>>(
    select: () => ContributionRegistry<T, D>,
    contribution: (draft: D) => void,
  ): Disposer => {
    scope.assertOpen();
    return scope.registration(select().add(plugin.id, order, contribution));
  };
  const registry = <T, D extends Draft<T>>(
    select: () => ContributionRegistry<T, D>,
  ): Registry<T, D> => ({
    add: (...args: [name: string, value: T] | [contribution: (draft: D) => void]) => {
      if (args.length === 1) return contribute(select, args[0]);
      const [name, value] = args;
      return contribute(select, (draft) => draft.set(name, value));
    },
  });
  const mutate = (action: () => Promise<void>): Promise<void> => {
    scope.assertOpen();
    if (target.staging) throw new Error("Session mutations are unavailable during plugin setup");
    return scope.call(action);
  };
  /** Attached once the plugin is live, removed with the registration; a listener runs as a plugin call. */
  const listen = (attach: () => Disposer): Disposer => {
    let remove: Disposer = () => undefined;
    let removed = false;
    scope.onPublish(() => {
      if (!removed) remove = attach();
    });
    return scope.registration(() => {
      removed = true;
      remove();
    });
  };
  const storage = {
    get: (key: string) => {
      scope.assertOpen();
      return target.session.getFact(pluginFactKey(plugin.id, key));
    },
    set: (key: string, value: JsonValue) => {
      scope.assertOpen();
      return mutate(() => target.session.setFact(pluginFactKey(plugin.id, key), value));
    },
  };

  function subscribe(listener: (event: SessionEvent) => void | Promise<void>): Disposer;
  function subscribe<TName extends TransitionName>(
    name: TName,
    listener: (transition: Transition<TName>) => void | Promise<void>,
  ): Disposer;
  function subscribe(
    first: TransitionName | ((event: SessionEvent) => void | Promise<void>),
    second?: (transition: SessionTransition) => void | Promise<void>,
  ): Disposer {
    if (!Value.Check(Type.String(), first))
      return listen(() => target.events.subscribe((event) => scope.call(() => first(event))));
    const listener = second;
    if (listener === undefined) throw new Error(`events.subscribe("${first}") needs a listener`);
    return listen(() =>
      target.events.transitions((transition) =>
        transition.kind === first ? scope.call(() => listener(transition)) : undefined,
      ),
    );
  }

  function addTool<T extends TSchema, Details>(
    name: string,
    tool: ToolDefinition<T, Details>,
  ): Disposer;
  function addTool(contribution: (tools: ToolDraft) => void): Disposer;
  function addTool<T extends TSchema, Details>(
    ...args: [name: string, tool: ToolDefinition<T, Details>] | [(tools: ToolDraft) => void]
  ): Disposer {
    if (args.length === 1) return contribute(() => target.registries.tools, args[0]);
    const [name, definition] = args;
    // One object for the tool's whole life, so the registry binds it once and never reports it changed.
    const tool: AgentTool<T, Details> = { ...definition, name };
    return contribute(
      () => target.registries.tools,
      (tools) => tools.set(name, tool),
    );
  }

  /** A command runs as a plugin call, so disposal waits for it and its failure is reported. */
  const scoped = (command: Command): Command => ({
    ...command,
    run: (argument, signal) => scope.call(() => command.run(argument, signal)),
  });
  const commands: Registry<Command> = {
    add: (...args: [name: string, command: Command] | [(commands: Draft<Command>) => void]) => {
      if (args.length === 2) {
        const [name, command] = args;
        return contribute(
          () => target.registries.commands,
          (draft) => draft.set(name, scoped(command)),
        );
      }
      const [derive] = args;
      return contribute(
        () => target.registries.commands,
        (draft) =>
          derive({
            set: (name, command) => draft.set(name, scoped(command)),
            update: (name, update) => draft.update(name, (current) => scoped(update(current))),
            delete: (name) => draft.delete(name),
            has: (name) => draft.has(name),
            get: (name) => draft.get(name),
            ids: () => draft.ids(),
          }),
      );
    },
  };

  function addAgent(name: string, agent: Omit<Agent, "id">): Disposer;
  function addAgent(contribution: (agents: Draft<Agent>) => void): Disposer;
  function addAgent(
    ...args: [name: string, agent: Omit<Agent, "id">] | [(agents: Draft<Agent>) => void]
  ): Disposer {
    if (args.length === 1) return contribute(() => target.registries.agents, args[0]);
    const [name, definition] = args;
    const agent: Agent = { ...definition, id: name };
    return contribute(
      () => target.registries.agents,
      (agents) => agents.set(name, agent),
    );
  }

  function addSetting<const Id extends string>(
    name: string,
    setting: SettingDefinition<Id>,
  ): Setting<Id>;
  function addSetting(contribution: (settings: Draft<PluginSetting>) => void): Disposer;
  function addSetting<const Id extends string>(
    ...args:
      | [name: string, setting: SettingDefinition<Id>]
      | [(settings: Draft<PluginSetting>) => void]
  ): Setting<Id> | Disposer {
    if (args.length === 1) return contribute(() => target.registries.settings, args[0]);
    const [name, definition] = args;
    const isChoice = (value: JsonValue): boolean =>
      definition.choices.some((choice) => choice.id === value);
    if (!isChoice(definition.default))
      throw new Error(
        `Setting "${name}" defaults to "${definition.default}", which is not a choice`,
      );
    contribute(
      () => target.registries.settings,
      (settings) => settings.set(name, { ...definition, key: name }),
    );
    const fact = pluginFactKey(plugin.id, name);
    return {
      get: async () => storedChoice(definition, await storage.get(name)),
      set: async (choice) => {
        if (!isChoice(choice)) throw new Error(`Setting "${name}" has no choice "${choice}"`);
        await storage.set(name, choice);
      },
      subscribe: (listener) =>
        subscribe((event) => {
          if (event.kind !== "fact" || event.key !== fact) return undefined;
          return listener(storedChoice(definition, event.value));
        }),
    };
  }

  return {
    env: target.env,
    tools: { add: addTool, list: () => target.registries.tools.contributionValues() },
    commands,
    prompt: registry(() => target.registries.prompt),
    resources: registry(() => target.registries.resources),
    settings: { add: addSetting },
    agents: { add: addAgent, list: () => target.registries.agents.contributionValues() },
    status: registry(() => target.registries.status),
    modelContext: registry(() => target.registries.modelContext),
    refresh: () => {
      if (scope.closed) return;
      target.rebuildAll();
    },
    hook<TName extends HookName>(name: TName, handler: HookHandler<TName>): Disposer {
      return listen(() =>
        target.hooks.on(name, (event, signal) => scope.call(() => handler(event, signal)), {
          id: plugin.id,
          order,
        }),
      );
    },
    events: { subscribe },
    session: {
      info: () => {
        scope.assertOpen();
        return target.session.info();
      },
      rename: (name) => mutate(() => target.session.rename(name)),
      context: () => {
        scope.assertOpen();
        return target.session.context();
      },
    },
    storage,
    diagnostics: {
      warn: (message) => {
        if (scope.closed) return;
        scope.onPublish(() => {
          void target.emit({ kind: "diagnostic", owner: plugin.id, level: "warn", message });
        });
      },
      notify: (notification) => {
        if (scope.closed) return;
        scope.onPublish(() => {
          void target.emit({ kind: "notification", owner: plugin.id, ...notification });
        });
      },
    },
    signal: scope.signal,
    defer: (action) =>
      scope.onPublish(() => {
        const run = (): void => {
          if (scope.closed) return;
          try {
            action();
          } catch (cause) {
            target.report(cause);
          }
        };
        target.defer(run);
      }),
  };
}
