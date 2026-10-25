import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { SearchProvider, SearchResult } from "@nyte-ai/plugin/core";
import { readCapped } from "./body.ts";
import type { Fetch } from "./body.ts";

/**
 * The search providers the web plugin ships, by id and display name.
 *
 * @category plugins
 * @since 0.1.0
 */
export const PROVIDERS = [
  { id: "exa", name: "Exa" },
  { id: "tavily", name: "Tavily" },
  { id: "firecrawl", name: "Firecrawl" },
  { id: "parallel", name: "Parallel" },
] as const;

/**
 * Names a search provider the web plugin ships.
 *
 * @category plugins
 * @since 0.1.0
 */
export type ShippedProvider = (typeof PROVIDERS)[number]["id"];

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
  readonly fetch: Fetch;
  readonly signal: AbortSignal;
}

const MAX_RESPONSE_BYTES = 256 * 1024;

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
        publish_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        excerpts: Type.Array(Type.String()),
      }),
    ),
  }),
});

/**
 * One adapter per provider: Tavily over its REST endpoint, the others over
 * one stateless MCP `tools/call` to their public route. Each sends through
 * the given fetch only, reads at most 256 KiB, and returns the hits it recognised.
 *
 * @category plugins
 * @since 0.1.0
 */
export const adapters: {
  readonly [P in ShippedProvider]: (input: SearchInput) => Promise<readonly SearchResult[]>;
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

    const body = parse(await answered(response, "tavily"));

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
      "exa",
      undefined,
      "web_search_exa",
      {
        query,
        numResults: 8,
      },
      signal,
    );

    const text = Value.Check(textBlocks, result)
      ? (result.content.find((block) => block.text !== undefined)?.text ?? "")
      : "";

    return text.split(/\n\n---\n\n/).flatMap((block) => {
      const url = field(block, "URL");
      const published = field(block, "Published");

      return url === undefined
        ? []
        : [
            {
              url,
              title: field(block, "Title"),
              content: block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim(),
              published: published === undefined ? undefined : Date.parse(published),
            },
          ];
    });
  },
  async firecrawl({ query, key, fetch, signal }) {
    const result = await callTool(
      fetch,
      new URL("https://mcp.firecrawl.dev/v2/mcp"),
      "firecrawl",
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
          title: hit.title ?? undefined,
          content: hit.description ?? undefined,
        }))
      : [];
  },
  async parallel({ query, key, fetch, signal }) {
    const result = await callTool(
      fetch,
      new URL("https://search.parallel.ai/mcp"),
      "parallel",
      key,
      "web_search",
      { objective: query, search_queries: [query] },
      signal,
    );

    return Value.Check(parallelResponse, result)
      ? result.structuredContent.results.map((hit) => ({
          url: hit.url,
          title: hit.title ?? undefined,
          content: hit.excerpts.length === 0 ? undefined : hit.excerpts.join("\n\n"),
          published:
            hit.publish_date === undefined || hit.publish_date === null
              ? undefined
              : Date.parse(hit.publish_date),
        }))
      : [];
  },
};

/**
 * Returns the shipped providers for the search registry, each reading its key
 * through `key` on every search and sending through `fetch`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function shippedProviders(
  fetch: Fetch,
  key: (provider: ShippedProvider) => Promise<string | undefined>,
): readonly SearchProvider[] {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    search: async (input) =>
      adapters[provider.id]({
        query: input.query,
        key: await key(provider.id),
        fetch,
        signal: input.signal,
      }),
  }));
}

async function callTool(
  fetch: Fetch,
  url: URL,
  provider: ShippedProvider,
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

  const body = await answered(response, provider);

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

async function answered(response: Response, provider: ShippedProvider): Promise<string> {
  const body = new TextDecoder().decode(await readCapped(response, MAX_RESPONSE_BYTES));
  const name = PROVIDERS.find((known) => known.id === provider)?.name ?? provider;

  if (response.status === 401)
    throw new Error(
      `${name} refused the search (HTTP 401). Set a key with /websearch-key ${provider} <key>.`,
    );

  if (response.status === 429)
    throw new Error(
      `${name} is rate limiting searches (HTTP 429). Try again later, or set a key with /websearch-key ${provider} <key>.`,
    );

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

function field(block: string, name: string): string | undefined {
  const value = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

  return value === undefined || value === "" || value === "N/A" ? undefined : value;
}
