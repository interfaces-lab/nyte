import type { Command, SettingDefinition } from "@nyte-ai/core";
import { SecretValueType, standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";
import type { Fetch } from "./body.ts";
import { webFetch } from "./fetch.ts";
import { shippedProviders } from "./providers.ts";
import { PROVIDERS, SEARCH_OFF, SEARCH_PROVIDER_SETTING, searchKeySetting } from "./schema.ts";
import type { ShippedProvider } from "./schema.ts";
import { webSearch } from "./search.ts";

export { adapters } from "./providers.ts";

export { PROVIDERS } from "./schema.ts";

export type { SearchInput } from "./providers.ts";

export type { ShippedProvider } from "./schema.ts";

const OFF = { value: SEARCH_OFF.value, title: SEARCH_OFF.label };

const PAGE = "Web search";

const provider = {
  id: SEARCH_PROVIDER_SETTING,
  title: "Web search provider",
  page: PAGE,
  schema: standard(Type.String({ minLength: 1 })),
  choices: [...PROVIDERS.map((known) => ({ value: known.id, title: known.name })), OFF],
  default: "exa",
} satisfies SettingDefinition<string>;

const keys = PROVIDERS.map(
  (known) =>
    ({
      id: searchKeySetting(known.id),
      title: `${known.name} API key`,
      page: PAGE,
      placeholder: "Paste an API key",
      type: "secret",
      when: (chat) => chat.settings[provider.id] === known.id,
    }) satisfies SettingDefinition,
);

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

    if (chosen === undefined) {
      throw new Error(`Name a provider first: ${PROVIDERS.map((known) => known.id).join(", ")}.`);
    }

    const outcome = await api.host.settings.apply(
      searchKeySetting(chosen.id),
      key === "" ? null : { secret: true, value: key },
    );

    if (outcome.kind !== "applied") throw new Error(`The key for ${chosen.id} couldn't be saved.`);

    return `Key for ${chosen.id} ${key === "" ? "removed" : "saved"}.`;
  },
};

/**
 * Returns the web plugin sending through `fetch`: `web_fetch`, and `web_search`
 * routed by the host setting `web_search.provider` to any provider in the
 * search registry. It adds Exa, Tavily, Firecrawl and Parallel there, each
 * keyed from its own sealed host setting, `web_search.key.<id>` (set in
 * Settings > Web search or with `/websearch-key`), or on its keyless route
 * without one. A provider's key setting shows only while it is the chosen one.
 * The setting `off`, or an empty registry, drops `web_search`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function webPlugin(fetch: Fetch): Plugin {
  return {
    id: "web",
    contribute: {
      settings: [provider, ...keys],
      commands: [keyCommand],
      tools: [
        webFetch(fetch),
        {
          ...webSearch(provider.id),
          when: (chat) =>
            chat.settings[provider.id] !== SEARCH_OFF.value && chat.searchProviders.length > 0,
        },
      ],
    },
    activate: (api) => ({
      contribute: {
        searchProviders: shippedProviders(fetch, (id) => readKey(api, id)),
        settings: [
          (draft, siblings) =>
            draft.set(provider.id, {
              ...provider,
              choices: [
                ...siblings.searchProviders
                  .list()
                  .map((known) => ({ value: known.id, title: known.name })),
                OFF,
              ],
            }),
        ],
      },
    }),
  };
}

async function readKey(api: PluginApi, id: ShippedProvider): Promise<string | undefined> {
  const stored = await api.registries.settings.value(searchKeySetting(id));

  return Value.Check(SecretValueType, stored) ? stored?.value : undefined;
}

export default webPlugin((input, init) => globalThis.fetch(input, init));
