import { dev } from "@nyte-ai/core";
import type { Command, SettingDefinition, ToolDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";

/**
 * Names a search provider the `web_search` tool can route to.
 *
 * @category plugins
 * @since 0.1.0
 */
export type SearchProvider = (typeof PROVIDERS)[number];

const PROVIDERS = ["exa", "tavily", "firecrawl", "parallel"] as const;

const providerSchema = Type.Union(PROVIDERS.map((name) => Type.Literal(name)));

/**
 * Returns one search hit as the tool reports it.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface SearchResult {
  readonly url: string;
  readonly title: string | null;
  readonly content: string | null;
}

/**
 * Returns what one adapter call needs: the query, the provider's key or
 * undefined for its keyless route, the fetch to send with, and a signal.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface SearchInput {
  readonly query: string;
  readonly key: string | undefined;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
}

const provider: SettingDefinition<SearchProvider> = {
  id: "web_search.provider",
  label: "Web search provider",
  schema: standard(providerSchema),
  choices: [
    { value: "exa", label: "Exa" },
    { value: "tavily", label: "Tavily" },
    { value: "firecrawl", label: "Firecrawl" },
    { value: "parallel", label: "Parallel" },
  ],
  default: "exa",
  scope: "host",
};

const textBlocks = Type.Object({
  content: Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
});

const tavilyResponse = Type.Object({
  results: Type.Array(
    Type.Object({ url: Type.String(), title: Type.String(), content: Type.String() }),
  ),
});

const firecrawlResponse = Type.Object({
  data: Type.Object({
    web: Type.Array(
      Type.Object({
        url: Type.String(),
        title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
    ),
  }),
});

const parallelResponse = Type.Object({
  structuredContent: Type.Object({
    results: Type.Array(
      Type.Object({
        url: Type.String(),
        title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        excerpts: Type.Array(Type.String()),
      }),
    ),
  }),
});

/**
 * One adapter per provider: Tavily over its REST endpoint, the others over
 * one stateless MCP `tools/call` to their public route. Each sends through
 * the given fetch only and returns the hits it recognised.
 *
 * @category plugins
 * @since 0.1.0
 */
export const adapters: {
  readonly [P in SearchProvider]: (input: SearchInput) => Promise<readonly SearchResult[]>;
} = {
  async tavily({ query, key, fetch, signal }) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key === undefined
          ? { "X-Tavily-Access-Mode": "keyless" }
          : { Authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 8 }),
      signal,
    });

    const body = parse(await answered(response));

    return Value.Check(tavilyResponse, body)
      ? body.results.map((hit) => ({ url: hit.url, title: hit.title, content: hit.content }))
      : [];
  },
  async exa({ query, key, fetch, signal }) {
    const endpoint = new URL("https://mcp.exa.ai/mcp");

    if (key !== undefined) endpoint.searchParams.set("exaApiKey", key);
    const result = await callTool(
      fetch,
      endpoint,
      undefined,
      "web_search_exa",
      { query, numResults: 8 },
      signal,
    );
    const text = Value.Check(textBlocks, result)
      ? (result.content.find((block) => block.text !== undefined)?.text ?? "")
      : "";

    return text.split(/\n\n---\n\n/).flatMap((block) => {
      const url = field(block, "URL");

      return url === null
        ? []
        : [
            {
              url,
              title: field(block, "Title"),
              content: block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim() ?? null,
            },
          ];
    });
  },
  async firecrawl({ query, key, fetch, signal }) {
    const result = await callTool(
      fetch,
      new URL("https://mcp.firecrawl.dev/v2/mcp"),
      key,
      "firecrawl_search",
      { query, limit: 8 },
      signal,
    );
    const text = Value.Check(textBlocks, result)
      ? (result.content.find((block) => block.text !== undefined)?.text ?? "")
      : "";
    const body = parse(text);

    return Value.Check(firecrawlResponse, body)
      ? body.data.web.map((hit) => ({
          url: hit.url,
          title: hit.title ?? null,
          content: hit.description ?? null,
        }))
      : [];
  },
  async parallel({ query, key, fetch, signal }) {
    const result = await callTool(
      fetch,
      new URL("https://search.parallel.ai/mcp"),
      key,
      "web_search",
      { objective: query, search_queries: [query] },
      signal,
    );

    return Value.Check(parallelResponse, result)
      ? result.structuredContent.results.map((hit) => ({
          url: hit.url,
          title: hit.title ?? null,
          content: hit.excerpts.length === 0 ? null : hit.excerpts.join("\n\n"),
        }))
      : [];
  },
};

