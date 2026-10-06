import type { ToolCallDensity } from "../preferences/index.ts";

type StepGroupContent = "closed" | "preview" | "open";

/**
 * Compact keeps live work behind a clipped window unless the reader opens it.
 * Detailed stays open, except settled reasoning, which folds to its header.
 * Balanced opens only while work is in flight.
 */
export function stepGroupContent(input: {
  readonly density: ToolCallDensity;
  readonly active: boolean;
  readonly open: boolean | undefined;
  readonly hasContent: boolean;
  readonly thinkingOnly: boolean;
}): StepGroupContent {
  if (input.open === true) return "open";

  if (input.active && input.density === "compact") return input.hasContent ? "preview" : "closed";

  if (input.open === false) return "closed";

  return input.active || (input.density === "detailed" && !input.thinkingOnly) ? "open" : "closed";
}
