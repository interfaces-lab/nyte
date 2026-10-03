import { lazyStream } from "@nyte-ai/ai";
import type { Models, MutableModels, Provider } from "@nyte-ai/ai";
import type { Plugin, StreamFn } from "@nyte-ai/core";
import type { SessionApi } from "@nyte-ai/core/plugins";
import { pluginSource, withPluginSource } from "@nyte-ai/core/plugin-source";
import { isProviderPlugin } from "@nyte-ai/plugin/provider";
import type { ProviderPlugin } from "@nyte-ai/plugin/provider";

type Override = {
  readonly order: number;
  readonly api: SessionApi;
  readonly plugin: ProviderPlugin;
};

export function providerOverrides(defaults: MutableModels) {
  const sessions = new Map<string, Set<Override>>();
  const catalogs = new WeakMap<Provider, Models>();
  const wrappers = new WeakMap<
    ProviderPlugin,
    { readonly order: number; readonly plugin: Plugin }
  >();

  const wrap = (plugins: readonly Plugin[]): Plugin[] =>
    plugins.map((plugin, order) => {
      if (!isProviderPlugin(plugin)) return plugin;
      const cached = wrappers.get(plugin);
      const source = pluginSource(plugin);
      if (cached?.order === order) {
        if (source !== undefined) withPluginSource(cached.plugin, source);
        return cached.plugin;
      }

      const wrapped: Plugin = {
        id: plugin.id,
        async session(api) {
          await plugin.session(api);
          const session = await api.session.info();

          if (session.id === undefined || api.signal.aborted) return;
          const id = session.id;
          const entries = sessions.get(id) ?? new Set<Override>();
          const entry = { order, api, plugin };
          entries.add(entry);
          sessions.set(id, entries);
          api.signal.addEventListener(
            "abort",
            () => {
              entries.delete(entry);

              if (entries.size === 0) sessions.delete(id);
            },
            { once: true },
          );
        },
      };
      if (source !== undefined) withPluginSource(wrapped, source);
      wrappers.set(plugin, { order, plugin: wrapped });
      return wrapped;
    });

  const stream: StreamFn = (model, context, options) => {
    const entries =
      options?.sessionId === undefined ? [] : [...(sessions.get(options.sessionId) ?? [])];

    if (entries.length === 0) return defaults.streamSimple(model, context, options);

    return lazyStream(model, async () => {
      entries.sort((left, right) => right.order - left.order);

      for (const entry of entries) {
        options?.signal?.throwIfAborted();

        if (entry.api.signal.aborted) continue;
        const provider = await entry.plugin.provider(entry.api);

        if (entry.api.signal.aborted || provider?.id !== model.provider) continue;
        const catalog = catalogs.get(provider) ?? defaults.withProvider(provider);
        catalogs.set(provider, catalog);
        const replacement = catalog.getModel(model.provider, model.id);

        if (replacement === undefined) {
          throw new Error(
            `Plugin ${entry.plugin.id} does not provide ${model.provider}/${model.id}`,
          );
        }

        return catalog.streamSimple(
          { ...replacement, contextWindow: model.contextWindow },
          context,
          options,
        );
      }

      return defaults.streamSimple(model, context, options);
    });
  };

  return { wrap, stream };
}
