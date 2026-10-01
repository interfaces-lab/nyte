import type { AgentTool } from "./types.ts";

export function modelTools(tools: readonly AgentTool[], activated: readonly string[]): AgentTool[] {
  const names = new Set(activated);
  return tools.filter(
    (tool) =>
      tool.exposure !== "hidden" &&
      ((tool.exposure !== "codemode" && tool.exposure !== "deferred") || names.has(tool.name)),
  );
}

export function callableTools(tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(
    (tool) =>
      tool.exposure !== "hidden" &&
      tool.exposure !== "model-only" &&
      tool.name !== "codemode" &&
      tool.name !== "tool_search",
  );
}
