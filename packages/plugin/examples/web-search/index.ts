/**
 * Shared search policy for every host. Auto prefers keyed providers and keeps
 * its route in session storage. Only HTTP 429 can move it to another eligible
 * provider; explicit selections never fail over. Anonymous requests require
 * a durable user reply before any query leaves the host.
 *
 * Based on https://github.com/anomalyco/opencode/tree/v2/packages/core/src/websearch.ts
 */
import process from "node:process";
import {
  acceptsSelectionReply,
  definePlugin,
  selectionReply,
  ToolError,
  ToolWait,
} from "@nyte-ai/plugin";
import type { AgentTool, Selection, SessionApi } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
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
  type WebSearchProvider,
  type WebSearchProviderCarrier,
  type WebSearchResult,
} from "./provider.ts";

export const WEB_SEARCH_PLUGIN_ID = "web-search";
export const PROVIDER_KEY = "provider";
const ROUTE_KEY = "route";
const CONSENT_KEY = "anonymous-consent";
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

/** What an anonymous search parks on: the same choices the setting offers, plus the query at stake. */
export function webSearchConsent(
  query: string,
  providers: readonly WebSearchProvider[],
): Selection {
  return {
    title: `Allow anonymous web search for “${query}” in this session?`,
    choices: [
      {
        id: WEB_SEARCH_AUTO,
        label: "Allow automatic search",
        description:
          "Send search queries to installed search providers without a key. Switch providers on rate limits.",
      },
      ...providers.map((provider) => ({
        id: provider.id,
        label: `Use ${provider.name}`,
        description: `Send search queries only to ${provider.name}. Remember this choice for this session.`,
      })),
      {
        id: WEB_SEARCH_OFF,
        label: "Off",
        description: "Do not search. Hide the web search tool for this session.",
      },
    ],
  };
}

/** What a client renders beside the call: who answered, and what they found. */
export interface WebSearchDetails {
  readonly provider: string;
  readonly results: readonly WebSearchResult[];
  readonly mode: "auto" | "explicit";
  readonly credential: SearchCredential["source"];
  /** Providers that returned HTTP 429 before this attempt. Never includes keys or raw errors. */
  readonly rateLimited: readonly string[];
}

type SearchCredential =
  | { readonly source: "anonymous"; readonly key: undefined }
  | { readonly source: "saved key" | "environment key"; readonly key: string };

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

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
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

const storedChoice = Type.String({ minLength: 1 });

/** Unknown or removed provider ids are resolved as automatic routing at call time. */
function storedSelection(value: JsonValue | undefined): string {
  return Value.Check(storedChoice, value) ? value : WEB_SEARCH_AUTO;
}

