import { isJsonObject, toJsonValue } from "@nyte-ai/client";
import type { Message } from "@nyte-ai/schema";
import { runToolCall, type RunToolCallOptions } from "./agent-loop.ts";
import { callableTools } from "./tool-catalog.ts";
import { toolErrorResult } from "./tool-result.ts";
import { isToolWait, type AgentTool, type ToolExecutionContext } from "./types.ts";

export function liveTools(options: {
  tools: readonly AgentTool[];
  runId: string;
  head: string;
  history: () => Promise<readonly Message[]>;
  call: Omit<RunToolCallOptions, "tools" | "signal" | "onUpdate">;
}): AgentTool[] {
  const callable = callableTools(options.tools);
  const wrap = (
    tool: AgentTool,
    parentToolCallId?: string,
    activation?: Set<string>,
  ): AgentTool => ({
    ...tool,
    execute: async (callId, args, signal, onUpdate) => {
      let nextId = 1;
      let open = true;
      const activated = activation ?? new Set<string>();
      const context: ToolExecutionContext = {
        runId: options.runId,
        head: options.head,
        parentToolCallId,
        history: options.history,
        tools: {
          list: () => callable,
          activate: (names) => {
            if (!open || signal?.aborted) return;
            for (const name of names) {
              const target = callable.find((candidate) => candidate.name === name);
              if (target?.exposure === "codemode" || target?.exposure === "deferred") {
                activated.add(name);
              }
            }
          },
          execute: async (name, params, execution = {}) => {
            try {
              if (!open) throw new Error("Tool invocation has already completed");
              const prepared = toJsonValue(params ?? {});
              if (!isJsonObject(prepared)) throw new Error("Tool arguments must be an object");
              const executionSignal =
                signal === undefined
                  ? execution.signal
                  : execution.signal === undefined
                    ? signal
                    : AbortSignal.any([signal, execution.signal]);
              return await runToolCall(
                { type: "toolCall", id: `${callId}/${nextId++}`, name, arguments: prepared },
                {
                  ...options.call,
                  tools: callable.map((target) => nestedTool(target, callId, activated)),
                  signal: executionSignal,
                  onUpdate: execution.onUpdate,
                },
              );
            } catch (error) {
              return { result: toolErrorResult(error), isError: true };
            }
          },
        },
      };
      try {
        const result = await tool.execute(callId, args, signal, onUpdate, context);
        if (activated.size === 0) return result;
        return {
          ...result,
          addedToolNames: [...new Set([...(result.addedToolNames ?? []), ...activated])],
        };
      } finally {
        open = false;
      }
    },
  });
  const nestedTool = (
    tool: AgentTool,
    parentToolCallId: string,
    activation: Set<string>,
  ): AgentTool => {
    const wrapped = wrap(tool, parentToolCallId, activation);
    return {
      ...wrapped,
      execute: async (...args: Parameters<AgentTool["execute"]>) => {
        try {
          return await wrapped.execute(...args);
        } catch (error) {
          if (!isToolWait(error)) throw error;
          throw new Error(`Tool "${tool.name}" cannot wait during a nested invocation`);
        }
      },
    } satisfies AgentTool;
  };
  return options.tools.map((tool) => wrap(tool));
}
