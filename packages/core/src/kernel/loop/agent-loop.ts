/**
 * One assistant turn in two public halves: generate an assistant response, then
 * execute or fail its tool batch. A durable runner commits between them.
 * Whether another turn follows is the caller's decision; nothing here loops.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/agent-loop.ts
 * Synced with pi d4edf066f.
 */

import { providerIdentity } from "@nyte-ai/ai";
import type { AssistantMessage, ToolResultMessage } from "@nyte-ai/ai/types";
import { validateToolArguments } from "@nyte-ai/ai/utils/validation";
import type { ToolReason } from "@nyte-ai/protocol";
import { normalizeContext } from "@nyte-ai/schema";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  ExecutableTool,
  ReadyToolCall,
  StreamFn,
  ToolCallOutcome,
} from "./types.ts";
import {
  stopReason,
  toolCallArguments,
  toolFailure,
  toolResultMessage,
  toolSuccess,
} from "./tool-result.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

type ToolUpdateSink = (partialResult: AgentToolResult<unknown>) => Promise<void> | void;

/** One call after its result message was emitted: the outcome it settled with and the message the model reads. */
export interface SettledToolCall {
  readonly toolCall: AgentToolCall;
  readonly outcome: ToolCallOutcome;
  readonly message: ToolResultMessage;
}

/**
 * Stream one assistant response and emit message_start, message_update, and
 * message_end. This is the first half of a turn. The request is the
 * transformed transcript as is: its system messages carry the prompt and the
 * tool declarations, so nothing is folded in here.
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
      ...providerIdentity(config.model),
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

  const llmContext = normalizeContext(
    context.checkpoint === undefined ? { messages } : { messages, checkpoint: context.checkpoint },
  );
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
): Promise<SettledToolCall[]> {
  const settled: SettledToolCall[] = [];

  for (const toolCall of toolCalls) {
    await emitToolExecutionStart(toolCall, emit);

    const finalized: FinalizedToolCall = {
      toolCall,
      outcome: toolFailure(
        `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
      ),
    };

    await emitToolExecutionEnd(finalized, emit);
    settled.push(await emitToolResultMessage(finalized, emit));
  }

  return settled;
}

/**
 * Execute the tool calls of an assistant message. Calls are prepared in
 * source order, then run concurrently; `tool_execution_end` arrives in
 * completion order and the result messages in source order. Every call
 * settles, whether it ran, was refused, or the batch was stopped; a tool
 * reads the signal and decides for itself. `onFinalized` persists a call
 * after result hooks and before its completion event. A persistence failure
 * rejects the batch.
 */
export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  onFinalized?: (toolCall: AgentToolCall, outcome: ToolCallOutcome) => Promise<void>,
): Promise<SettledToolCall[]> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  const finalizedCalls: Promise<FinalizedToolCall>[] = [];

  for (const toolCall of toolCalls) {
    await emitToolExecutionStart(toolCall, emit);

    const recovered = await config.recoverToolCall?.(toolCall);

    const preparation =
      recovered === undefined
        ? await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal)
        : { kind: "prepared" as const, toolCall, ...recovered };

    const completion = (async () => {
      const finalized =
        preparation.kind === "immediate"
          ? { toolCall, outcome: preparation.outcome }
          : await finalizeExecutedToolCall(
              currentContext,
              assistantMessage,
              preparation,
              await executePreparedToolCall(preparation, signal, (partialResult) =>
                emit({
                  type: "tool_execution_update",
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  args: toolCall.arguments,
                  partialResult,
                }),
              ),
              config,
              signal,
            );

      await onFinalized?.(toolCall, finalized.outcome);
      await emitToolExecutionEnd(finalized, emit);

      return finalized;
    })();

    // Later policy decisions may await input. Observe failures now; the
    // original promise still rejects the awaited batch below.
    void completion.catch(() => undefined);
    finalizedCalls.push(completion);
  }

  const settled: SettledToolCall[] = [];

  for (const finalized of await Promise.all(finalizedCalls)) {
    settled.push(await emitToolResultMessage(finalized, emit));
  }

  return settled;
}

type PreparedToolCall = ReadyToolCall & {
  readonly kind: "prepared";
  readonly toolCall: AgentToolCall;
};

type ImmediateToolCallOutcome = {
  kind: "immediate";
  outcome: ToolCallOutcome;
};

type FinalizedToolCall = { readonly toolCall: AgentToolCall; readonly outcome: ToolCallOutcome };

function prepareToolCallArguments(tool: AgentTool, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }

  const preparedArguments = tool.prepareArguments(toolCall.arguments);

  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }

  return {
    ...toolCall,
    arguments: toolCallArguments(preparedArguments),
  };
}

type ToolCallHooks = Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall">;

