/**
 * Shared OpenAI Responses message conversion and stream processing.
 *
 * Based on https://github.com/earendil-works/pi/blob/bc2d8dc1c46c50f2c6a0f3237e6a2453817e51a1/packages/ai/src/api/openai-responses-shared.ts
 * Synced with pi bc2d8dc1c.
 */
import type OpenAI from "openai";
import type {
  CustomTool,
  Tool as OpenAITool,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputItem,
  ResponseInputText,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseCustomToolCall,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
  ResponseStreamEvent,
  ResponseToolSearchOutputItemParam,
} from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { TextSignatureV1Schema } from "@nyte-ai/schema";
import { calculateCost } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Model,
  StopReason,
  SystemMessage,
  TextContent,
  TextSignatureV1,
  ThinkingContent,
  Tool,
  ToolCall,
  TranscriptContext,
  Usage,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { shortHash } from "../utils/hash.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../utils/text.ts";
import { resolveTranscript, resolveTranscriptTools } from "../utils/transcript.ts";
import {
  appendGrammarToolInputJsonDelta,
  type GrammarToolInputJsonBuffer,
  getGrammarToolInput,
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import { TokenCount } from "./token-count.ts";
import { transformMessages } from "./transform-messages.ts";

// =============================================================================
// Utilities
// =============================================================================

function encodeTextSignatureV1(id: string, phase?: TextSignatureV1["phase"]): string {
  const payload: TextSignatureV1 = { v: 1, id };

  if (phase) payload.phase = phase;

  return JSON.stringify(payload);
}

function parseTextSignature(
  signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
  if (!signature) return undefined;

  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature);

      if (Value.Check(TextSignatureV1Schema, parsed)) return parsed;
    } catch {
      // Fall through to legacy plain-string handling.
    }
  }

  return { id: signature };
}

type ToolResultOutputContent = Array<ResponseInputText | ResponseInputImage>;

function convertToolResultOutput<TApi extends Api>(
  model: Model<TApi>,
  content: readonly (TextContent | ImageContent)[],
): string | ToolResultOutputContent {
  const textResult = content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

  const images = content.filter((c) => c.type === "image");
  const hasText = textResult.length > 0;

  if (images.length === 0 || !model.input.includes("image")) {
    return sanitizeSurrogates(
      hasText ? textResult : images.length > 0 ? "(see attached image)" : "(no tool output)",
    );
  }

  const output: ToolResultOutputContent = [];

  if (hasText) {
    output.push({ type: "input_text", text: sanitizeSurrogates(textResult) });
  }

  for (const image of images) {
    output.push({
      type: "input_image",
      detail: "auto",
      image_url: `data:${image.mimeType};base64,${image.data}`,
    });
  }

  return output;
}

/** `fast` is the API-neutral request; on the Responses APIs it is the priority tier, for streams and compaction alike. */
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
    responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
    requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  ) => ResponseCreateParamsStreaming["service_tier"] | undefined;
  applyServiceTierPricing?: (
    usage: Usage,
    serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  ) => void;
}

export interface ConvertResponsesMessagesOptions {
  includeSystemPrompt?: boolean;
  grammarToolInputProperties?: ReadonlyMap<string, string>;
  /** Whether later system messages are sent in place; otherwise they are folded into the leading prompt. */
  supportsMidConvoSystemMessages?: boolean;
  /** Request-list tools that tool results load via `addedToolNames`. */
  deferredTools?: ReadonlyMap<string, Tool>;
  /** How late tools reach the model: system-message anchors and `addedToolNames` loads share it. */
  deferredToolsMode?: "additional-tools" | "tool-search";
  toolOptions?: ConvertResponsesToolsOptions;
}

export interface ConvertResponsesToolsOptions {
  strict?: boolean | null;
  supportsStrictMode?: boolean;
  supportsOpenAIGrammarTools?: boolean;
  deferLoading?: boolean;
}

// =============================================================================
// Message conversion
// =============================================================================

const CheckpointItemsSchema = Type.Array(Type.Object({ type: Type.String() }));

