import type { CodemodeSandboxOptions } from "@earendil-works/pi-codemode";
import { CODEMODE_SOURCE_GRAMMAR } from "@earendil-works/pi-codemode/source";
import { definePlugin } from "@nyte-ai/core/plugins";
import { Type } from "typebox";
import { CODEMODE_DESCRIPTION, CODEMODE_TOOL_NAME } from "./codemode-declarations.ts";
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
      api.tools.add((draft) => {
        draft.set(CODEMODE_TOOL_NAME, {
          name: CODEMODE_TOOL_NAME,
          label: CODEMODE_TOOL_NAME,
          description: CODEMODE_DESCRIPTION,
          parameters: codemodeSchema,
          constrainedSampling: {
            type: "grammar",
            variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR },
          },
          exposure: "model-only",
          replay: "never",
          execute: (toolCallId, params, signal, onUpdate, context) => {
            if (context?.tools === undefined || context.history === undefined)
              throw new Error("Code mode requires a live session");
            return executeCodemode({
              toolCallId,
              code: params.code,
              signal,
              onUpdate,
              context,
              runtime: options,
            });
          },
        });
        draft.set(TOOL_SEARCH_TOOL_NAME, {
          name: TOOL_SEARCH_TOOL_NAME,
          label: TOOL_SEARCH_TOOL_NAME,
          description: TOOL_SEARCH_DESCRIPTION,
          parameters: toolSearchSchema,
          exposure: "model-only",
          replay: "safe",
          async execute(_toolCallId, { query, limit }, _signal, _onUpdate, context) {
            if (query.trim() === "") throw new Error("query must not be empty");
            const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
            if (!Number.isInteger(max) || max <= 0)
              throw new Error("limit must be a positive integer");
            if (context?.tools === undefined || context.history === undefined)
              throw new Error("Tool discovery requires a live session");
            const inventory = context.tools;
            const history = await context.history();
            const active = new Set(
              history.flatMap((message) =>
                message.role === "toolResult" && !message.isError
                  ? (message.addedToolNames ?? [])
                  : [],
              ),
            );
            const candidates = inventory
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
            if (loaded.length > 0) inventory.activate(loaded);
            const found = matches.map((match) => ({
              name: match.name,
              description: candidates.find((tool) => tool.name === match.name)?.description ?? "",
            }));
            const text =
              found.length === 0
                ? "No matching tools found."
                : `Loaded ${found.length} tool${found.length === 1 ? "" : "s"}. They are available from your next call:\n${found.map((tool) => `- ${tool.name}: ${tool.description.trim().split(/\r?\n/)[0]}`).join("\n")}`;
            return {
              content: [{ type: "text", text }],
              details: { loaded },
            };
          },
        });
      });
    },
  });
}
