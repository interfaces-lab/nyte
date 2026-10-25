import type { ToolDefinition, ToolNamespace } from "@nyte-ai/core";
import { isJsonObject, standard } from "@nyte-ai/schema";
import type { Json, ToolInfo } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "@nyte-ai/plugin/core";

export const DEFAULT_SEARCH_LIMIT = 8;

/** A tool as the ranker sees it: its name and the text {@link createToolSearchDocument} builds. */
export type ToolSearchDocument = { readonly name: string; readonly text: string };

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const K1 = 1.2;

const B = 0.75;

const DESCRIPTION = `Searches over deferred tool metadata with BM25 and exposes matching tools for the next model call.

Some of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`tool_search\`) to search for the required tools. For MCP tool discovery, always use \`tool_search\`.`;

const parameters = standard(
  Type.Object({
    query: Type.String({ description: "Search query for deferred tools." }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: `Maximum number of tools to return. Defaults to ${DEFAULT_SEARCH_LIMIT}.`,
      }),
    ),
  }),
);

const output = standard(Type.Object({ loaded: Type.Array(Type.String()) }));

/**
 * The `tool_search` tool: ranks the `code` and `deferred` tools the head
 * has not loaded yet and loads the matches, so the model sees them declared
 * from its next request on. Loads live in the call's output, so they follow
 * the head's history through restarts, branches and compaction. The tool is
 * declared only while some `deferred` tool is not.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "tool-search",
  activate(api) {
    const namespaces = (): ReadonlyMap<string, ToolNamespace> =>
      new Map(
        api.contribute.tools
          .list()
          .flatMap((definition) =>
            definition.namespace === undefined ? [] : [[definition.name, definition.namespace]],
          ),
      );

    const search: ToolDefinition<{ query: string; limit?: number }, { loaded: string[] }> = {
      name: "tool_search",
      description: DESCRIPTION,
      parameters,
      output,
      exposure: "model-only",
      class: () => ({ kind: "custom", label: "Searching tools" }),
      effects: "none",
      approval: "never",
      replay: "safe",
      loads: (result) => result.loaded,
      async execute(args, invocation) {
        if (args.query.trim() === "") throw new Error("query must not be empty");
        const loaded = new Set(await invocation.tools.loaded());
        const found = namespaces();

        const candidates = invocation.tools
          .list()
          .filter(
            (info) =>
              (info.exposure === "code" || info.exposure === "deferred") && !loaded.has(info.name),
          );

        const names = rankTools(
          args.query,
          candidates.map((info) => createToolSearchDocument(info, found.get(info.name))),
          args.limit ?? DEFAULT_SEARCH_LIMIT,
        );

        const lines = names.map((name) => {
          const [line = ""] = (candidates.find((info) => info.name === name)?.description ?? "")
            .trim()
            .split(/\r?\n/);

          return `- ${name}: ${line}`;
        });

        return {
          content: [
            {
              kind: "text",
              text:
                names.length === 0
                  ? "No matching tools found."
                  : `Loaded ${names.length} tool${names.length === 1 ? "" : "s"}. They are available from your next call:\n${lines.join("\n")}`,
            },
          ],
          output: { loaded: [...names] },
        };
      },
    };

    api.contribute.tools.add(search);
    api.hook("transform_transcript", (transcript) => {
      const declared = new Set(transcript.tools.map((info) => info.name));
      const pending = api.contribute.tools
        .list()
        .some((definition) => definition.exposure === "deferred" && !declared.has(definition.name));

      return pending
        ? transcript
        : { ...transcript, tools: transcript.tools.filter((info) => info.name !== search.name) };
    });
  },
} satisfies Plugin;

/** Lowercase terms split at camelCase boundaries and non-alphanumerics, without stop words, naively singular. */
export function tokenize(text: string): readonly string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && !STOP_WORDS.has(term))
    .map(stem);
}

/** So `issues` matches `issue` and `searches` matches `search`. */
function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;

  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);

  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);

  return term;
}

/**
 * A tool's search text: its name, the name with `_` as spaces, its
 * description, every parameter's name and description, and its namespace's
 * name, description and instructions.
 */
export function createToolSearchDocument(
  tool: Pick<ToolInfo, "name" | "description" | "parameters">,
  namespace: ToolNamespace | undefined,
): ToolSearchDocument {
  const parts = [
    tool.name,
    tool.name.replaceAll("_", " "),
    tool.description,
    ...describeSchema(tool.parameters),
    ...(namespace === undefined
      ? []
      : [namespace.name, namespace.description ?? "", namespace.instructions ?? ""]),
  ];

  return { name: tool.name, text: parts.filter((part) => part.trim() !== "").join(" ") };
}

/** Descriptions and property names of a JSON Schema, through `items` and `anyOf`, `oneOf` and `allOf`. */
function describeSchema(schema: Json | undefined): readonly string[] {
  if (schema === undefined || !isJsonObject(schema)) return [];
  const properties = isJsonObject(schema.properties) ? Object.entries(schema.properties) : [];

  return [
    ...(typeof schema.description === "string" ? [schema.description] : []),
    ...properties.flatMap(([name, property]) => [name, ...describeSchema(property)]),
    ...describeSchema(schema.items),
    ...["anyOf", "oneOf", "allOf"].flatMap((key) => {
      const variants = schema[key];

      return Array.isArray(variants) ? variants.flatMap(describeSchema) : [];
    }),
  ];
}

/** The names of the `limit` best documents for `query` by Okapi BM25; ties keep document order. */
export function rankTools(
  query: string,
  documents: readonly ToolSearchDocument[],
  limit: number,
): readonly string[] {
  const terms = [...new Set(tokenize(query))];

  if (terms.length === 0 || documents.length === 0) return [];

  const indexed = documents.map((document) => {
    const tokens = tokenize(document.text);

    return { name: document.name, length: tokens.length, counts: Map.groupBy(tokens, (t) => t) };
  });

  const average = indexed.reduce((sum, entry) => sum + entry.length, 0) / indexed.length || 1;

  const idf = new Map(
    terms.map((term) => {
      const frequency = indexed.filter((entry) => entry.counts.has(term)).length;

      return [term, Math.log(1 + (indexed.length - frequency + 0.5) / (frequency + 0.5))] as const;
    }),
  );

  return indexed
    .map((entry) => ({
      name: entry.name,
      score: terms.reduce((score, term) => {
        const count = entry.counts.get(term)?.length ?? 0;
        const norm = K1 * (1 - B + (B * entry.length) / average);

        return score + ((idf.get(term) ?? 0) * (count * (K1 + 1))) / (count + norm);
      }, 0),
    }))
    .filter((match) => match.score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((match) => match.name);
}
