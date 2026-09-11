import { createToolArgumentParser } from "@nyte-ai/ai/utils/validation";
import type { TSchema } from "typebox";
import type { AgentTool } from "../types.ts";

/** Keeps validation paired with execution through registry, durable, and jobs wrappers. */
export function bindTool<T extends TSchema, Details>(
  tool: AgentTool<T, Details>,
): AgentTool<TSchema, Details> {
  const parse = createToolArgumentParser(tool);
  return {
    ...tool,
    execute: (callId, args, signal, onUpdate, context) =>
      tool.execute(callId, parse(args), signal, onUpdate, context),
  };
}
