import type { CodemodeSandboxOptions } from "@earendil-works/pi-codemode";
import { CODEMODE_SOURCE_GRAMMAR } from "@earendil-works/pi-codemode/source";
import { definePlugin } from "@nyte-ai/core/plugins";
import { Type } from "typebox";
import {
  CODEMODE_DESCRIPTION,
  CODEMODE_TOOL_NAME,
  renderCodemodeInstructions,
} from "./codemode-declarations.ts";
import { executeCodemode } from "./codemode-execute.ts";
import {
  Bm25Ranker,
  createToolSearchDocument,
  DEFAULT_TOOL_SEARCH_LIMIT,
  TOOL_SEARCH_DESCRIPTION,
  TOOL_SEARCH_TOOL_NAME,
  toolSearchSchema,
} from "./codemode-search.ts";

export const codemodeSchema = Type.Object({
  code: Type.String({ description: "Raw JavaScript source." }),
});

export function codemodePlugin(options: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm"> = {}) {
  return definePlugin({
    id: "codemode",
    session(api) {
      api.prompt.add((prompt) => {
        const tools = api.tools.list();
        if (!tools.some((tool) => tool.name === CODEMODE_TOOL_NAME)) return;
        prompt.set("codemode", { text: renderCodemodeInstructions(tools), order: 4 });
      });
      api.tools.add(CODEMODE_TOOL_NAME, {
        label: CODEMODE_TOOL_NAME,
        description: CODEMODE_DESCRIPTION,
        parameters: codemodeSchema,
        constrainedSampling: {
          type: "grammar",
          variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR },
        },
        exposure: "model-only",
        replay: "never",
        execute: ({ code }, call) => executeCodemode({ code, call, runtime: options }),
      });
      api.tools.add(TOOL_SEARCH_TOOL_NAME, {
        label: TOOL_SEARCH_TOOL_NAME,
        description: TOOL_SEARCH_DESCRIPTION,
        parameters: toolSearchSchema,
        exposure: "model-only",
        replay: "safe",
        async execute({ query, limit }, call) {
          if (query.trim() === "") throw new Error("query must not be empty");
          const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
          if (!Number.isInteger(max) || max <= 0)
            throw new Error("limit must be a positive integer");
          const { run } = call;
          if (run === undefined) throw new Error("Tool discovery requires a run");
          const history = await run.history();
          const active = new Set(
            history.flatMap((message) =>
              message.role === "toolResult" && !message.isError
                ? (message.addedToolNames ?? [])
                : [],
            ),
          );
          const candidates = run.tools
            .list()
            .filter(
              (tool) =>
                (tool.exposure === "codemode" || tool.exposure === "deferred") &&
                !active.has(tool.name),
            );
          const documents = candidates.map((tool) =>
            createToolSearchDocument(tool, tool.namespace),
          );
          const matches = new Bm25Ranker().rank(query, documents, max);
          const loaded = matches.map((match) => match.name);
          if (loaded.length > 0) run.tools.activate(loaded);
          const found = matches.map((match) => ({
            name: match.name,
            description: candidates.find((tool) => tool.name === match.name)?.description ?? "",
          }));
          const text =
            found.length === 0
              ? "No matching tools found."
              : `Loaded ${found.length} tool${found.length === 1 ? "" : "s"}. They are available from your next call:\n${found.map((tool) => `- ${tool.name}: ${tool.description.trim().split("\n", 1)[0] ?? ""}`).join("\n")}`;
          return {
            content: [{ type: "text", text }],
            details: { loaded },
          };
        },
      });
    },
  });
}
