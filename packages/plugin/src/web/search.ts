import { dev } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { PluginApi, SearchResult, ToolDefinition } from "@nyte-ai/plugin/core";

const TIMEOUT_MS = 25_000;

const parameters = standard(
  Type.Object({ query: Type.String({ minLength: 1, description: "What to search the web for." }) }),
);

const searchOutput = Type.Object({
  provider: Type.String(),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      published: Type.Optional(Type.Number({ description: "Milliseconds since the Unix epoch." })),
    }),
  ),
});

type SearchOutput = Static<typeof searchOutput>;

/**
 * The `web_search` tool: asks the registered provider the setting `setting` names,
 * falling back to Exa and then to the first one registered.
 */
export function webSearch(
  api: PluginApi,
  setting: string,
): ToolDefinition<{ query: string }, SearchOutput> {
  return {
    name: "web_search",
    description: `Search the web using the user's selected search provider. Use this for current information beyond your knowledge cutoff. The current year is ${new Date().getFullYear()}.`,
    parameters,
    output: standard(searchOutput),
    class: (args) => ({ kind: "custom", label: `Searching ${args.query}` }),
    effects: "none",
    approval: "never",
    replay: "safe",
    async execute(args, invocation) {
      const output = await invocation.memo("results", async (): Promise<SearchOutput> => {
        const chosen = await api.contribute.settings.value(setting);
        const providers = api.contribute.searchProviders.list();

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

/** Keeps the fields a provider actually filled, so the result is plain JSON. */
function clean(hit: SearchResult): SearchOutput["results"][number] {
  const kept: SearchOutput["results"][number] = { url: hit.url };

  if (hit.title !== undefined && hit.title !== "") kept.title = hit.title;

  if (hit.content !== undefined && hit.content !== "") kept.content = hit.content;

  if (hit.published !== undefined && Number.isFinite(hit.published)) kept.published = hit.published;

  return kept;
}
