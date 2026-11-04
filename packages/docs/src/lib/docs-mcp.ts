import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult, McpHttpHandler } from "@modelcontextprotocol/server";
import { createSearchAPI } from "fumadocs-core/search/server";
import { z } from "zod";
import type { DocPage } from "~/lib/docs";
import { allDocs, docsNav, findPage, searchIndexes } from "~/lib/docs";
import { mainOrigin } from "~/lib/hosts";

const INSTRUCTIONS =
  "Nyte's documentation: the desktop app, the `nyte` terminal client, configuration, the SDK, plugins and hosts. Search with search_docs, then read the pages it finds with read_doc; list_docs shows every page.";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const search = createSearchAPI("advanced", { indexes: searchIndexes });

const handlers = new Map<string, McpHttpHandler>();

export function answerMcp(request: Request): Promise<Response> {
  const origin = mainOrigin(request.url);
  const known = handlers.get(origin);
  const handler = known ?? createMcpHandler(() => docsServer(origin));

  if (known === undefined) handlers.set(origin, handler);

  return handler.fetch(request);
}

function docsServer(origin: string): McpServer {
  const server = new McpServer(
    { name: "nyte-docs", title: "Nyte docs", version: "1" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_docs",
    {
      description: "List every Nyte docs page by sidebar section, with its path and description.",
      annotations: READ_ONLY,
    },
    () => answer(listDocs()),
  );

  server.registerTool(
    "search_docs",
    {
      description:
        "Search Nyte's docs. Answers the best-matching pages, each with the sections that matched and their links.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Words to find, such as `part views` or `sdk.connect`."),
        limit: z.number().int().min(1).max(20).optional().describe("Pages to answer. Default 5."),
      }),
      annotations: READ_ONLY,
    },
    async (input) => answer(await searchDocs(input.query, origin, input.limit ?? 5)),
  );

  server.registerTool(
    "read_doc",
    {
      description: "Read one Nyte docs page as Markdown.",
      inputSchema: z.object({
        page: z
          .string()
          .describe(
            "The page's path from list_docs or search_docs, such as `sdk/guides/send-messages`; a /docs URL works too.",
          ),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      const page = findDoc(input.page);

      if (page === undefined)
        return {
          content: [
            {
              type: "text",
              text: `No docs page is at ${JSON.stringify(input.page)}. Find one with search_docs or list_docs.`,
            },
          ],
          isError: true,
        };

      return answer(`${await page.text()}\n\nSource: ${origin}${page.url}`);
    },
  );

  return server;
}

function answer(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function listDocs(): string {
  const pages = new Map(allDocs().map((page) => [page.url, page]));

  return [
    "# Nyte docs",
    ...docsNav.flatMap((section) => [
      "",
      `## ${section.label ?? "Get started"}`,
      ...section.items.map((item) => {
        const page = pages.get(item.href);
        const description = page?.description === undefined ? "" : `: ${page.description}`;

        return `- ${item.title} (\`${formatDocPath(item.href)}\`)${description}`;
      }),
    ]),
  ].join("\n");
}

async function searchDocs(query: string, origin: string, limit: number): Promise<string> {
  const hits = (await search.search(query, { limit: 60 })).filter((hit) =>
    hit.url.startsWith("/docs"),
  );

  const pages = new Map<string, string[]>();

  for (const hit of hits) {
    const url = hit.url.split("#")[0] ?? hit.url;
    const lines = pages.get(url) ?? [];
    const text = plain(hit.content);

    if (hit.type !== "page" && lines.length < 4 && text !== findPage(url)?.description)
      lines.push(
        `  - ${text.length > 200 ? `${text.slice(0, 199)}…` : text} (${origin}${hit.url})`,
      );
    pages.set(url, lines);
  }

  const found = [...pages].slice(0, limit).flatMap(([url, lines]) => {
    const page = findPage(url);

    return page === undefined
      ? []
      : [
          `- **${page.title}** (\`${formatDocPath(page.url)}\`)${page.description ? `: ${page.description}` : ""}`,
          ...lines,
        ];
  });

  return found.length === 0
    ? `Nothing in the docs matches ${JSON.stringify(query)}. Try other words, or list_docs.`
    : found.join("\n");
}

function findDoc(path: string): DocPage | undefined {
  const trimmed = path
    .trim()
    .replace(/^https?:\/\/[^/]+/u, "")
    .replace(/[#?].*$/u, "")
    .replace(/\.mdx?$/u, "")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/^docs\/?/u, "");

  return findPage(trimmed === "" ? "/docs" : `/docs/${trimmed}`);
}

function formatDocPath(url: string): string {
  return url.replace(/^\/docs\/?/u, "") || "index";
}

function plain(text: string): string {
  return text
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
