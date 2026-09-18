/**
 * One assistant turn in two public halves: generate an assistant response, then
 * execute or fail its tool batch. A durable runner commits between them.
 * Whether another turn follows is the caller's decision; nothing here loops.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/agent-loop.ts
 * Synced with pi d4edf066f.
 */

import type { AssistantMessage, Context, ToolResultMessage } from "@nyte-ai/ai/types";
import { validateToolArguments } from "@nyte-ai/ai/utils/validation";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  StreamFn,
} from "./types.ts";
import { toolErrorResult } from "./tool-result.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * Stream one assistant response and emit message_start, message_update, and
 * message_end. This is the first half of a turn.
 */
export async function generateAssistant(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn: StreamFn,
): Promise<AssistantMessage> {
  const messages =
    signal?.aborted || config.transformContext === undefined
      ? context.messages
      : await config.transformContext(context.messages, signal);
  if (signal?.aborted) {
    const message: AssistantMessage = {
      role: "assistant",
      content: [],
      api: config.model.api,
      provider: config.model.provider,
      model: config.model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "aborted",
      timestamp: Date.now(),
    };
    await emit({ type: "message_start", message });
    await emit({ type: "message_end", message });
    return message;
  }
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages,
    tools: context.tools,
  };
  if (context.checkpoint !== undefined) llmContext.checkpoint = context.checkpoint;
  const response = await streamFn(config.model, llmContext, { ...config, signal });

  let partial: AssistantMessage | undefined;
  for await (const event of response) {
    if (event.type === "done" || event.type === "error") break;
    if (event.type === "start") {
      partial = event.partial;
      await emit({ type: "message_start", message: { ...partial } });
    } else if (partial !== undefined) {
      partial = event.partial;
      await emit({ type: "message_update", assistantMessageEvent: event, message: { ...partial } });
    }
  }
  const finalMessage = await response.result();
  if (partial === undefined) await emit({ type: "message_start", message: { ...finalMessage } });
  await emit({ type: "message_end", message: finalMessage });
  return finalMessage;
}

/**
 * Fail all tool calls from an assistant message that was truncated by the
 * output token limit. Streamed tool-call arguments are finalized with a
 * best-effort JSON salvage parser, so a truncated message can yield tool calls
 * whose arguments parse and validate but are silently incomplete. None of them
 * are safe to execute; report each as an error so the model can re-issue them.
 */
