import type { Command, SettingDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";
import type { Fetch } from "./body.ts";
import { webFetch } from "./fetch.ts";
import { shippedProviders } from "./providers.ts";
import {
  PROVIDERS,
  SEARCH_KEYS_SETTING,
  SEARCH_OFF,
  SEARCH_PROVIDER_SETTING,
  SearchKeysType,
} from "./schema.ts";
import type { SearchKeys } from "./schema.ts";
import { webSearch } from "./search.ts";

export { adapters } from "./providers.ts";

export { PROVIDERS } from "./schema.ts";

export type { SearchInput } from "./providers.ts";

export type { ShippedProvider } from "./schema.ts";

const provider: SettingDefinition<string> = {
  id: SEARCH_PROVIDER_SETTING,
  label: "Web search provider",
  schema: standard(Type.String({ minLength: 1 })),
  choices: [...PROVIDERS.map((known) => ({ value: known.id, label: known.name })), SEARCH_OFF],
  default: "exa",
  scope: "host",
};

const keys: SettingDefinition<SearchKeys> = {
  id: SEARCH_KEYS_SETTING,
  label: "Web search API keys",
  schema: standard(SearchKeysType),
  default: {},
  scope: "host",
  secret: true,
};

const keyCommand: Command<"core"> = {
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

    const others = Object.fromEntries(
      Object.entries(await readKeys(api)).filter((entry) => entry[0] !== chosen.id),
    );

    const outcome = await api.sdk.settings.apply(
      keys.id,
      key === "" ? others : { ...others, [chosen.id]: { secret: true, value: key } },
    );

    if (outcome.kind !== "applied") throw new Error(`The key for ${chosen.id} couldn't be saved.`);

    return `Key for ${chosen.id} ${key === "" ? "removed" : "saved"}.`;
  },
};

/**
 * Returns the web plugin sending through `fetch`: `web_fetch`, and `web_search`
 * routed by the host setting `web_search.provider` to any provider in the
 * search registry. It adds Exa, Tavily, Firecrawl and Parallel there, each
 * keyed from the sealed host setting `web_search.keys` under its id (set in
 * Settings > Web search or with `/websearch-key`) or on its keyless route
 * without one.
 * The setting `off`, or an empty registry, drops `web_search`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function webPlugin(fetch: Fetch): Plugin {
  return {
    id: "web",
    contribute: {
      settings: [provider, keys],
      commands: [keyCommand],
      tools: [webFetch(fetch)],
    },
    async activate(api) {
      const key = async (id: string): Promise<string | undefined> =>
        (await readKeys(api))[id]?.value;

      for (const shipped of shippedProviders(fetch, key))
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
            SEARCH_OFF,
          ],
        })),
      );

      api.contribute.tools.add((draft, siblings) => {
        if (selected === SEARCH_OFF.value || siblings.searchProviders.list().length === 0) return;
        draft.set("web_search", webSearch(api, provider.id));
      });
    },
  };
}

async function readKeys(api: PluginApi): Promise<SearchKeys> {
  const stored = await api.contribute.settings.value(keys.id);

  return Value.Check(SearchKeysType, stored) ? stored : {};
}

export default webPlugin((input, init) => globalThis.fetch(input, init));
