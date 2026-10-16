/**
 * The Responses API event stream processor, shared by the OpenAI Responses and
 * Codex adapters.
 */
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { calculateCost } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import {
  parseStreamingJson,
  parseToolCallArguments,
  unfinishedToolCallArguments,
} from "../utils/json-parse.ts";
import {
  appendGrammarToolInputJsonDelta,
  type GrammarToolInputJsonBuffer,
} from "./constrained-sampling.ts";
import { emptyCost, stripStreamingScratchState } from "./assistant-stream.ts";
import { TokenCount } from "./token-count.ts";
import { encodeTextSignatureV1 } from "./openai-responses-convert.ts";
import {
  type ResponsesOutputItem,
  type ResponsesServiceTier,
  type ResponsesStatus,
  ResponsesStreamEventCheck,
  type ResponsesTerminalResponse,
  ServiceTierSchema,
  StoredReasoningItemSchema,
  TerminalReasoningItemSchema,
} from "./openai-responses-events.ts";

export function withPriorityTier<
  O extends { fast?: boolean; serviceTier?: ResponseCreateParamsStreaming["service_tier"] },
>(options: O | undefined): O | undefined {
  return options?.fast === true && options.serviceTier === undefined
    ? { ...options, serviceTier: "priority" }
    : options;
}

export interface OpenAIResponsesStreamOptions {
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  grammarToolInputProperties?: ReadonlyMap<string, string>;
  resolveServiceTier?: (
    responseServiceTier: ResponsesServiceTier | undefined,
    requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  ) => ResponsesServiceTier | undefined;
  applyServiceTierPricing?: (usage: Usage, serviceTier: ResponsesServiceTier | undefined) => void;
}

export class ResponsesUsageError extends Error {}

const responseUsage = Type.Object({
  input_tokens: Type.Optional(TokenCount),
  output_tokens: Type.Optional(TokenCount),
  total_tokens: Type.Optional(TokenCount),
  input_tokens_details: Type.Optional(
    Type.Object({
      cached_tokens: Type.Optional(TokenCount),
      cache_write_tokens: Type.Optional(TokenCount),
    }),
  ),
  output_tokens_details: Type.Optional(
    Type.Object({ reasoning_tokens: Type.Optional(TokenCount) }),
  ),
});

type StreamingToolCall = ToolCall & {
  partialJson?: string;
  customInput?: {
    property: string;
    input: string;
    jsonBuffer: GrammarToolInputJsonBuffer;
  };
};

function appendCustomToolCallInput(
  block: StreamingToolCall,
  nextInput: string,
  close: boolean,
): string | undefined {
  const customInput = block.customInput;

  if (!customInput) return undefined;

  const delta = appendGrammarToolInputJsonDelta(
    customInput.jsonBuffer,
    customInput.property,
    nextInput,
    close,
  );

  customInput.input = nextInput;
  block.arguments = { [customInput.property]: nextInput };

  return delta;
}

type ResponsesOutputSlot =
  | { type: "thinking"; block: ThinkingContent; contentIndex: number }
  | { type: "text"; block: TextContent; contentIndex: number }
  | { type: "toolCall"; block: StreamingToolCall; contentIndex: number };

type ToolCallOutputSlot = Extract<ResponsesOutputSlot, { type: "toolCall" }>;

/**
 * Maps a Responses event stream onto `output`. Each raw event is checked against the event
 * schemas first; others are skipped.
 *
 * - A tool call whose `output_item.done` never arrived may have cut-off or mixed-up arguments,
 *   e.g. when a non-compliant server omits `output_index`: a `toolUse` stop with one fails the
 *   stream, and any other stop marks it with `argumentsError` so it is reported, not run.
 *   Finished calls drop their scratch buffers, so replay carries only parsed arguments.
 * - Azure OpenAI can omit `encrypted_content` from `output_item.done` and send it only in the
 *   terminal response's output; it is backfilled into the stored reasoning item, keeping
 *   `store: false` multi-turn replay stateless.
 * - `input_tokens` includes cached and cache-write tokens, so both are subtracted.
 * - An incomplete response keeps its specific reason in `rawStopReason`, so output truncation
 *   and content filtering stay distinct.
 */
