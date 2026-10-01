import type { JsonValue } from "@nyte-ai/schema";
import type { HookHandler, HookName } from "./hooks.ts";
import type { PluginHostApiTarget } from "./host.ts";
import type { ContributionRegistry } from "./registry.ts";
import type { PluginScope } from "./scope.ts";
import { pluginFactKey } from "./storage.ts";
import type {
  Disposer,
  Draft,
  LoadedPlugin,
  PluginSession,
  Registry,
  SessionApi,
} from "./types.ts";

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
  const rebuild = (): void => {
    if (scope.closed) return;
    target.rebuildAll();
  };
  const registry = <T, D extends Draft<T>>(
    select: () => ContributionRegistry<T, D>,
  ): Registry<D> => ({
    add: (contribution) => {
      scope.assertOpen();
      return scope.registration(select().add(plugin.id, order, contribution));
    },
    rebuild,
  });
  const mutate = (action: () => Promise<void>): Promise<void> => {
    scope.assertOpen();
    if (target.staging) throw new Error("Session mutations are unavailable during plugin setup");
    return scope.call(action);
  };

  return {
    env: target.env,
    tools: {
      ...registry(() => target.registries.tools),
      list: () => target.registries.tools.contributionValues(),
    },
    commands: {
      rebuild,
      add: (contribution) => {
        scope.assertOpen();
        return scope.registration(
          target.registries.commands.add(plugin.id, order, (draft) => {
            contribution({
              set: (id, command) =>
                draft.set(id, {
                  ...command,
                  run: (argument, signal) => scope.call(() => command.run(argument, signal)),
                }),
              update: (id, update) =>
                draft.update(id, (current) => {
                  const command = update(current);
                  return {
                    ...command,
                    run: (argument, signal) => scope.call(() => command.run(argument, signal)),
                  };
                }),
              delete: (id) => draft.delete(id),
              has: (id) => draft.has(id),
              get: (id) => draft.get(id),
              ids: () => draft.ids(),
            });
          }),
        );
      },
    },
    prompt: registry(() => target.registries.prompt),
    resources: registry(() => target.registries.resources),
    settings: registry(() => target.registries.settings),
    agents: {
      ...registry(() => target.registries.agents),
      list: () => target.registries.agents.contributionValues(),
    },
    status: registry(() => target.registries.status),
    modelContext: registry(() => target.registries.modelContext),
    hook<TName extends HookName>(name: TName, handler: HookHandler<TName>): Disposer {
      let remove: Disposer = () => undefined;
      let removed = false;
      scope.onPublish(() => {
        if (!removed)
          remove = target.hooks.on(
            name,
            (event, signal) => scope.call(() => handler(event, signal)),
            { id: plugin.id, order },
          );
      });
      return scope.registration(() => {
        removed = true;
        remove();
      });
    },
    events: {
      subscribe: (listener) => {
        let remove: Disposer = () => undefined;
        let removed = false;
        scope.onPublish(() => {
          if (!removed)
            remove = target.events.subscribe((event) => scope.call(() => listener(event)));
        });
        return scope.registration(() => {
          removed = true;
          remove();
        });
      },
    },
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
    storage: {
      get: (key) => {
        scope.assertOpen();
        return target.session.getFact(pluginFactKey(plugin.id, key));
      },
      set: (key, value) => {
        scope.assertOpen();
        return mutate(() => target.session.setFact(pluginFactKey(plugin.id, key), value));
      },
    },
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
