import { createToolArgumentParser } from "@nyte-ai/ai/utils/validation";
import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "../kernel/loop/types.ts";
import { normalizeImageContent } from "../kernel/loop/image.ts";
import { ToolError } from "../kernel/loop/tool-result.ts";

/**
 * A tool result enters session history and then every later provider request,
 * so images from extensions, MCP bridges, and screenshot tools are bounded
 * here rather than trusted. `read` already bounded its own attachment; a
 * payload that is already within limits passes through untouched.
 */
async function boundImages<Details>(
  result: AgentToolResult<Details>,
): Promise<AgentToolResult<Details>> {
  const content = await normalizeImageContent(result.content);
  if (content === result.content) return result;
  return { ...result, content: [...content] };
}

/** Keeps validation paired with execution through registry, durable, and jobs wrappers. */
export function bindTool<T extends TSchema, Details>(
  tool: AgentTool<T, Details>,
): AgentTool<TSchema, Details> {
  const parse = createToolArgumentParser(tool);
  const present = tool.present;
  return {
    ...tool,
    present:
      present === undefined
        ? undefined
        : (args, context, result) => present(parse(args), context, result),
    execute: async (callId, args, signal, onUpdate, context) => {
      try {
        return await boundImages(
          await tool.execute(callId, parse(args), signal, onUpdate, context),
        );
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        throw new ToolError(await boundImages(error.result));
      }
    },
  };
}
