/**
 * Web search as opencode v2 arranges it: a tool that owns routing and
 * formatting, and one plugin per provider that joins it. The tool knows
 * nothing about Exa or Tavily; it asks the providers that registered.
 *
 * Routing is the `websearch-provider` setting, opencode's `websearch:provider`
 * KV entry. `auto` is its `random` with one change the user asked for: a
 * provider that has a key is preferred over one that does not, and only when
 * several are keyed, or none are, does the choice become random. `off` is
 * opencode's `false` selection, and it withholds the tool rather than failing
 * the call, so a model never sees a capability the user turned off.
 *
 * Keys are host-owned. They ride `/websearch-key <provider> [key]` or the
 * provider's environment variable, and never enter the conversation.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/tool/plugin/websearch.ts
 * and https://github.com/anomalyco/opencode/blob/v2/packages/core/src/websearch.ts
 */
import process from "node:process";
import { definePlugin, ToolError } from "@nyte-ai/plugin";
import type { AgentTool, SessionApi, SettingChoice } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { exaPlugin } from "./exa.ts";
import { firecrawlPlugin } from "./firecrawl.ts";
import { parallelPlugin } from "./parallel.ts";
import { tavilyPlugin } from "./tavily.ts";
import {
  WEB_SEARCH_OFF,
  WEB_SEARCH_SETTING_ID,
  WEB_SEARCH_TOOL_NAME,
  WebSearchRequestError,
  webSearchProviders,
  withWebSearchChoice,
  type WebSearchProvider,
  type WebSearchProviderCarrier,
  type WebSearchResult,
} from "./provider.ts";

export const WEB_SEARCH_PLUGIN_ID = "web-search";
export const PROVIDER_KEY = "provider";
/** Pick a keyed provider when there is one, otherwise pick at random. */
export const WEB_SEARCH_AUTO = "auto";
export const NO_RESULTS = "No search results found. Please try a different query.";

export const webSearchParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, description: "Websearch query" }),
  },
  { additionalProperties: false },
);

export type WebSearchQuery = Static<typeof webSearchParameters>;

/** What a client renders beside the call: who answered, and what they found. */
export interface WebSearchDetails {
  readonly provider: string;
  readonly results: readonly WebSearchResult[];
}

export interface WebSearchCredentials {
  read(provider: string): Promise<string | undefined>;
  write(provider: string, key: string | undefined): Promise<void>;
}

export interface WebSearchPluginOptions {
  readonly credentials?: WebSearchCredentials;
  readonly fetch?: typeof globalThis.fetch;
  readonly environment?: (name: string) => string | undefined;
  readonly random?: () => number;
}

/** Web-search keys live beside provider credentials, under their own ids. */
export function webSearchCredentialId(provider: string): string {
  return `websearch:${provider}`;
}

export const webSearchDescription = `Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

The current year is ${String(new Date().getFullYear())}. Use this year when searching for recent information or current events.`;

