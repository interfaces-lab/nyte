import type { Message } from "@nyte-ai/schema";
import { runToolCall, type RunToolCallOptions } from "./agent-loop.ts";
import { callableTools } from "./tool-catalog.ts";
import { toolCallArguments, toolFailure } from "./tool-result.ts";
import { isToolWait, type AgentTool, type ToolRun } from "./types.ts";

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
    execute: async (input, call) => {
      let nextId = 1;
      let open = true;
      const activated = activation ?? new Set<string>();
      const { signal } = call;
      const run: ToolRun = {
        id: options.runId,
        head: options.head,
        parentToolCallId,
        history: options.history,
        tools: {
          list: () => callable,
          activate: (names) => {
            if (!open || signal.aborted) return;
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
              const prepared = toolCallArguments(params ?? {});
              const executionSignal =
                execution.signal === undefined
                  ? signal
                  : AbortSignal.any([signal, execution.signal]);
              return await runToolCall(
                { type: "toolCall", id: `${call.id}/${nextId++}`, name, arguments: prepared },
                {
                  ...options.call,
                  tools: callable.map((target) => nestedTool(target, call.id, activated)),
                  signal: executionSignal,
                  onUpdate: execution.onUpdate,
                },
              );
            } catch (error) {
              return toolFailure(error);
            }
          },
        },
      };
      try {
        const result = await tool.execute(input, { ...call, run });
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
      execute: async (input, call) => {
        try {
          return await wrapped.execute(input, call);
        } catch (error) {
          if (!isToolWait(error)) throw error;
          throw new Error(`Tool "${tool.name}" cannot wait during a nested invocation`);
        }
      },
    } satisfies AgentTool;
  };
  return options.tools.map((tool) => wrap(tool));
}
