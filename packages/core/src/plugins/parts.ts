import type { Plugin } from "../plugin.ts";

/** Contributes the built-in part definitions and their fallbacks (decision 13); core-f loads it. Empty until core-d's implement phase gives `text`, `thinking`, `tool`, `compaction` and `branchSummary` their schemas. */
export const partsPlugin: Plugin<"core"> = { id: "parts", contribute: { parts: [] } };