/** The runtime validated `params`; whitespace is the one thing the schema lets through. */
function parseQuery(params: WebSearchQuery): string {
  const query = params.query.trim();
  if (query === "") throw new Error("Web search needs a non-empty query");
  return query;
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** opencode's rendering of a result set, and its wording when there are none. */
export function formatResults(results: readonly WebSearchResult[]): string {
  if (results.length === 0) return NO_RESULTS;
  return results
    .map((result) => {
      const title = result.title ?? result.url;
      const published =
        result.time.published === undefined
          ? ""
          : `\nPublished: ${new Date(result.time.published).toISOString()}`;
      const content = result.content === undefined ? "" : `\n\n${result.content}`;
      return `## [${title}](${result.url})${published}${content}`;
    })
    .join("\n\n");
}

/** opencode names the HTTP failures a user can act on and leaves the rest generic. */
function failureMessage(error: WebSearchRequestError, query: string): string {
  switch (error.status) {
    case 429:
      return "Web search rate limited (HTTP 429)";
    case 401:
      return "Web search authentication failed (HTTP 401)";
    case undefined:
      return `Unable to search the web for ${query}`;
    default:
      return `Web search request failed (HTTP ${String(error.status)})`;
  }
}

/** What the tool asks its host at call time, so routing reads live state, not a snapshot. */
export interface WebSearchContext {
  /** The providers on the rebuilt tool. Read per call: provider plugins join after this one. */
  providers(): readonly WebSearchProvider[];
  /** The stored routing choice: a provider id, `auto`, or `off`. */
  selection(): Promise<string>;
  /** A stored or environment key, or `undefined` for the provider's keyless route. */
  key(provider: WebSearchProvider): Promise<string | undefined>;
  /** Which provider answers when the choice is `auto`. */
  route(providers: readonly WebSearchProvider[]): Promise<WebSearchProvider>;
  /**
   * opencode attaches the cause to its `ToolFailure` for logs while the model
   * reads only the message. Nyte's equivalent of that second channel is a
   * diagnostic, so the cause goes here and never into the transcript.
   */
  warn(message: string): void;
}

export function createWebSearchTool(
  context: WebSearchContext,
  fetch: typeof globalThis.fetch,
): AgentTool<typeof webSearchParameters, WebSearchDetails> & WebSearchProviderCarrier {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description: webSearchDescription,
    parameters: webSearchParameters,
    promptSnippet: "Search the web for current information",
    replay: "safe",
    providers: [],
    async execute(_toolCallId, params, signal, onUpdate) {
      const query = parseQuery(params);
      const providers = context.providers();
      if (providers.length === 0) throw new Error("No web search provider is installed");
      const chosen = await context.selection();
      const explicit = providers.find((provider) => provider.id === chosen);
      const provider = explicit ?? (await context.route(providers));
      onUpdate?.({
        content: [{ type: "text", text: `Searching with ${provider.name}…` }],
        details: { provider: provider.id, results: [] },
        title: query,
      });
      try {
        const results = await provider.execute({
          query,
          key: await context.key(provider),
          fetch,
          signal,
        });
        return {
          content: [{ type: "text", text: formatResults(results) }],
          details: { provider: provider.id, results },
          title: query,
        };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        const message =
          error instanceof WebSearchRequestError
            ? failureMessage(error, query)
            : `Unable to search the web for ${query}`;
        context.warn(`${provider.name} web search failed: ${errorMessage(error)}`);
        throw new ToolError({
          content: [{ type: "text", text: message }],
          details: { provider: provider.id, results: [] },
          title: query,
        });
      }
    },
  };
}

/**
 * A fact event names its ref, where every byte outside `[A-Za-z0-9_-]` is
 * percent-encoded. Decoding is what lets a plugin recognise its own key.
 */
