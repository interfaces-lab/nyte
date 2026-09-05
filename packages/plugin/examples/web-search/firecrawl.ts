/**
 * Firecrawl over its public MCP route. Keyless by default; a key is a bearer
 * token. The route wraps its JSON payload in the MCP text block, so the
 * result is decoded twice, and a payload that is not the search response
 * counts as no results, as it does upstream.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/websearch/firecrawl.ts
 */
import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { callMcpTool } from "./mcp.ts";
import {
  USER_AGENT,
  webSearchProviderPlugin,
  webSearchResult,
  type WebSearchProvider,
  type WebSearchResult,
} from "./provider.ts";

export const FIRECRAWL_ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp";

const Output = Type.Object({
  content: Type.Array(Type.Object({ type: Type.Literal("text"), text: Type.String() })),
});

const SearchResponse = Type.Object({
  success: Type.Boolean(),
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

export function parseFirecrawlResults(text: string): WebSearchResult[] {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Value.Check(SearchResponse, parsed)) return [];
  return parsed.data.web.map((item) =>
    webSearchResult(item.url, { title: item.title, content: item.description }),
  );
}

export const firecrawlProvider: WebSearchProvider = {
  id: "firecrawl",
  name: "Firecrawl",
  keyEnvironment: "FIRECRAWL_API_KEY",
  async execute({ query, key, fetch, signal }) {
    const headers = new Headers({ "User-Agent": USER_AGENT });
    if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
    const result = await callMcpTool(
      FIRECRAWL_ENDPOINT,
      "firecrawl_search",
      { query, limit: 8 },
      Output,
      { fetch, signal, headers },
    );
    const content = result?.content.find((item) => item.text !== "");
    return content === undefined ? [] : parseFirecrawlResults(content.text);
  },
};

export const firecrawlPlugin = webSearchProviderPlugin(firecrawlProvider);

export default firecrawlPlugin;
