import type { ToolCallDensity } from "../theme/boot.ts";

export type WorkGroupReveal = "default" | "open" | "closed";

type WorkGroupBody = "none" | "preview" | "list";

/**
 * Compact keeps live work behind a clipped window unless the reader opens it.
 * Detailed stays open. Balanced opens only while work is in flight.
 */
export function workGroupBody(input: {
  readonly density: ToolCallDensity;
  readonly active: boolean;
  readonly reveal: WorkGroupReveal;
  readonly hasContent: boolean;
}): WorkGroupBody {
  if (input.reveal === "open") return "list";

  if (input.active && input.density === "compact") return input.hasContent ? "preview" : "none";

  if (input.reveal === "closed") return "none";

  return input.active || input.density === "detailed" ? "list" : "none";
}
