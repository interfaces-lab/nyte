/**
 * Tavily over its REST search endpoint, the one provider here that is not
 * an MCP route. Without a key it asks for the keyless access mode by header;
 * with one it sends a bearer token.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/websearch/tavily.ts
 */
import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { MAX_RESPONSE_BYTES, readBoundedBody, requestFailure, requestSignal } from "./mcp.ts";
import {
  USER_AGENT,
  WebSearchRequestError,
  webSearchProviderPlugin,
  webSearchResult,
  type WebSearchProvider,
} from "./provider.ts";

export const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const tooLarge = (): Error =>
  new Error(`Tavily response exceeded ${String(MAX_RESPONSE_BYTES)} bytes`);

const SearchResponse = Type.Object({
  results: Type.Array(
    Type.Object({ title: Type.String(), url: Type.String(), content: Type.String() }),
  ),
});

export const tavilyProvider: WebSearchProvider = {
  id: "tavily",
  name: "Tavily",
  keyEnvironment: "TAVILY_API_KEY",
  async execute({ query, key, fetch, signal }) {
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Client-Name": "nyte",
    });
    if (key === undefined) headers.set("X-Tavily-Access-Mode", "keyless");
    else headers.set("Authorization", `Bearer ${key}`);
    try {
      const response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          search_depth: "basic",
          chunks_per_source: 3,
          max_results: 8,
        }),
        signal: requestSignal(signal),
      });
      const text = await readBoundedBody(response, MAX_RESPONSE_BYTES, tooLarge);
      if (!response.ok) {
        throw new WebSearchRequestError(
          text.trim() || response.statusText || `HTTP ${String(response.status)}`,
          { status: response.status },
        );
      }
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        throw new Error("Tavily returned a body that is not JSON", { cause });
      }
      if (!Value.Check(SearchResponse, parsed)) {
        throw new Error("Tavily returned a response the tool does not recognise");
      }
      return parsed.results.map((item) =>
        webSearchResult(item.url, { title: item.title, content: item.content }),
      );
    } catch (error) {
      throw requestFailure(error, signal, "Tavily web search request timed out");
    }
  },
};

export const tavilyPlugin = webSearchProviderPlugin(tavilyProvider);

export default tavilyPlugin;