export function convertResponsesMessages(
  model: Model<"openai-responses" | "azure-openai-responses" | "openai-codex-responses">,
  context: TranscriptContext,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: ConvertResponsesMessagesOptions,
): ResponseInput {
  const messages: ResponseInput = [];

  const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
  const checkpoint = normalizedContext.checkpoint;

  if (checkpoint !== undefined) {
    if (
      checkpoint.provider !== model.provider ||
      checkpoint.api !== model.api ||
      checkpoint.model !== model.id ||
      !Value.Check(CheckpointItemsSchema, checkpoint.data)
    ) {
      throw new Error(`Checkpoint material does not match ${model.provider}/${model.id}`);
    }

    // SAFETY: this is the matching provider boundary, after validating the
    // endpoint's array-of-response-items envelope. The OpenAI SDK omits the
    // native compaction item from its public ResponseInput union.
    messages.push(...(checkpoint.data as ResponseInput));
  }

  const loadedToolNames = new Set<string>();

  const normalizeIdPart = (part: string): string => {
    const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
    const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;

    return normalized.replace(/_+$/, "");
  };

  const buildForeignResponsesItemId = (itemId: string): string => {
    const normalized = `fc_${shortHash(itemId)}`;

    return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
  };

  const normalizeToolCallId = (
    id: string,
    _targetModel: Model<"openai-responses" | "azure-openai-responses" | "openai-codex-responses">,
    source: AssistantMessage,
  ): string => {
    if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);

    if (!id.includes("|")) return normalizeIdPart(id);
    const [callId, itemId] = id.split("|");
    const normalizedCallId = normalizeIdPart(callId);
    const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;

    let normalizedItemId = isForeignToolCall
      ? buildForeignResponsesItemId(itemId)
      : normalizeIdPart(itemId);

    // OpenAI Responses API requires item id to start with "fc"
    if (!normalizedItemId.startsWith("fc_")) {
      normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
    }

    return `${normalizedCallId}|${normalizedItemId}`;
  };

  const transformedMessages = transformMessages(
    normalizedContext.messages,
    model,
    normalizeToolCallId,
  );

  const transcriptTools = resolveTranscriptTools(
    normalizedContext.messages,
    options?.deferredToolsMode !== undefined,
  );

  const pushToolLoad = (tools: Tool[], seed: string): void => {
    if (tools.length === 0 || options?.deferredToolsMode === undefined) return;

    if (options.deferredToolsMode === "additional-tools") {
      messages.push({
        type: "additional_tools",
        role: "developer",
        tools: convertResponsesTools(tools, options.toolOptions),
      } satisfies ResponseInputItem);

      return;
    }

    const names = tools.map((tool) => tool.name);
    const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;

    messages.push({
      type: "tool_search_call",
      call_id: callId,
      execution: "client",
      status: "completed",
      arguments: { query: names.join(" "), limit: names.length },
    } satisfies ResponseInputItem);
    messages.push({
      type: "tool_search_output",
      call_id: callId,
      execution: "client",
      status: "completed",
      tools: convertResponsesTools(tools, { ...options.toolOptions, deferLoading: true }),
    } satisfies ResponseToolSearchOutputItemParam);
  };

  const appendSystemToolAdditions = (message: SystemMessage, seed: string): void => {
    const tools = transcriptTools.anchorsAdditions ? (message.toolsAdded ?? []) : [];

    for (const tool of tools) loadedToolNames.add(tool.name);
    pushToolLoad(tools, seed);
  };

  const includeInitialSystemMessage = options?.includeSystemPrompt ?? true;

  const instructionRole =
    model.reasoning && model.compat?.supportsDeveloperRole !== false ? "developer" : "system";

  let msgIndex = 0;
  let sourceIndex = 0;

  for (const msg of transformedMessages) {
    const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";

    if (msg.role === "system") {
      if (!isLeadingSystemMessage) appendSystemToolAdditions(msg, `system:${msgIndex}`);

      if (!isLeadingSystemMessage || includeInitialSystemMessage) {
        const text = isLeadingSystemMessage
          ? getSystemMessageText(msg)
          : renderSystemMessageUpdate(msg);

        if (text.length > 0) {
          messages.push({ role: instructionRole, content: sanitizeSurrogates(text) });
        }
      }
    } else if (msg.role === "user") {
      if (!Array.isArray(msg.content)) {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
          if (item.type === "text") {
            return {
              type: "input_text",
              text: sanitizeSurrogates(item.text),
            } satisfies ResponseInputText;
          }

          return {
            type: "input_image",
            detail: "auto",
            image_url: `data:${item.mimeType};base64,${item.data}`,
          } satisfies ResponseInputImage;
        });

        if (content.length === 0) continue;
        messages.push({
          role: "user",
          content,
        });
      }
    } else if (msg.role === "assistant") {
      const output: ResponseInput = [];
      const isSameProviderAndApi = msg.provider === model.provider && msg.api === model.api;
      const isSameModel = isSameProviderAndApi && msg.model === model.id;
      const isDifferentModel = isSameProviderAndApi && msg.model !== model.id;
      let textBlockIndex = 0;

      for (const block of msg.content) {
        if (block.type === "thinking") {
          if (block.thinkingSignature) {
            // SAFETY: transformMessages keeps signed thinking only for the same provider, API,
            // and model, and this adapter writes that signature as a serialized reasoning item.
            const reasoningItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;
            output.push(reasoningItem);
          }
        } else if (block.type === "text") {
          const parsedSignature = parseTextSignature(block.textSignature);

          const fallbackMessageId =
            textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;

          textBlockIndex++;
          // OpenAI requires id to be max 64 characters
          let msgId = parsedSignature?.id;

          if (!msgId) {
            msgId = fallbackMessageId;
          } else if (msgId.length > 64) {
            msgId = `msg_${shortHash(msgId)}`;
          }

          output.push({
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] },
            ],
            status: "completed",
            id: msgId,
            phase: parsedSignature?.phase,
          } satisfies ResponseOutputMessage);
        } else if (block.type === "toolCall") {
          const [callId, itemIdRaw] = block.id.split("|");
          const customInputProperty = options?.grammarToolInputProperties?.get(block.name);
          let itemId: string | undefined = itemIdRaw;

          // For different-model messages, set id to undefined to avoid pairing validation.
          // OpenAI tracks which item IDs were paired with rs_xxx reasoning items.
          // By omitting the id, we avoid triggering that validation (like cross-provider does).
          // Also drop ids that do not match the replayed item type: function_call ids must be fc_*
          // and custom_tool_call ids must be ctc_*. Foreign tool call ids are normalized to fc_*, and
          // a call can switch between the two types when grammar tool support differs.
          const itemIdPrefix = customInputProperty === undefined ? "fc_" : "ctc_";

          if (isDifferentModel || !itemId?.startsWith(itemIdPrefix)) {
            itemId = undefined;
          }

          const canReplayNamespace =
            isSameModel || options?.deferredTools?.has(block.name) === true;

          const call: ResponseCustomToolCall | ResponseFunctionToolCall =
            customInputProperty === undefined
              ? {
                  type: "function_call",
                  id: itemId,
                  call_id: callId,
                  name: block.name,
                  arguments: JSON.stringify(block.arguments),
                }
              : {
                  type: "custom_tool_call",
                  id: itemId,
                  call_id: callId,
                  name: block.name,
                  input: sanitizeSurrogates(
                    getGrammarToolInput(block.name, block.arguments, customInputProperty),
                  ),
                };

          if (canReplayNamespace && block.namespace !== undefined) {
            call.namespace = block.namespace;
          }

          output.push(call);
        }
      }

      if (output.length === 0) continue;
      messages.push(...output);
    } else if (msg.role === "toolResult") {
      const [callId] = msg.toolCallId.split("|");
      const output = convertToolResultOutput(model, msg.content);

      if (options?.grammarToolInputProperties?.has(msg.toolName)) {
        messages.push({
          type: "custom_tool_call_output",
          call_id: callId,
          output,
        });
      } else {
        messages.push({
          type: "function_call_output",
          call_id: callId,
          output,
        });
      }

      const deferredTools: Tool[] = [];

      for (const name of msg.addedToolNames ?? []) {
        const tool = options?.deferredTools?.get(name);

        if (!tool || loadedToolNames.has(name)) continue;
        loadedToolNames.add(name);
        deferredTools.push(tool);
      }

      pushToolLoad(deferredTools, msg.toolCallId);
    }

    if (!isLeadingSystemMessage) msgIndex++;
  }

  return messages;
}

