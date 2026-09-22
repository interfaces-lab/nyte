/**
 * Parallel over its public MCP route. Keyless by default; a key is a bearer
 * token. Parallel returns structured content beside the text block, and the
 * structured half is what carries excerpts and dates.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/websearch/parallel.ts
 */
import { Type } from "typebox";
import { callMcpTool } from "./mcp.ts";
import {
  USER_AGENT,
  webSearchProviderPlugin,
  webSearchResult,
  type WebSearchProvider,
} from "./provider.ts";

export const PARALLEL_ENDPOINT = "https://search.parallel.ai/mcp";

const SearchResponse = Type.Object({
  search_id: Type.String(),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      publish_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      excerpts: Type.Array(Type.String()),
    }),
  ),
  warnings: Type.Optional(
    Type.Union([
      Type.Array(
        Type.Object({
          type: Type.Union([
            Type.Literal("spec_validation_warning"),
            Type.Literal("input_validation_warning"),
            Type.Literal("warning"),
          ]),
          message: Type.String(),
          detail: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Any()), Type.Null()])),
        }),
      ),
      Type.Null(),
    ]),
  ),
  usage: Type.Optional(
    Type.Union([
      Type.Array(Type.Object({ name: Type.String(), count: Type.Integer() })),
      Type.Null(),
    ]),
  ),
  session_id: Type.String(),
});

const Output = Type.Object({
  content: Type.Array(Type.Object({ type: Type.Literal("text"), text: Type.String() })),
  structuredContent: SearchResponse,
});

export const parallelProvider: WebSearchProvider = {
  id: "parallel",
  name: "Parallel",
  keyEnvironment: "PARALLEL_API_KEY",
  async execute({ query, key, fetch, signal }) {
    const headers = new Headers({ "User-Agent": USER_AGENT });

    if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);

    const result = await callMcpTool(
      PARALLEL_ENDPOINT,
      "web_search",
      { objective: query, search_queries: [query] },
      Output,
      { fetch, signal, headers },
    );

    if (result === undefined) return [];

    return result.structuredContent.results.map((item) =>
      webSearchResult(item.url, {
        title: item.title,
        content: item.excerpts.length === 0 ? undefined : item.excerpts.join("\n\n"),
        published: item.publish_date,
      }),
    );
  },
};

export const parallelPlugin = webSearchProviderPlugin(parallelProvider);

export default parallelPlugin;
