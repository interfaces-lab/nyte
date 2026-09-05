/**
 * Exa over its public MCP route. Keyless by default; a key rides the
 * `exaApiKey` query parameter, which is how Exa's route takes it.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/websearch/exa.ts
 */
import { Type } from "typebox";
import { callMcpTool } from "./mcp.ts";
import {
  webSearchProviderPlugin,
  webSearchResult,
  type WebSearchProvider,
  type WebSearchResult,
} from "./provider.ts";

export const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";

const Output = Type.Object({
  content: Type.Array(Type.Object({ type: Type.Literal("text"), text: Type.String() })),
});

/** Exa writes `N/A` where it has nothing; that is an absent field, not a value. */
function field(value: string | undefined): string | undefined {
  return value === "N/A" ? undefined : value;
}

/** Exa answers with one text block per hit, separated by `---`, in `Field: value` lines. */
export function parseExaResults(text: string): WebSearchResult[] {
  return text.split(/\n\n---\n\n/).flatMap((block) => {
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim();
    if (url === undefined || url === "") return [];
    return [
      webSearchResult(url, {
        title: field(block.match(/^Title:\s*(.+)$/m)?.[1]?.trim()),
        content: block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim(),
        published: field(block.match(/^Published:\s*(.+)$/m)?.[1]?.trim()),
      }),
    ];
  });
}

export const exaProvider: WebSearchProvider = {
  id: "exa",
  name: "Exa",
  keyEnvironment: "EXA_API_KEY",
  async execute({ query, key, fetch, signal }) {
    const url = new URL(EXA_ENDPOINT);
    if (key !== undefined) url.searchParams.set("exaApiKey", key);
    const result = await callMcpTool(
      url.toString(),
      "web_search_exa",
      { query, numResults: 8 },
      Output,
      { fetch, signal },
    );
    const content = result?.content.find((item) => item.text !== "");
    return content === undefined ? [] : parseExaResults(content.text);
  },
};

export const exaPlugin = webSearchProviderPlugin(exaProvider);

export default exaPlugin;