export interface RunToolCallOptions extends ToolCallHooks {
  tools: readonly ExecutableTool[];
  assistantMessage: AssistantMessage;
  context: AgentContext;
  signal?: AbortSignal;
  onUpdate?: ToolUpdateSink;
}

export async function runToolCall(
  toolCall: AgentToolCall,
  options: RunToolCallOptions,
): Promise<ToolCallOutcome> {
  const { context, assistantMessage, signal } = options;

  // Nothing durable stands behind a nested call: a stop before or during its
  // preparation keeps it from starting.
  const notStarted = (stopped: AbortSignal) =>
    toolFailure(`Tool call "${toolCall.name}" was not started.`, undefined, stopReason(stopped));

  if (signal?.aborted) return notStarted(signal);

  const preparation = await prepareToolCall(
    context,
    assistantMessage,
    toolCall,
    options,
    signal,
    options.tools,
  );
  if (preparation.kind === "immediate") return preparation.outcome;

  if (signal?.aborted) return notStarted(signal);

  const executed = await executePreparedToolCall(preparation, signal, options.onUpdate);
  const finalized = await finalizeExecutedToolCall(
    context,
    assistantMessage,
    preparation,
    executed,
    options,
    signal,
  );

  return finalized.outcome;
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: ToolCallHooks,
  signal: AbortSignal | undefined,
  tools: readonly ExecutableTool[] = currentContext.tools ?? [],
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  const tool = tools.find((t) => t.name === toolCall.name);

  if (!tool) {
    return { kind: "immediate", outcome: toolFailure(`Tool ${toolCall.name} not found`) };
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

      if (beforeResult?.block) {
        const cause: ToolReason = beforeResult.cause ?? { kind: "error" };

        return {
          kind: "immediate",
          outcome: toolFailure(
            cause.kind === "denied"
              ? `Tool call denied${beforeResult.reason ? `: ${beforeResult.reason}` : ""}`
              : beforeResult.reason || "Tool execution was blocked",
            undefined,
            cause,
          ),
        };
      }

      if (beforeResult?.args !== undefined) {
        validatedArgs = validateToolArguments(tool, {
          ...preparedToolCall,
          arguments: beforeResult.args,
        });
      }
    }

    return {
      kind: "prepared",
      toolCall,
      execute: (executionSignal, onUpdate) =>
        tool.execute(validatedArgs, {
          id: toolCall.id,
          signal: executionSignal ?? new AbortController().signal,
          update: onUpdate,
        }),
      args: validatedArgs,
    };
  } catch (error) {
    return { kind: "immediate", outcome: toolFailure(error) };
  }
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  onUpdate?: ToolUpdateSink,
): Promise<ToolCallOutcome> {
  const updateEvents: Promise<void>[] = [];
  let acceptingUpdates = true;
  let lastPartial: AgentToolResult<unknown> | undefined;

  try {
    const result = await prepared.execute(signal, (partialResult) => {
      if (!acceptingUpdates) return;
      lastPartial = partialResult;
      updateEvents.push(Promise.resolve(onUpdate?.(partialResult)));
    });

    acceptingUpdates = false;
    await Promise.all(updateEvents);

    return toolSuccess(result);
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updateEvents);

    // The settlement is self-contained: an abort or crash keeps the last
    // progress the tool reported instead of losing it.
    return toolFailure(error, lastPartial, signal?.aborted ? stopReason(signal) : undefined);
  } finally {
    acceptingUpdates = false;
  }
}

async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  prepared: Pick<PreparedToolCall, "toolCall" | "args">,
  executed: ToolCallOutcome,
  config: ToolCallHooks,
  signal: AbortSignal | undefined,
): Promise<FinalizedToolCall> {
  const { toolCall } = prepared;

  if (!config.afterToolCall) return { toolCall, outcome: executed };

  const { result } = executed;

  try {
    const afterResult = await config.afterToolCall(
      { assistantMessage, toolCall, args: prepared.args, context: currentContext, ...executed },
      signal,
    );

    if (!afterResult) return { toolCall, outcome: executed };
    const { outcome = executed, ...patch } = afterResult;

    return { toolCall, outcome: { ...outcome, result: { ...result, ...patch } } };
  } catch (error) {
    return {
      toolCall,
      outcome: toolFailure(error, {
        content: [],
        details: {},
        structuredContent: result.structuredContent,
      }),
    };
  }
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
  finalized: FinalizedToolCall,
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    ...finalized.outcome,
  });
}

async function emitToolResultMessage(
  finalized: FinalizedToolCall,
  emit: AgentEventSink,
): Promise<SettledToolCall> {
  const message = toolResultMessage(
    { toolCallId: finalized.toolCall.id, toolName: finalized.toolCall.name },
    finalized.outcome,
  );

  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });

  return { ...finalized, message };
}