export async function processResponsesStream<TApi extends Api>(
  openaiStream: AsyncIterable<unknown>,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model: Model<TApi>,
  options?: OpenAIResponsesStreamOptions,
): Promise<void> {
  let sawTerminalResponseEvent = false;
  const outputSlots = new Map<number | undefined, ResponsesOutputSlot>();
  const unfinishedToolCalls = new Set<StreamingToolCall>();
  const reasoningBlocksById = new Map<string, ThinkingContent>();

  const applyMessagePhaseStopReason = (item: ResponsesOutputItem): void => {
    if (item.type === "message" && item.phase === "final_answer") {
      output.stopReason = "stop";
    }
  };

  const pushToolCallDelta = (slot: ToolCallOutputSlot, delta: string | undefined): void => {
    if (delta === undefined) return;
    stream.push({
      type: "toolcall_delta",
      contentIndex: slot.contentIndex,
      delta,
      partial: output,
    });
  };

  const createSlot = (
    outputIndex: number | undefined,
    item: ResponsesOutputItem,
  ): ResponsesOutputSlot | undefined => {
    if (item.type === "reasoning") {
      const block: ThinkingContent = { type: "thinking", thinking: "" };
      output.content.push(block);

      const slot = {
        type: "thinking",
        block,
        contentIndex: output.content.length - 1,
      } satisfies ResponsesOutputSlot;

      outputSlots.set(outputIndex, slot);
      stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    if (item.type === "message") {
      applyMessagePhaseStopReason(item);
      const block: TextContent = { type: "text", text: "" };
      output.content.push(block);

      const slot = {
        type: "text",
        block,
        contentIndex: output.content.length - 1,
      } satisfies ResponsesOutputSlot;

      outputSlots.set(outputIndex, slot);
      stream.push({ type: "text_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    if (item.type === "function_call") {
      const block: StreamingToolCall = {
        type: "toolCall",
        id: `${item.call_id}|${item.id ?? ""}`,
        name: item.name,
        arguments: {},
        partialJson: item.arguments || "",
      };

      if (item.namespace !== undefined) block.namespace = item.namespace;

      output.content.push(block);

      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1,
      } satisfies ResponsesOutputSlot;

      outputSlots.set(outputIndex, slot);
      unfinishedToolCalls.add(block);
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    if (item.type === "custom_tool_call") {
      const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
      const input = item.input || "";

      const block: StreamingToolCall = {
        type: "toolCall",
        id: `${item.call_id}|${item.id ?? ""}`,
        name: item.name,
        arguments: { [inputProperty]: input },
        customInput: {
          property: inputProperty,
          input,
          jsonBuffer: { input: "", started: false, closed: false },
        },
      };

      if (item.namespace !== undefined) block.namespace = item.namespace;

      output.content.push(block);

      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1,
      } satisfies ResponsesOutputSlot;

      outputSlots.set(outputIndex, slot);
      unfinishedToolCalls.add(block);
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    return undefined;
  };

  const getOrCreateSlot = (
    outputIndex: number | undefined,
    item: ResponsesOutputItem,
  ): ResponsesOutputSlot | undefined => {
    return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
  };

  const backfillReasoningSignatures = (responseOutput: readonly unknown[]): void => {
    for (const item of responseOutput) {
      if (!Value.Check(TerminalReasoningItemSchema, item) || !item.encrypted_content) continue;
      const block = reasoningBlocksById.get(item.id);

      if (!block?.thinkingSignature) continue;
      const storedItem: unknown = JSON.parse(block.thinkingSignature);

      if (!Value.Check(StoredReasoningItemSchema, storedItem) || storedItem.encrypted_content) {
        continue;
      }

      block.thinkingSignature = JSON.stringify({
        ...storedItem,
        encrypted_content: item.encrypted_content,
      });
    }
  };

  const finalizeResponse = (response: ResponsesTerminalResponse): void => {
    sawTerminalResponseEvent = true;
    backfillReasoningSignatures(response.output ?? []);

    if (response?.id) {
      output.responseId = response.id;
    }

    const usage = response.usage;

    if (usage !== undefined && usage !== null) {
      if (!Value.Check(responseUsage, usage)) {
        throw new ResponsesUsageError(
          "Invalid OpenAI Responses usage: expected finite non-negative integer token counts",
        );
      }

      const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
      const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens ?? 0;
      output.usage = {
        input: Math.max(0, (usage.input_tokens ?? 0) - cachedTokens - cacheWriteTokens),
        output: usage.output_tokens ?? 0,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        cost: emptyCost(),
      };
    }

    calculateCost(model, output.usage);

    if (options?.applyServiceTierPricing) {
      const responseTier = Value.Check(ServiceTierSchema, response.service_tier)
        ? response.service_tier
        : undefined;
      const serviceTier = options.resolveServiceTier
        ? options.resolveServiceTier(responseTier, options.serviceTier)
        : (responseTier ?? options.serviceTier);

      options.applyServiceTierPricing(output.usage, serviceTier);
    }

    const status = response?.status;
    const incompleteReason = response.incomplete_details?.reason;
    output.rawStopReason = incompleteReason ? `${status}.${incompleteReason}` : status;
    const mappedStop = mapStopReason(status, incompleteReason);
    output.stopReason = mappedStop.stopReason;
    output.errorMessage = mappedStop.errorMessage;

    if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
      output.stopReason = "toolUse";
    }
  };

  for await (const event of openaiStream) {
    if (!ResponsesStreamEventCheck.Check(event)) continue;

    if (event.type === "response.created") {
      output.responseId = event.response.id;
    } else if (event.type === "response.output_item.added") {
      createSlot(event.output_index, event.item);
    } else if (event.type === "response.reasoning_summary_text.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "thinking") continue;
      slot.block.thinking += event.delta;
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
    } else if (event.type === "response.reasoning_summary_part.done") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "thinking") continue;
      slot.block.thinking += "\n\n";
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: "\n\n",
        partial: output,
      });
    } else if (event.type === "response.reasoning_text.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "thinking") continue;
      slot.block.thinking += event.delta;
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
    } else if (event.type === "response.output_text.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "text") continue;
      slot.block.text += event.delta;
      stream.push({
        type: "text_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
    } else if (event.type === "response.refusal.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "text") continue;
      slot.block.text += event.delta;
      stream.push({
        type: "text_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
    } else if (event.type === "response.function_call_arguments.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "toolCall" || slot.block.partialJson === undefined) continue;
      slot.block.partialJson += event.delta;
      slot.block.arguments = parseStreamingJson(slot.block.partialJson);
      pushToolCallDelta(slot, event.delta);
    } else if (event.type === "response.function_call_arguments.done") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "toolCall" || slot.block.partialJson === undefined) continue;
      const previousPartialJson = slot.block.partialJson;
      slot.block.partialJson = event.arguments;
      slot.block.arguments = parseStreamingJson(slot.block.partialJson);

      if (event.arguments.startsWith(previousPartialJson)) {
        const delta = event.arguments.slice(previousPartialJson.length);

        if (delta.length > 0) pushToolCallDelta(slot, delta);
      }
    } else if (event.type === "response.custom_tool_call_input.delta") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "toolCall" || !slot.block.customInput) continue;
      pushToolCallDelta(
        slot,
        appendCustomToolCallInput(slot.block, slot.block.customInput.input + event.delta, false),
      );
    } else if (event.type === "response.custom_tool_call_input.done") {
      const slot = outputSlots.get(event.output_index);

      if (slot?.type !== "toolCall" || !slot.block.customInput) continue;
      pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, event.input, true));
    } else if (event.type === "response.output_item.done") {
      const item = event.item;
      applyMessagePhaseStopReason(item);
      const slot = getOrCreateSlot(event.output_index, item);

      if (item.type === "reasoning" && slot?.type === "thinking") {
        const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
        const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
        slot.block.thinking = summaryText || contentText || slot.block.thinking;
        slot.block.thinkingSignature = JSON.stringify(item);
        reasoningBlocksById.set(item.id, slot.block);
        stream.push({
          type: "thinking_end",
          contentIndex: slot.contentIndex,
          content: slot.block.thinking,
          partial: output,
        });
        outputSlots.delete(event.output_index);
      } else if (item.type === "message" && slot?.type === "text") {
        slot.block.text =
          item.content?.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("") || "";
        if (item.id !== undefined) {
          slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
        }

        stream.push({
          type: "text_end",
          contentIndex: slot.contentIndex,
          content: slot.block.text,
          partial: output,
        });
        outputSlots.delete(event.output_index);
      } else if (
        item.type === "function_call" &&
        slot?.type === "toolCall" &&
        slot.block.partialJson !== undefined
      ) {
        Object.assign(slot.block, parseToolCallArguments(item.arguments || slot.block.partialJson));

        if (item.namespace !== undefined) slot.block.namespace = item.namespace;
        delete slot.block.partialJson;
        unfinishedToolCalls.delete(slot.block);
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output,
        });
        outputSlots.delete(event.output_index);
      } else if (
        item.type === "custom_tool_call" &&
        slot?.type === "toolCall" &&
        slot.block.customInput
      ) {
        pushToolCallDelta(
          slot,
          appendCustomToolCallInput(slot.block, item.input ?? slot.block.customInput.input, true),
        );

        if (item.namespace !== undefined) slot.block.namespace = item.namespace;
        delete slot.block.customInput;
        unfinishedToolCalls.delete(slot.block);
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output,
        });
        outputSlots.delete(event.output_index);
      }
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
      finalizeResponse(event.response);
    } else if (event.type === "error") {
      throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
    } else if (event.type === "response.failed") {
      finalizeResponse(event.response);
      const error = event.response?.error;
      const details = event.response?.incomplete_details;

      const msg = error
        ? `${error.code || "unknown"}: ${error.message || "no message"}`
        : details?.reason
          ? `incomplete: ${details.reason}`
          : "Unknown error (no error details in response)";

      throw new Error(msg);
    }
  }

  if (!sawTerminalResponseEvent) {
    throw new Error("OpenAI Responses stream ended before a terminal response event");
  }

  for (const block of unfinishedToolCalls) {
    if (output.stopReason === "toolUse") {
      throw new Error(
        `OpenAI Responses stream completed with an unfinished tool call: ${block.name} (${block.id})`,
      );
    }

    Object.assign(
      block,
      unfinishedToolCallArguments(block.partialJson ?? block.customInput?.input ?? ""),
    );
    stripStreamingScratchState([block]);
  }
}

interface StopReasonResult {
  stopReason: StopReason;
  errorMessage?: string;
}

function mapStopReason(
  status: ResponsesStatus | undefined,
  incompleteReason?: string,
): StopReasonResult {
  if (!status) return { stopReason: "stop" };

  switch (status) {
    case "completed":
      return { stopReason: "stop" };
    case "incomplete":
      if (incompleteReason === "max_output_tokens") {
        return { stopReason: "length" };
      }

      return {
        stopReason: "error",
        errorMessage: incompleteReason
          ? `Response incomplete: ${incompleteReason}`
          : "Response incomplete without a provider reason",
      };
    case "failed":
    case "cancelled":
      return { stopReason: "error" };
    case "in_progress":
    case "queued":
      return { stopReason: "stop" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled stop reason: ${_exhaustive}`);
    }
  }
}
