import type { AgentTool } from "./types.ts";

export function modelTools<T extends AgentTool>(
  tools: readonly T[],
  activated: readonly string[],
): T[] {
  const names = new Set(activated);
  return tools.filter(
    (tool) =>
      tool.exposure !== "hidden" &&
      ((tool.exposure !== "codemode" && tool.exposure !== "deferred") || names.has(tool.name)),
  );
}

export function callableTools<T extends AgentTool>(tools: readonly T[]): T[] {
  return tools.filter(
    (tool) =>
      tool.exposure !== "hidden" &&
      tool.exposure !== "model-only" &&
      tool.name !== "codemode" &&
      tool.name !== "tool_search",
  );
}