async function callTool(
  fetch: typeof globalThis.fetch,
  url: URL,
  key: string | undefined,
  tool: string,
  args: Json,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(key === undefined ? {} : { Authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal,
  });

  const body = await answered(response);
  const frames = [
    body,
    ...body.split("\n").flatMap((line) => (line.startsWith("data: ") ? [line.slice(6)] : [])),
  ];

  for (const frame of frames) {
    const message = parse(frame);

    if (typeof message === "object" && message !== null && "result" in message)
      return message.result;
  }

  return undefined;
}

async function answered(response: Response): Promise<string> {
  const body = await response.text();

  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${body.trim().slice(0, 200) || response.statusText}`);

  return body;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function field(block: string, name: string): string | null {
  const value = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

  return value === undefined || value === "" || value === "N/A" ? null : value;
}

const parameters = standard(
  Type.Object({ query: Type.String({ minLength: 1, description: "What to search the web for." }) }),
);

function webSearch(api: PluginApi): ToolDefinition<{ query: string }> {
  return {
    name: "web_search",
    description:
      "Search the web for current information beyond your knowledge cutoff. Returns titles, URLs and excerpts.",
    parameters,
    class: (args) => ({ kind: "custom", label: `Searching ${args.query}` }),
    effects: "none",
    approval: "never",
    replay: "safe",
    async execute(args, invocation) {
      const value = await api.contribute.settings.value(provider.id);
      const name = PROVIDERS.find((known) => known === value) ?? provider.default;

      const results = await invocation.memo("results", async () => {
        const key = await api.storage.secrets.get(name);
        dev("web-search", "search", {
          call: invocation.call,
          provider: name,
          keyed: key !== undefined,
        });
        const hits = await adapters[name]({
          query: args.query,
          key,
          fetch: globalThis.fetch,
          signal: AbortSignal.any([invocation.signal, AbortSignal.timeout(25_000)]),
        });

        return hits.map((hit) => ({ url: hit.url, title: hit.title, content: hit.content }));
      });

      const text =
        results.length === 0
          ? "No results. Try a different query."
          : results
              .map(
                (hit) =>
                  `## ${hit.title ?? hit.url}\n${hit.url}${hit.content === null ? "" : `\n\n${hit.content}`}`,
              )
              .join("\n\n");

      return { content: [{ kind: "text", text }] };
    },
  };
}

const keyCommand: Command<{ provider: SearchProvider; key: string }> = {
  name: "key",
  title: "Set a web search key",
  description: "Store an API key for a web search provider; an empty key removes it.",
  arguments: standard(Type.Object({ provider: providerSchema, key: Type.String() })),
  async run(args, { api }) {
    const key = args.key.trim();

    if (key === "") await api.storage.secrets.delete(args.provider);
    else await api.storage.secrets.set(args.provider, key);

    return `Key for ${args.provider} ${key === "" ? "removed" : "saved"}.`;
  },
};

/**
 * Adds `web_search`, routed by the host setting `web_search.provider` to
 * Tavily, Exa, Firecrawl or Parallel. A provider's key lives in the plugin's
 * secrets under the provider's id, set with the `key` command; without one
 * the provider's keyless route is used.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "web-search",
  contribute: {
    settings: [provider],
    commands: [keyCommand],
  },
  activate(api) {
    api.contribute.tools.add(webSearch(api));
  },
} satisfies Plugin;
