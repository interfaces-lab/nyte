import { branchSummary, compaction, text, thinking, tool } from "../parts.ts";
import type { Plugin } from "../plugin.ts";

/** Contributes the built-in part definitions and their fallbacks (decision 13): the same objects the kernel's registry starts with, so loading it changes nothing; core-f loads it. */
export const partsPlugin: Plugin<"core"> = {
  id: "parts",
  contribute: { parts: [text, thinking, tool, compaction, branchSummary] },
};
