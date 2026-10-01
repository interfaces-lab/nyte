import type { CodemodeTool } from "@earendil-works/pi-codemode";
import { toCodemodeIdentifier } from "@earendil-works/pi-codemode/declarations";
import type { AgentTool } from "@nyte-ai/core/plugins";
import { Type } from "typebox";

export const TOOL_SEARCH_TOOL_NAME = "tool_search";
export const DEFAULT_TOOL_SEARCH_LIMIT = 8;

export interface ToolSearchDocument {
  name: string;
  text: string;
}

export interface ToolSearchMatch {
  name: string;
  score: number;
}

export interface ToolRanker {
  rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[];
}

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

function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && !STOP_WORDS.has(term))
    .map(stem);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaText(schema: unknown, parts: string[]): void {
  if (!isObject(schema)) return;
  if (typeof schema.description === "string") parts.push(schema.description);
  if (isObject(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      parts.push(name);
      schemaText(property, parts);
    }
  }
  schemaText(schema.items, parts);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const variants = schema[key];
    if (Array.isArray(variants)) for (const variant of variants) schemaText(variant, parts);
  }
}

export function createToolSearchDocument(
  tool: Pick<AgentTool, "name" | "description" | "parameters">,
  namespace?: AgentTool["namespace"],
): ToolSearchDocument {
  const parts = [tool.name, tool.name.replaceAll("_", " "), tool.description];
  schemaText(tool.parameters, parts);
  if (namespace)
    parts.push(namespace.name, namespace.description ?? "", namespace.instructions ?? "");
  return { name: tool.name, text: parts.filter((part) => part.trim()).join(" ") };
}

export class Bm25Ranker implements ToolRanker {
  private readonly k1: number;
  private readonly b: number;

  constructor(options: { k1?: number; b?: number } = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || documents.length === 0 || limit <= 0) return [];
    const termCounts = documents.map((document) => {
      const counts = new Map<string, number>();
      for (const term of tokenize(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
      return counts;
    });
    const lengths = termCounts.map((counts) =>
      [...counts.values()].reduce((sum, count) => sum + count, 0),
    );
    const averageLength = lengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
    const idf = new Map(
      queryTerms.map((term) => {
        const frequency = termCounts.filter((counts) => counts.has(term)).length;
        return [
          term,
          Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
        ] as const;
      }),
    );
    const matches: ToolSearchMatch[] = [];
    documents.forEach((document, index) => {
      let score = 0;
      for (const term of queryTerms) {
        const count = termCounts[index].get(term);
        if (!count) continue;
        const norm = this.k1 * (1 - this.b + (this.b * lengths[index]) / averageLength);
        score += (idf.get(term) ?? 0) * ((count * (this.k1 + 1)) / (count + norm));
      }
      if (score > 0) matches.push({ name: document.name, score });
    });
    return matches.toSorted((a, b) => b.score - a.score).slice(0, limit);
  }
}

export const toolSearchSchema = Type.Object({
  query: Type.String({ description: "Search query for deferred tools." }),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of tools to return. Defaults to ${DEFAULT_TOOL_SEARCH_LIMIT}.`,
    }),
  ),
});

export const TOOL_SEARCH_DESCRIPTION = `# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`${TOOL_SEARCH_TOOL_NAME}\`) to search for the required tools. For MCP tool discovery, always use \`${TOOL_SEARCH_TOOL_NAME}\`.`;

function namespaceSuffix(name: string): string | undefined {
  return name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : undefined;
}

function isNamespaceName(namespace: string, query: string): boolean {
  const id = toCodemodeIdentifier(namespace);
  const queryId = toCodemodeIdentifier(query);
  return (
    namespace === query ||
    id === queryId ||
    namespaceSuffix(namespace) === query ||
    namespaceSuffix(id) === queryId
  );
}

export function createDiscoveryGlobals(
  tools: readonly AgentTool[],
  samples: ReadonlyMap<string, string>,
): CodemodeTool[] {
  const ranker = new Bm25Ranker();
  const entry = (name: string) => ({
    name: toCodemodeIdentifier(name),
    description: samples.get(name) ?? "",
  });
  return [
    {
      name: "searchTools",
      spread: true,
      execute: (args) => {
        const [query, searchOptions] = Array.isArray(args) ? args : [];
        if (typeof query !== "string") throw new Error("searchTools() expects a query string");
        const limit = isObject(searchOptions)
          ? (searchOptions.limit ?? DEFAULT_TOOL_SEARCH_LIMIT)
          : DEFAULT_TOOL_SEARCH_LIMIT;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
          throw new Error("searchTools() limit must be a positive integer");
        }
        const namespace = isObject(searchOptions) ? searchOptions.namespace : undefined;
        if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
          throw new Error("searchTools() namespace must be a string");
        }
        const documents = tools.flatMap((tool) => {
          if (namespace && (!tool.namespace || !isNamespaceName(tool.namespace.name, namespace)))
            return [];
          return [createToolSearchDocument(tool, tool.namespace)];
        });
        return ranker.rank(query, documents, limit).map((match) => entry(match.name));
      },
    },
    {
      name: "describeTool",
      spread: true,
      execute: (args) => {
        const [name] = Array.isArray(args) ? args : [];
        if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
        const tool = tools.find(
          (candidate) => candidate.name === name || toCodemodeIdentifier(candidate.name) === name,
        );
        return tool ? samples.get(tool.name) : undefined;
      },
    },
    {
      name: "describeNamespace",
      spread: true,
      execute: (args) => {
        const [name] = Array.isArray(args) ? args : [];
        if (typeof name !== "string")
          throw new Error("describeNamespace() expects a namespace name");
        let namespace: AgentTool["namespace"];
        const names: string[] = [];
        for (const tool of tools) {
          if (!tool.namespace || !isNamespaceName(tool.namespace.name, name)) continue;
          namespace ??= tool.namespace;
          names.push(toCodemodeIdentifier(tool.name));
        }
        if (!namespace) return undefined;
        return {
          name: namespace.name,
          ...(namespace.description ? { description: namespace.description } : {}),
          ...(namespace.instructions ? { instructions: namespace.instructions } : {}),
          tools: names,
        };
      },
    },
  ];
}
