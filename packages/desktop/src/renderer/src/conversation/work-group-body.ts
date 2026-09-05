import type { ToolCallDensity } from "../theme/boot.ts";

export type WorkGroupReveal = "default" | "open" | "closed";
export type WorkGroupBody = "none" | "preview" | "list";

/**
 * Compact keeps work behind a clipped window while the run is live.
 * Detailed stays open. Balanced opens only while work is in flight.
 */
export function workGroupBody(input: {
  readonly density: ToolCallDensity;
  readonly active: boolean;
  readonly reveal: WorkGroupReveal;
  readonly hasContent: boolean;
}): WorkGroupBody {
  if (input.reveal === "open") return "list";
  if (input.reveal === "default" && input.density === "detailed") return "list";
  if (input.reveal === "default" && input.active && input.density !== "compact") return "list";
  if (input.active && input.density === "compact" && input.hasContent) return "preview";
  return "none";
}

export function isAtScrollBottom(input: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): boolean {
  return input.scrollTop + input.clientHeight >= input.scrollHeight - 5;
}
