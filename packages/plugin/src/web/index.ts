import type { Command, SettingDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "@nyte-ai/plugin/core";
import type { Fetch } from "./body.ts";
import { webFetch } from "./fetch.ts";
import { PROVIDERS, shippedProviders } from "./providers.ts";
import { webSearch } from "./search.ts";

export { adapters, PROVIDERS } from "./providers.ts";

export type { SearchInput, ShippedProvider } from "./providers.ts";

const OFF = { value: "off", label: "Off" } as const;

const provider: SettingDefinition<string> = {
  id: "web_search.provider",
  label: "Web search provider",
  schema: standard(Type.String({ minLength: 1 })),
  choices: [...PROVIDERS.map((known) => ({ value: known.id, label: known.name })), OFF],
  default: "exa",
  scope: "host",
};

const keyCommand: Command = {
  name: "websearch-key",
  title: "Set a web search key",
  description: "Store a web search provider's API key: <provider> <key>; no key removes it.",
  complete(prefix) {
    const typed = prefix.trimStart();

    if (/\s/u.test(typed)) return [];

    return PROVIDERS.filter((known) => known.id.startsWith(typed.toLowerCase())).map((known) => ({
      value: `${known.id} `,
      label: known.id,
    }));
  },
  async run(text, { api }) {
    const [named = "", key = ""] = text.split(/\s+(.*)/su);
    const chosen = PROVIDERS.find((known) => known.id === named.toLowerCase());

    if (chosen === undefined)
      throw new Error(`Name a provider first: ${PROVIDERS.map((known) => known.id).join(", ")}.`);

    if (key === "") await api.storage.secrets.delete(chosen.id);
    else await api.storage.secrets.set(chosen.id, key);

    return `Key for ${chosen.id} ${key === "" ? "removed" : "saved"}.`;
  },
};

/**
 * Returns the web plugin sending through `fetch`: `web_fetch`, and `web_search`
 * routed by the host setting `web_search.provider` to any provider in the
 * search registry. It adds Exa, Tavily, Firecrawl and Parallel there, each
 * keyed from the plugin's secrets under its id (set with `/websearch-key`) or
 * on its keyless route without one. The setting `off`, or an empty registry,
 * drops `web_search`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function webPlugin(fetch: Fetch): Plugin {
  return {
    id: "web",
    contribute: {
      settings: [provider],
      commands: [keyCommand],
      tools: [webFetch(fetch)],
    },
    async activate(api) {
      for (const shipped of shippedProviders(fetch, (id) => api.storage.secrets.get(id)))
        api.contribute.searchProviders.add(shipped);

      let selected = await api.contribute.settings.value(provider.id);

      void (async () => {
        for await (const value of api.contribute.settings.watch(provider.id)) {
          if (value === selected) continue;
          selected = value;
          api.reload();
        }
      })();

      api.contribute.settings.add((draft, siblings) =>
        draft.wrap(provider.id, (inner) => ({
          ...inner,
          choices: [
            ...siblings.searchProviders
              .list()
              .map((known) => ({ value: known.id, label: known.name })),
            OFF,
          ],
        })),
      );

      api.contribute.tools.add((draft, siblings) => {
        if (selected === OFF.value || siblings.searchProviders.list().length === 0) return;
        draft.set("web_search", webSearch(api, provider.id));
      });
    },
  };
}

/**
 * The web plugin over the global `fetch`.
 *
 * @category plugins
 * @since 0.1.0
 */
export default webPlugin((input, init) => globalThis.fetch(input, init));