export async function failToolCallsFromTruncatedMessage(
  toolCalls: AgentToolCall[],
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const messages: ToolResultMessage[] = [];
  for (const toolCall of toolCalls) {
    await emitToolExecutionStart(toolCall, emit);
    const finalized: FinalizedToolCallOutcome = {
      toolCall,
      result: createErrorToolResult(
        `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
      ),
      isError: true,
    };
    await emitToolExecutionEnd(finalized, emit);
    messages.push(await emitToolResultMessage(finalized, emit));
  }
  return messages;
}

/**
 * Execute the tool calls of an assistant message. Calls are prepared in
 * source order, then run concurrently; `tool_execution_end` arrives in
 * completion order and the result messages in source order. The runner also
 * calls this directly to settle calls an interrupted run left unstarted.
 * `onFinalized` persists a call after result hooks and before its completion
 * event. A persistence failure rejects the batch.
 */
export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  onFinalized?: (outcome: FinalizedToolCallOutcome) => Promise<void>,
): Promise<ToolResultMessage[]> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  const finalizedCalls: Promise<FinalizedToolCallOutcome>[] = [];
  for (const toolCall of toolCalls) {
    await emitToolExecutionStart(toolCall, emit);
    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal,
    );
    if (preparation.kind === "immediate") {
      const finalized = { toolCall, result: preparation.result, isError: preparation.isError };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(Promise.resolve(finalized));
    } else {
      const completion = (async () => {
        const executed = await executePreparedToolCall(preparation, signal, emit);
        const finalized = await finalizeExecutedToolCall(
          currentContext,
          assistantMessage,
          preparation,
          executed,
          config,
          signal,
        );
        await onFinalized?.(finalized);
        await emitToolExecutionEnd(finalized, emit);
        return finalized;
      })();
      // Later policy decisions may await input. Observe failures now; the
      // original promise still rejects the awaited batch below.
      void completion.catch(() => undefined);
      finalizedCalls.push(completion);
    }
    if (signal?.aborted) break;
  }
  const messages: ToolResultMessage[] = [];
  for (const finalized of await Promise.all(finalizedCalls)) {
    messages.push(await emitToolResultMessage(finalized, emit));
  }
  return messages;
}

type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  execute: (
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback,
  ) => Promise<AgentToolResult<unknown>>;
  args: unknown;
};

type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<unknown>;
  isError: boolean;
};

type ExecutedToolCallOutcome = {
  result: AgentToolResult<unknown>;
  isError: boolean;
};

type FinalizedToolCallOutcome = {
  toolCall: AgentToolCall;
  result: AgentToolResult<unknown>;
  isError: boolean;
};

function isAgentToolArguments(value: unknown): value is AgentToolCall["arguments"] {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prepareToolCallArguments(tool: AgentTool, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  if (!isAgentToolArguments(preparedArguments)) {
    throw new Error("Prepared tool arguments must be an object");
  }
  return {
    ...toolCall,
    arguments: preparedArguments,
  };
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    let validatedArgs = validateToolArguments(tool, preparedToolCall);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal,
      );
      if (signal?.aborted) {
        return {
          kind: "immediate",
          result: createErrorToolResult("Operation aborted"),
          isError: true,
        };
      }
      if (beforeResult?.block) {
        return {
          kind: "immediate",
          result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
          isError: true,
        };
      }
      if (beforeResult?.args !== undefined) {
        validatedArgs = validateToolArguments(tool, {
          ...preparedToolCall,
          arguments: beforeResult.args,
        });
      }
    }
    if (signal?.aborted) {
      return {
        kind: "immediate",
        result: createErrorToolResult("Operation aborted"),
        isError: true,
      };
    }
    return {
      kind: "prepared",
      toolCall,
      execute: (executionSignal, onUpdate) =>
        tool.execute(toolCall.id, validatedArgs, executionSignal, onUpdate),
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: toolErrorResult(error),
      isError: true,
    };
  }
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
  const updateEvents: Promise<void>[] = [];
  let acceptingUpdates = true;
  let lastPartial: AgentToolResult<unknown> | undefined;

  try {
    const result = await prepared.execute(signal, (partialResult) => {
      if (!acceptingUpdates) return;
      lastPartial = partialResult;
      updateEvents.push(
        Promise.resolve(
          emit({
            type: "tool_execution_update",
            toolCallId: prepared.toolCall.id,
            toolName: prepared.toolCall.name,
            args: prepared.toolCall.arguments,
            partialResult,
          }),
        ),
      );
    });
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return { result, isError: false };
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    // The settlement is self-contained: an abort or crash keeps the last
    // progress the tool reported instead of losing it.
    return { result: toolErrorResult(error, lastPartial), isError: true };
  } finally {
    acceptingUpdates = false;
  }
}

async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  prepared: PreparedToolCall,
  executed: ExecutedToolCallOutcome,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context: currentContext,
        },
        signal,
      );
      if (afterResult) {
        result = {
          ...result,
          content: afterResult.content ?? result.content,
          details: afterResult.details === undefined ? result.details : afterResult.details,
          usage: afterResult.usage ?? result.usage,
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = toolErrorResult(error);
      isError = true;
    }
  }

  return {
    toolCall: prepared.toolCall,
    result,
    isError,
  };
}

function createErrorToolResult(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

async function emitToolExecutionStart(
  toolCall: AgentToolCall,
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: "tool_execution_start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments,
  });
}

async function emitToolExecutionEnd(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

/**
 * The settlement message for one tool call: what the model reads back and
 * what the session log stores. Every settlement, live or recovered, is built
 * here so the two never drift.
 */
export function toolResultMessage(
  call: { readonly toolCallId: string; readonly toolName: string },
  result: AgentToolResult<unknown>,
  isError: boolean,
): ToolResultMessage {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    // Untyped tools (JS extensions) can return results without content; normalize
    // so the null never enters session history or provider payloads.
    content: result.content ?? [],
    details: result.details,
    isError,
    timestamp: Date.now(),
  };
  if (result.title !== undefined) message.title = result.title;
  if (result.usage !== undefined) message.usage = result.usage;
  if (result.addedToolNames !== undefined && result.addedToolNames.length > 0) {
    message.addedToolNames = result.addedToolNames;
  }
  return message;
}

async function emitToolResultMessage(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  const message = toolResultMessage(
    { toolCallId: finalized.toolCall.id, toolName: finalized.toolCall.name },
    finalized.result,
    finalized.isError,
  );
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
  return message;
}