// =============================================================================
// Tool conversion
// =============================================================================

export function convertResponsesTools(
  tools: readonly Tool[],
  options?: ConvertResponsesToolsOptions,
): OpenAITool[] {
  const defaultStrict = options?.strict === undefined ? false : options.strict;
  const supportsStrictMode = options?.supportsStrictMode ?? true;
  const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;

  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);

    if (grammar) {
      const customTool: CustomTool = {
        type: "custom",
        name: tool.name,
        description: tool.description,
        format: {
          type: "grammar",
          syntax: grammar.format,
          definition: grammar.definition,
        },
      };

      if (options?.deferLoading) customTool.defer_loading = true;

      return customTool;
    }

    const constrainedStrict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
    const strict = constrainedStrict ?? defaultStrict;

    const functionTool: Omit<Extract<OpenAITool, { type: "function" }>, "strict"> & {
      strict?: Extract<OpenAITool, { type: "function" }>["strict"];
    } = {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: getJsonSchemaToolParameters(tool, strict === true),
    };

    if (options?.deferLoading) functionTool.defer_loading = true;

    if (supportsStrictMode) {
      functionTool.strict = strict;
    }

    // SAFETY: providers without strict mode reject or ignore the field, so it is omitted
    // even though the SDK type marks it required.
    return functionTool as OpenAITool;
  });
}

// =============================================================================
// Stream processing
// =============================================================================