function factKey(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function isStoredChoice(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

/** A stored choice is a provider id, `auto`, or `off`; anything else is `auto`. */
function storedSelection(value: JsonValue | undefined): string {
  return isStoredChoice(value) ? value : WEB_SEARCH_AUTO;
}

function chooseAtRandom(
  providers: readonly WebSearchProvider[],
  random: () => number,
): WebSearchProvider {
  const [first, ...rest] = providers;
  if (first === undefined) throw new Error("No web search provider is installed");
  const index = Math.floor(random() * (rest.length + 1));
  return providers[index] ?? first;
}

export function webSearchPlugin(options: WebSearchPluginOptions = {}) {
  const environment = options.environment ?? ((name: string) => process.env[name]);
  const random = options.random ?? Math.random;
  const credentials = options.credentials;

  const keyFor = async (provider: WebSearchProvider): Promise<string | undefined> => {
    const stored = present(await credentials?.read(provider.id));
    return stored ?? present(environment(provider.keyEnvironment));
  };

  return definePlugin({
    id: WEB_SEARCH_PLUGIN_ID,
    async session(api: SessionApi) {
      const selection = async (): Promise<string> =>
        storedSelection(await api.storage.get(PROVIDER_KEY));

      /**
       * `auto`. opencode picks uniformly at random; a key is the user saying
       * which route they want, so a keyed provider is preferred and the
       * random pick decides only among equals.
       */
      const route = async (providers: readonly WebSearchProvider[]): Promise<WebSearchProvider> => {
        const keys = await Promise.all(providers.map((provider) => keyFor(provider)));
        const keyed = providers.filter((_, index) => keys[index] !== undefined);
        return chooseAtRandom(keyed.length === 0 ? providers : keyed, random);
      };

      const context: WebSearchContext = {
        providers: () => webSearchProviders(api.tools.list()),
        selection,
        key: keyFor,
        route,
        warn: (message) => {
          api.diagnostics.warn(message);
        },
      };

      // The tool is withheld while search is off, so the setting is read once
      // here and again whenever the fact behind it changes.
      let disabled = (await selection()) === WEB_SEARCH_OFF;
      const factName = `${WEB_SEARCH_PLUGIN_ID}:${PROVIDER_KEY}`;
      api.events.subscribe((event) => {
        if (event.kind !== "fact" || !factKey(event.key).endsWith(factName)) return;
        const next = storedSelection(event.value) === WEB_SEARCH_OFF;
        if (next === disabled) return;
        disabled = next;
        api.tools.rebuild();
      });

      api.tools.add((tools) => {
        if (disabled) return;
        tools.set(
          WEB_SEARCH_TOOL_NAME,
          createWebSearchTool(context, options.fetch ?? globalThis.fetch),
        );
      });

      api.settings.add((settings) => {
        // `tools` rebuilds before `settings`, so the providers that joined the
        // tool are known here. The `web-search` plugin is the only writer:
        // a setting's storage key resolves under its owner's prefix, so a
        // provider plugin writing to it would move the key out from under this one.
        let choices: [SettingChoice, ...SettingChoice[]] = [
          {
            id: WEB_SEARCH_AUTO,
            label: "automatic",
            description: "Prefer a provider you hold a key for, otherwise pick at random",
          },
          { id: WEB_SEARCH_OFF, label: "off", description: "Withhold the tool from the model" },
        ];
        for (const provider of webSearchProviders(api.tools.list())) {
          choices = withWebSearchChoice(choices, {
            id: provider.id,
            label: provider.name,
            description: `Always search with ${provider.name}`,
          });
        }
        settings.set(WEB_SEARCH_SETTING_ID, {
          label: "Web search",
          key: PROVIDER_KEY,
          fallback: WEB_SEARCH_AUTO,
          choices,
        });
      });

      if (credentials === undefined) return;
      api.commands.add((commands) => {
        commands.set("websearch-key", {
          description: "Save or remove a web search API key: /websearch-key <provider> [key]",
          run: async (argument) => {
            const [id, ...rest] = argument.trim().split(/\s+/u);
            const providers = webSearchProviders(api.tools.list());
            const provider = providers.find((candidate) => candidate.id === id);
            if (provider === undefined) {
              const known = providers.map((candidate) => candidate.id).join(", ");
              throw new Error(
                known === ""
                  ? "/websearch-key needs web search to be on before it can name a provider"
                  : `/websearch-key must name one of: ${known}`,
              );
            }
            const key = rest.join(" ").trim();
            await credentials.write(provider.id, key === "" ? undefined : key);
            return key === ""
              ? `Removed the ${provider.name} API key.`
              : `Saved the ${provider.name} API key.`;
          },
        });
      });
    },
  });
}

/** The provider set opencode ships, in `WebSearchPlugins` order. */
export const webSearchProviderPlugins = [exaPlugin, firecrawlPlugin, parallelPlugin, tavilyPlugin];

/**
 * The tool plugin first, then the providers that join it. Order matters: a
 * provider plugin `update`s the tool the `web-search` plugin contributed.
 */
export function webSearchPlugins(options: WebSearchPluginOptions = {}) {
  return [webSearchPlugin(options), ...webSearchProviderPlugins];
}

export {
  WEB_SEARCH_OFF,
  WEB_SEARCH_SETTING_ID,
  WEB_SEARCH_TOOL_NAME,
  WebSearchRequestError,
  webSearchProviderPlugin,
  webSearchProviders,
  type WebSearchProvider,
  type WebSearchProviderInput,
  type WebSearchResult,
} from "./provider.ts";
export { exaPlugin, exaProvider } from "./exa.ts";
export { firecrawlPlugin, firecrawlProvider } from "./firecrawl.ts";
export { parallelPlugin, parallelProvider } from "./parallel.ts";
export { tavilyPlugin, tavilyProvider } from "./tavily.ts";

export default webSearchPlugin();