export function webSearchPlugin(options: WebSearchPluginOptions = {}) {
  const environment = options.environment ?? ((name: string) => process.env[name]);
  const random = options.random ?? Math.random;
  const credentials = options.credentials;

  const credentialFor = async (provider: WebSearchProvider): Promise<SearchCredential> => {
    const stored = present(await credentials?.read(provider.id));
    if (stored !== undefined) return { source: "saved key", key: stored };
    const key = present(environment(provider.keyEnvironment));
    return key === undefined
      ? { source: "anonymous", key: undefined }
      : { source: "environment key", key };
  };

  return definePlugin({
    id: WEB_SEARCH_PLUGIN_ID,
    async session(api: SessionApi) {
      const selection = async (): Promise<string> =>
        storedSelection(await api.storage.get(PROVIDER_KEY));
      let lastRoute: string | undefined;

      // Parallel tool calls share one routing decision, but perform HTTP requests
      // independently. Keep the read and first-route write in the same queue.
      let routing: Promise<void> = Promise.resolve();
      const planSearch = (query: string) => {
        const plan = routing.then(async () => {
          const chosen = await selection();
          if (chosen === WEB_SEARCH_OFF) throw new Error("Web search is off");
          const providers = webSearchProviders(api.tools.list());
          const explicit = providers.find((provider) => provider.id === chosen);
          const mode: WebSearchDetails["mode"] = explicit === undefined ? "auto" : "explicit";
          const routes = await Promise.all(
            (explicit === undefined ? providers : [explicit]).map(async (provider) => ({
              provider,
              credential: await credentialFor(provider),
            })),
          );
          const keyed = routes.filter((route) => route.credential.source !== "anonymous");
          const eligible = keyed.length === 0 ? routes : keyed;
          const remembered = await api.storage.get(ROUTE_KEY);
          const first =
            eligible.find((route) => route.provider.id === remembered) ??
            eligible[Math.floor(random() * eligible.length)] ??
            eligible[0];
          if (first === undefined) throw new Error("No web search provider is installed");
          const consent = explicit?.id ?? WEB_SEARCH_AUTO;
          if (
            first.credential.source === "anonymous" &&
            (await api.storage.get(CONSENT_KEY)) !== consent
          ) {
            throw new ToolWait({ selection: webSearchConsent(query, providers) });
          }

          if (mode === "auto") await api.storage.set(ROUTE_KEY, first.provider.id);
          return { mode, first, remaining: eligible.filter((route) => route !== first) };
        });
        routing = plan.then(
          () => undefined,
          () => undefined,
        );
        return plan;
      };

      const tool: AgentTool<typeof webSearchParameters, WebSearchDetails> &
        WebSearchProviderCarrier = {
        name: WEB_SEARCH_TOOL_NAME,
        description: webSearchDescription,
        parameters: webSearchParameters,
        promptSnippet: "Search the web for current information",
        replay: "safe",
        providers: [],
        async execute(_toolCallId, params, signal, onUpdate) {
          const query = params.query.trim();
          if (query === "") throw new Error("Web search needs a non-empty query");
          signal?.throwIfAborted();
          const { mode, first, remaining } = await planSearch(query);
          // Snapshot the eligible pool once: never downgrade a keyed request to
          // anonymous access during failover, and try each provider at most once.
          const rateLimited: string[] = [];
          let route = first;
          for (;;) {
            signal?.throwIfAborted();
            if ((await selection()) === WEB_SEARCH_OFF) throw new Error("Web search is off");
            const summary = `${mode === "auto" ? "Auto" : "Selected"} · ${route.provider.name} · ${route.credential.source}`;
            lastRoute = summary;
            api.settings.rebuild();
            // Lead with the query like other tools lead with their subject; routing
            // detail stays in the progress text and settings summary.
            const title = `${query} · ${route.provider.name}`;
            const details: WebSearchDetails = {
              provider: route.provider.id,
              results: [],
              mode,
              credential: route.credential.source,
              rateLimited: [...rateLimited],
            };
            const failover =
              rateLimited.length === 0 ? "" : `Rate limited: ${rateLimited.join(", ")}. `;
            onUpdate?.({
              content: [{ type: "text", text: `${failover}Searching with ${summary}…` }],
              details,
              title,
            });
            try {
              signal?.throwIfAborted();
              const results = await route.provider.execute({
                query,
                key: route.credential.key,
                fetch: options.fetch ?? globalThis.fetch,
                signal,
              });
              return {
                content: [{ type: "text", text: `${failover}${formatResults(results)}` }],
                details: { ...details, results },
                title,
              };
            } catch (error) {
              if (signal?.aborted === true) {
                throw new ToolError({
                  content: [{ type: "text", text: "Web search cancelled" }],
                  details,
                  title,
                });
              }
              const message =
                error instanceof WebSearchRequestError
                  ? failureMessage(error, query)
                  : `Unable to search the web for ${query}`;
              // Provider errors can contain authenticated URLs or echoed keys.
              api.diagnostics.warn(`${route.provider.name}: ${message}`);
              const next =
                mode === "auto" && error instanceof WebSearchRequestError && error.status === 429
                  ? remaining.shift()
                  : undefined;
              if (next !== undefined) {
                rateLimited.push(route.provider.id);
                await api.storage.set(ROUTE_KEY, next.provider.id);
                route = next;
                continue;
              }
              throw new ToolError({
                content: [{ type: "text", text: `${failover}${message}` }],
                details,
                title,
              });
            }
          }
        },
        async wake(waiting, context) {
          if (context.aborted || context.signal.aborted) {
            throw new ToolError({
              content: [{ type: "text", text: "Web search cancelled" }],
              details: {},
            });
          }
          if (context.reply === undefined) return { kind: "wait" };
          if (!Value.Check(webSearchParameters, waiting.args))
            throw new Error("Invalid web search arguments");
          const providers = webSearchProviders(api.tools.list());
          const selection = webSearchConsent(waiting.args.query, providers);
          const structured = selectionReply(context.reply);
          const chosen =
            structured !== undefined && acceptsSelectionReply(selection, structured)
              ? structured.choices[0]
              : typeof context.reply === "string"
                ? context.reply
                : undefined;
          const reply = [
            WEB_SEARCH_AUTO,
            WEB_SEARCH_OFF,
            ...providers.map((provider) => provider.id),
          ].find((choice) => choice === chosen);
          if (reply === undefined) {
            throw new ToolError({
              content: [
                {
                  type: "text",
                  text: "Web search was not approved. Choose a search option to allow anonymous requests.",
                },
              ],
              details: {},
            });
          }
          await api.storage.set(PROVIDER_KEY, reply);
          await api.storage.set(CONSENT_KEY, reply === WEB_SEARCH_OFF ? null : reply);
          if (reply === WEB_SEARCH_OFF) {
            throw new ToolError({
              content: [{ type: "text", text: "Web search is off" }],
              details: {},
            });
          }
          return {
            kind: "settle",
            result: await tool.execute(waiting.toolCallId, waiting.args, context.signal),
          };
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
        tools.set(WEB_SEARCH_TOOL_NAME, tool);
      });

      api.settings.add((settings) => {
        // `tools` rebuilds before `settings`, so the providers that joined the
        // tool are known here. The `web-search` plugin is the only writer:
        // a setting's storage key resolves under its owner's prefix, so a
        // provider plugin writing to it would move the key out from under this one.
        settings.set(WEB_SEARCH_SETTING_ID, {
          label: "Web search",
          key: PROVIDER_KEY,
          fallback: WEB_SEARCH_AUTO,
          choices: [
            {
              id: WEB_SEARCH_AUTO,
              label: "automatic",
              description:
                lastRoute === undefined
                  ? "Prefer keys and switch providers on rate limits. Ask before anonymous search."
                  : `Last search: ${lastRoute}`,
            },
            ...webSearchProviders(api.tools.list()).map((provider) => ({
              id: provider.id,
              label: provider.name,
              description: `Always search with ${provider.name}`,
            })),
            { id: WEB_SEARCH_OFF, label: "off", description: "Withhold the tool from the model" },
          ],
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
            lastRoute = undefined;
            api.settings.rebuild();
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