// Codex decodes its own wire frames, so terminal usage remains untrusted until
// finalization rather than borrowing the SDK's unchecked numeric types.
type ResponsesTerminalResponse = Omit<
  Extract<ResponseStreamEvent, { type: "response.completed" }>["response"],
  "usage"
> & { usage?: unknown };

export type ResponsesStreamEvent =
  | Exclude<ResponseStreamEvent, { type: "response.completed" }>
  | { type: "response.completed"; response: ResponsesTerminalResponse };

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

/**
 * Strips the streaming scratch fields that accumulate on tool-call blocks while
 * arguments are still arriving. They are parsing state, never conversation
 * content, so adapters call this before persisting or emitting a failed message.
 */
export function stripStreamingScratchState(content: AssistantMessage["content"]): void {
  for (const block of content) {
    if ("partialJson" in block) delete block.partialJson;

    if ("customInput" in block) delete block.customInput;
  }
}

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

export async function processResponsesStream<TApi extends Api>(
  openaiStream: AsyncIterable<ResponsesStreamEvent>,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model: Model<TApi>,
  options?: OpenAIResponsesStreamOptions,
): Promise<void> {
  let sawTerminalResponseEvent = false;
  const outputSlots = new Map<number, ResponsesOutputSlot>();
  const reasoningBlocksById = new Map<string, ThinkingContent>();

  const applyMessagePhaseStopReason = (item: ResponseOutputItem): void => {
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
    outputIndex: number,
    item: ResponseOutputItem,
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
        id: `${item.call_id}|${item.id}`,
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
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    if (item.type === "custom_tool_call") {
      const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
      const input = item.input || "";

      const block: StreamingToolCall = {
        type: "toolCall",
        id: `${item.call_id}|${item.id}`,
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
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });

      return slot;
    }

    return undefined;
  };

  const getOrCreateSlot = (
    outputIndex: number,
    item: ResponseOutputItem,
  ): ResponsesOutputSlot | undefined => {
    return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
  };

  // Azure OpenAI can omit reasoning.encrypted_content from response.output_item.done
  // and provide it only in response.completed.response.output. Backfill the
  // persisted reasoning signature from the terminal response to keep store:false
  // multi-turn replay stateless. See https://github.com/earendil-works/pi/issues/6409.
  const backfillReasoningSignatures = (responseOutput: ResponseOutputItem[]): void => {
    for (const item of responseOutput) {
      if (item.type !== "reasoning" || !item.encrypted_content) continue;
      const block = reasoningBlocksById.get(item.id);

      if (!block?.thinkingSignature) continue;

      // SAFETY: reasoning blocks tracked here received their signature from JSON.stringify(item)
      // on a reasoning output item in this stream.
      const storedItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;

      if (storedItem.encrypted_content) continue;
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
        // OpenAI includes cached and cache-write tokens in input_tokens, so subtract both.
        input: Math.max(0, (usage.input_tokens ?? 0) - cachedTokens - cacheWriteTokens),
        output: usage.output_tokens ?? 0,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
    }

    calculateCost(model, output.usage);

    if (options?.applyServiceTierPricing) {
      const serviceTier = options.resolveServiceTier
        ? options.resolveServiceTier(response?.service_tier, options.serviceTier)
        : (response?.service_tier ?? options.serviceTier);

      options.applyServiceTierPricing(output.usage, serviceTier);
    }

    // Map status to stop reason. For incomplete responses, retain the provider's
    // specific reason so max-output truncation and content filtering stay distinct.
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
        slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
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
        slot.block.arguments = parseStreamingJson(item.arguments || slot.block.partialJson || "{}");

        if (item.namespace !== undefined) slot.block.namespace = item.namespace;
        // Finalize in-place and strip the scratch buffer so replay only
        // carries parsed arguments.
        delete slot.block.partialJson;
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

  // The agent runs every tool call in the final message. Refuse to hand over calls whose
  // output_item.done never arrived: their arguments may be cut off or mixed up, e.g. when a
  // non-compliant server omits output_index. Finished calls have their scratch buffers removed.
  if (output.stopReason !== "toolUse") return;

  for (const block of output.content) {
    if (block.type !== "toolCall") continue;

    if ("partialJson" in block || "customInput" in block) {
      throw new Error(
        `OpenAI Responses stream completed with an unfinished tool call: ${block.name} (${block.id})`,
      );
    }
  }
}

interface StopReasonResult {
  stopReason: StopReason;
  errorMessage?: string;
}

function mapStopReason(
  status: OpenAI.Responses.ResponseStatus | undefined,
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
    // These two are wonky ...
    case "in_progress":
    case "queued":
      return { stopReason: "stop" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled stop reason: ${_exhaustive}`);
    }
  }
}
