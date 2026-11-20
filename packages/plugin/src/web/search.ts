import { dev } from "@nyte-ai/core";
import type { SearchResult, ToolDefinition } from "@nyte-ai/plugin/core";
import { searchOutput, searchParameters, WEB_SEARCH_TOOL } from "./schema.ts";
import type { SearchOutput } from "./schema.ts";

const TIMEOUT_MS = 25_000;

export function webSearch(setting: string): ToolDefinition<{ query: string }, SearchOutput> {
  return {
    name: WEB_SEARCH_TOOL,
    description: `Search the web for current information. The year is ${new Date().getFullYear()}.`,
    parameters: searchParameters,
    output: searchOutput,
    class: (args) => ({ kind: "custom", label: `Searching ${args.query}` }),
    changes: "none",
    asks: "never",
    rerun: "safe",
    async execute(args, invocation) {
      const output = await invocation.memo("results", async (): Promise<SearchOutput> => {
        const chosen = await invocation.api.registries.settings.value(setting);
        const providers = invocation.api.registries.searchProviders.list();

        const provider =
          providers.find((candidate) => candidate.id === chosen) ??
          providers.find((candidate) => candidate.id === "exa") ??
          providers[0];

        if (provider === undefined) throw new Error("No web search provider is installed.");
        dev("web", "search", { call: invocation.call, provider: provider.id });
        const deadline = AbortSignal.timeout(TIMEOUT_MS);

        const hits = await provider
          .search({ query: args.query, signal: AbortSignal.any([invocation.signal, deadline]) })
          .catch((error: unknown) => {
            if (deadline.aborted && !invocation.signal.aborted)
              throw new Error(`${provider.name} didn't answer within ${TIMEOUT_MS / 1000} s.`, {
                cause: error,
              });

            throw error;
          });

        return { provider: provider.id, results: hits.map(clean) };
      });

      const text =
        output.results.length === 0
          ? "No search results found. Try a different query."
          : output.results
              .map((hit) => {
                const published =
                  hit.published === undefined
                    ? ""
                    : `\nPublished: ${new Date(hit.published).toISOString()}`;

                return `## [${hit.title ?? hit.url}](${hit.url})${published}${hit.content === undefined ? "" : `\n\n${hit.content}`}`;
              })
              .join("\n\n");

      return { content: [{ kind: "text", text }], output };
    },
  };
}

function clean(hit: SearchResult): SearchOutput["results"][number] {
  const kept: SearchOutput["results"][number] = { url: hit.url };

  if (hit.title !== undefined && hit.title !== "") kept.title = hit.title;

  if (hit.content !== undefined && hit.content !== "") kept.content = hit.content;

  if (hit.published !== undefined && Number.isFinite(hit.published)) kept.published = hit.published;

  return kept;
}
