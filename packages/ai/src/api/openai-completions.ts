/**
 * OpenAI-compatible Chat Completions adapter.
 */
import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { calculateCost } from "../models.ts";
import { resolveCacheRetention } from "../prompt-cache.ts";
import type {
  AssistantMessage,
  CacheRetention,
  Model,
  ProviderHeaders,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { getClientApiKey, headersToRecord, mergeProviderHeaders } from "../utils/headers.ts";
import { parseStreamingJson, parseToolCallArguments } from "../utils/json-parse.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { getDeclaredTools, resolveTranscript } from "../utils/transcript.ts";
import { emptyCost, runAssistantStream } from "./assistant-stream.ts";
import {
  appendGrammarToolInputJsonDelta,
  createGrammarToolInputProperties,
  type GrammarToolInputJsonBuffer,
} from "./constrained-sampling.ts";
import { buildCopilotDynamicHeaders } from "./github-copilot-headers.ts";
import { buildBaseOptions, simpleReasoningEffort } from "./simple-options.ts";
import { NullableTokenCount } from "./token-count.ts";
import {
  OpenAIReasoningDetailSchema,
  type OpenAIReasoningDetail,
  appendOpenAIReasoningDetail,
  CopilotReasoningOpaqueSchema,
  REASONING_DELTA_SCHEMAS,
  ReasoningDetailsDeltaSchema,
} from "./openai-completions-reasoning.ts";
import {
  type ResolvedOpenAICompletionsCompat,
  resolveCompat,
} from "./openai-completions-convert.ts";
import { type OpenAICompletionsOptions, buildParams } from "./openai-completions-params.ts";

const ChoiceUsageSchema = Type.Object({
  usage: Type.Object({
    prompt_tokens: NullableTokenCount,
    completion_tokens: NullableTokenCount,
    cached_tokens: NullableTokenCount,
    prompt_cache_hit_tokens: NullableTokenCount,
    prompt_tokens_details: Type.Optional(
      Type.Union([
        Type.Object({ cached_tokens: NullableTokenCount, cache_write_tokens: NullableTokenCount }),
        Type.Null(),
      ]),
    ),
    completion_tokens_details: Type.Optional(
      Type.Union([Type.Object({ reasoning_tokens: NullableTokenCount }), Type.Null()]),
    ),
  }),
});

/** OpenRouter forwards the upstream provider's raw error in `error.metadata.raw`. */
const OpenRouterErrorMetadataSchema = Type.Object({
  error: Type.Object({ metadata: Type.Object({ raw: Type.Unknown() }) }),
});

/**
 * Streams a Chat Completions response.
 *
 * - The chunk id is the completion id: OpenAI documents it as unique per completion and every
 *   chunk of a stream carries the same one.
 * - Usage comes from `chunk.usage`, or from `choice.usage` where providers such as Moonshot put it.
 * - Reasoning text arrives in `reasoning_content` (llama.cpp), `reasoning`, or `reasoning_text`;
 *   only the first non-empty field counts, since some servers (chutes.ai) send the same text twice.
 * - `reasoning_details` are replay metadata, not display deltas. OpenRouter streams them as
 *   deltas: consecutive text and summary entries merge, encrypted entries stay opaque and
 *   discrete. They stay in memory and serialize into the thinking signature once at the end.
 * - Copilot's `reasoning_opaque` arrives with the first text delta or after all reasoning text and
 *   is never a display delta. It lives in the thinking signature, which later reasoning text
 *   never rewrites; one response carries one state, as in OpenCode's Copilot adapter.
 * - Finished tool calls drop their scratch buffers, so replay carries only parsed arguments.
 * - The SDK rejects a present-but-undefined timeout instead of using its default, so it is set
 *   only when given.
 */
export const stream: StreamFunction<"openai-completions", OpenAICompletionsOptions> = (
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
  const normalizedContext = resolveTranscript(
    context,
    resolveCompat(model).supportsMidConvoSystemMessages,
  );

  return runAssistantStream(
    model,
    options?.signal,
    "OpenAI Completions",
    async (output, stream) => {
      interface StreamingToolCallBlock extends ToolCall {
        partialArgs?: string;
        customInput?: {
          property: string;
          input: string;
          jsonBuffer: GrammarToolInputJsonBuffer;
        };
        streamIndex?: number;
      }

      type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;

      const blocks: StreamingBlock[] = [];
      output.content = blocks;

      let streamedReasoningDetails: OpenAIReasoningDetail[] | undefined;

      const applyStreamedReasoningDetails = (block: ThinkingContent) => {
        if (streamedReasoningDetails === undefined) return;
        block.thinkingSignature = JSON.stringify(streamedReasoningDetails);
      };

      const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
      const compat = resolveCompat(model);

      const grammarToolInputProperties = createGrammarToolInputProperties(
        getDeclaredTools(normalizedContext.messages),
        compat.supportsOpenAIGrammarTools,
      );

      const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);

      const client = createClient({
        model,
        context: normalizedContext,
        apiKey,
        options,
        cacheRetention,
        compat,
      });

      const params = buildParams(
        model,
        normalizedContext,
        options,
        compat,
        cacheRetention,
        grammarToolInputProperties,
      );

      await options?.onPayload?.(params, model);

      const requestOptions: OpenAI.RequestOptions = {
        signal: options?.signal,
        maxRetries: 0,
      };

      if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

      const result = await retryProviderRequest(
        () =>
          client
            .post<Stream<ChatCompletionChunk>>("/chat/completions", {
              body: params,
              ...requestOptions,
              stream: true,
              __security: { bearerAuth: true },
            })
            .withResponse(),
        {
          maxRetries: options?.maxRetries,
          maxRetryDelayMs: options?.maxRetryDelayMs,
          signal: options?.signal,
        },
      );

      await options?.onResponse?.(
        { status: result.response.status, headers: headersToRecord(result.response.headers) },
        model,
      );
      stream.push({ type: "start", partial: output });

      type StreamingToolCallDelta = {
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
        custom?: { name?: string; input?: string };
      };

      let textBlock: TextContent | null = null;
      let thinkingBlock: ThinkingContent | null = null;
      let copilotReasoningOpaque: string | undefined;
      let hasFinishReason = false;
      const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
      const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();
      const getContentIndex = (block: StreamingBlock) =>
        blocks.findIndex((candidate) => candidate === block);

      const appendCustomToolCallInput = (
        block: StreamingToolCallBlock,
        nextInput: string,
        close: boolean,
      ): string | undefined => {
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
      };

      const finishBlock = (block: StreamingBlock) => {
        const contentIndex = getContentIndex(block);

        if (contentIndex === -1) {
          return;
        }

        if (block.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: output,
          });
        } else if (block.type === "thinking") {
          stream.push({
            type: "thinking_end",
            contentIndex,
            content: block.thinking,
            partial: output,
          });
        } else if (block.type === "toolCall") {
          if (block.customInput) {
            const delta = appendCustomToolCallInput(block, block.customInput.input, true);

            if (delta !== undefined) {
              stream.push({
                type: "toolcall_delta",
                contentIndex,
                delta,
                partial: output,
              });
            }
          } else {
            Object.assign(block, parseToolCallArguments(block.partialArgs));
          }

          delete block.partialArgs;
          delete block.customInput;
          delete block.streamIndex;
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall: block,
            partial: output,
          });
        }
      };

      const ensureTextBlock = () => {
        if (!textBlock) {
          textBlock = { type: "text", text: "" };
          blocks.push(textBlock);
          stream.push({
            type: "text_start",
            contentIndex: getContentIndex(textBlock),
            partial: output,
          });
        }

        return textBlock;
      };

      const ensureThinkingBlock = (thinkingSignature: string) => {
        if (!thinkingBlock) {
          thinkingBlock = {
            type: "thinking",
            thinking: "",
            thinkingSignature,
          };
          blocks.push(thinkingBlock);
          stream.push({
            type: "thinking_start",
            contentIndex: getContentIndex(thinkingBlock),
            partial: output,
          });
        }

        return thinkingBlock;
      };

      const ensureToolCallBlock = (toolCall: StreamingToolCallDelta) => {
        const streamIndex = toolCall.index;
        const name = toolCall.function?.name ?? toolCall.custom?.name ?? "";
        let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined;

        if (!block && toolCall.id) {
          block = toolCallBlocksById.get(toolCall.id);
        }

        if (!block) {
          const customInputProperty =
            toolCall.custom && !toolCall.function
              ? (grammarToolInputProperties.get(name) ?? "input")
              : undefined;

          const hasCustomInput = customInputProperty !== undefined;
          block = {
            type: "toolCall",
            id: toolCall.id || "",
            name,
            arguments: hasCustomInput ? { [customInputProperty]: "" } : {},
            partialArgs: hasCustomInput ? undefined : "",
            customInput: hasCustomInput
              ? {
                  property: customInputProperty,
                  input: "",
                  jsonBuffer: { input: "", started: false, closed: false },
                }
              : undefined,
            streamIndex,
          };

          if (streamIndex !== undefined) {
            toolCallBlocksByIndex.set(streamIndex, block);
          }

          if (toolCall.id) {
            toolCallBlocksById.set(toolCall.id, block);
          }

          blocks.push(block);
          stream.push({
            type: "toolcall_start",
            contentIndex: getContentIndex(block),
            partial: output,
          });
        }

        if (streamIndex !== undefined && block.streamIndex === undefined) {
          block.streamIndex = streamIndex;
          toolCallBlocksByIndex.set(streamIndex, block);
        }

        if (toolCall.id) {
          toolCallBlocksById.set(toolCall.id, block);
        }

        if (!block.name && name) {
          block.name = name;
        }

        if (toolCall.custom && !toolCall.function && !block.customInput) {
          const customInputProperty = grammarToolInputProperties.get(block.name) ?? "input";
          block.arguments = { [customInputProperty]: "" };
          block.customInput = {
            property: customInputProperty,
            input: "",
            jsonBuffer: { input: "", started: false, closed: false },
          };
          delete block.partialArgs;
        }

        return block;
      };

      try {
        for await (const chunk of result.data) {
          if (!chunk) continue;

          output.responseId ||= chunk.id;

          if (chunk.model && chunk.model !== model.id) {
            output.responseModel ||= chunk.model;
          }

          if (chunk.usage) {
            output.usage = parseChunkUsage(chunk.usage, model);
          }

          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;

          if (!choice) continue;

          if (!chunk.usage && Value.Check(ChoiceUsageSchema, choice)) {
            output.usage = parseChunkUsage(choice.usage, model);
          }

          if (choice.finish_reason) {
            output.rawStopReason = choice.finish_reason;
            const finishReasonResult = mapStopReason(choice.finish_reason);
            output.stopReason = finishReasonResult.stopReason;

            if (finishReasonResult.errorMessage) {
              output.errorMessage = finishReasonResult.errorMessage;
            }

            hasFinishReason = true;
          }

          if (choice.delta) {
            if (
              choice.delta.content !== null &&
              choice.delta.content !== undefined &&
              choice.delta.content.length > 0
            ) {
              const block = ensureTextBlock();
              block.text += choice.delta.content;
              stream.push({
                type: "text_delta",
                contentIndex: getContentIndex(block),
                delta: choice.delta.content,
                partial: output,
              });
            }

            const deltaFields = choice.delta;

            for (const { field, schema } of REASONING_DELTA_SCHEMAS) {
              if (!Value.Check(schema, deltaFields)) continue;
              const delta = deltaFields[field];

              const thinkingSignature =
                model.provider === "opencode-go" && field === "reasoning"
                  ? "reasoning_content"
                  : field;

              const block = ensureThinkingBlock(thinkingSignature);
              block.thinking += delta;
              stream.push({
                type: "thinking_delta",
                contentIndex: getContentIndex(block),
                delta,
                partial: output,
              });
              break;
            }

            if (
              model.provider === "github-copilot" &&
              Value.Check(CopilotReasoningOpaqueSchema, deltaFields)
            ) {
              const reasoningOpaque = deltaFields.reasoning_opaque;

              if (
                copilotReasoningOpaque !== undefined &&
                copilotReasoningOpaque !== reasoningOpaque
              ) {
                throw new Error(
                  "GitHub Copilot sent multiple reasoning_opaque values in one response",
                );
              }

              copilotReasoningOpaque = reasoningOpaque;
              const block = ensureThinkingBlock("");
              block.thinkingSignature = JSON.stringify({ reasoning_opaque: reasoningOpaque });
            }

            if (choice?.delta?.tool_calls) {
              const toolCalls: StreamingToolCallDelta[] = choice.delta.tool_calls;

              for (const toolCall of toolCalls) {
                const block = ensureToolCallBlock(toolCall);

                if (!block.id && toolCall.id) {
                  block.id = toolCall.id;
                  toolCallBlocksById.set(toolCall.id, block);
                }

                const name = toolCall.function?.name ?? toolCall.custom?.name;

                if (!block.name && name) {
                  block.name = name;
                }

                let delta = "";

                if (toolCall.function?.arguments) {
                  delta = toolCall.function.arguments;
                  block.partialArgs = (block.partialArgs ?? "") + toolCall.function.arguments;
                  block.arguments = parseStreamingJson(block.partialArgs);
                } else if (toolCall.custom?.input) {
                  const nextInput = (block.customInput?.input ?? "") + toolCall.custom.input;
                  delta = appendCustomToolCallInput(block, nextInput, false) ?? "";
                }

                stream.push({
                  type: "toolcall_delta",
                  contentIndex: getContentIndex(block),
                  delta,
                  partial: output,
                });
              }
            }

            if (Value.Check(ReasoningDetailsDeltaSchema, deltaFields)) {
              for (const detail of deltaFields.reasoning_details) {
                if (!Value.Check(OpenAIReasoningDetailSchema, detail)) continue;
                ensureThinkingBlock("");
                streamedReasoningDetails ??= [];
                appendOpenAIReasoningDetail(streamedReasoningDetails, detail);
              }
            }
          }
        }
      } finally {
        for (const block of blocks) {
          if (block.type === "thinking") applyStreamedReasoningDetails(block);
        }
      }

      for (const block of blocks) {
        finishBlock(block);
      }

      if (!hasFinishReason && !compat.supportsFinishReason) {
        output.stopReason = output.content.some((block) => block.type === "toolCall")
          ? "toolUse"
          : "stop";
      }

      if (compat.supportsFinishReason && !hasFinishReason) {
        throw new Error("Stream ended without finish_reason");
      }
    },
    formatCompletionsError,
  );
};

/**
 * OpenRouter forwards the upstream provider's raw error in `error.metadata.raw`. The normalized
 * message already carries the parsed body, so the raw metadata is appended only when it adds text.
 */
function formatCompletionsError(error: unknown): string {
  const message = formatProviderError(normalizeProviderError(error));
  const rawMetadata = Value.Check(OpenRouterErrorMetadataSchema, error)
    ? error.error.metadata.raw
    : undefined;

  return rawMetadata && !message.includes(String(rawMetadata))
    ? `${message}\n${rawMetadata}`
    : message;
}

export const streamSimple: StreamFunction<"openai-completions", SimpleStreamOptions> = (
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  getClientApiKey(model.provider, options?.apiKey, options?.headers);

  return stream(model, context, {
    ...buildBaseOptions(model, context, options),
    reasoningEffort: simpleReasoningEffort(model, options?.reasoning),
    thinkingBudgets: options?.thinkingBudgets,
  });
};

function createClient(input: {
  model: Model<"openai-completions">;
  context: TranscriptContext;
  apiKey: string;
  options: Pick<OpenAICompletionsOptions, "fetch" | "headers" | "sessionId"> | undefined;
  cacheRetention: CacheRetention;
  compat: ResolvedOpenAICompletionsCompat;
}) {
  const copilotHeaders =
    input.model.provider === "github-copilot"
      ? buildCopilotDynamicHeaders({
          messages: input.context.messages,
          sessionId: input.options?.sessionId,
        })
      : undefined;

  const cacheSessionId = input.cacheRetention === "none" ? undefined : input.options?.sessionId;
  const affinityHeaders: ProviderHeaders = {};

  if (cacheSessionId && input.compat.sendSessionAffinityHeaders) {
    if (input.compat.sessionAffinityFormat === "openrouter") {
      affinityHeaders["x-session-id"] = cacheSessionId;
    } else {
      if (input.compat.sessionAffinityFormat === "openai") {
        affinityHeaders.session_id = cacheSessionId;
      }

      affinityHeaders["x-client-request-id"] = cacheSessionId;
      affinityHeaders["x-session-affinity"] = cacheSessionId;
    }
  }

  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: input.options?.fetch,
    defaultHeaders: mergeProviderHeaders(
      { "User-Agent": getNyteUserAgent() },
      input.model.headers,
      copilotHeaders,
      affinityHeaders,
      input.options?.headers,
    ),
  });
}

/**
 * Usage from a Chat Completions chunk, following documented OpenAI and OpenRouter semantics:
 * `cached_tokens` counts cache reads. Providers place it differently: OpenAI and OpenRouter in
 * `prompt_tokens_details.cached_tokens`, DeepSeek in `prompt_cache_hit_tokens`, Kimi at the top
 * level of the final usage chunk. OpenAI never emits `cache_write_tokens`, but OpenRouter-compatible
 * providers can send it as a separate write count
 * (https://github.com/OpenRouterTeam/ai-sdk-provider/pull/409, also in
 * https://github.com/antirez/ds4/pull/29). Writes are not subtracted from `cached_tokens`, which
 * would under-report spec-compliant providers. `completion_tokens` already includes reasoning.
 */
function parseChunkUsage(
  rawUsage: Static<typeof ChoiceUsageSchema>["usage"],
  model: Model<"openai-completions">,
): AssistantMessage["usage"] {
  const promptTokens = rawUsage.prompt_tokens || 0;

  const cacheReadTokens =
    rawUsage.prompt_tokens_details?.cached_tokens ??
    rawUsage.prompt_cache_hit_tokens ??
    rawUsage.cached_tokens ??
    0;

  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;

  const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const outputTokens = rawUsage.completion_tokens || 0;

  const usage: AssistantMessage["usage"] = {
    input,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    reasoning: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: input + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: emptyCost(),
  };

  calculateCost(model, usage);

  return usage;
}

interface StopReasonResult {
  stopReason: StopReason;
  errorMessage?: string;
}

function mapStopReason(
  reason: ChatCompletionChunk.Choice["finish_reason"] | string,
): StopReasonResult {
  if (reason === null) return { stopReason: "stop" };

  switch (reason) {
    case "stop":
    case "end":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "function_call":
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
    case "network_error":
      return { stopReason: "error", errorMessage: "Provider finish_reason: network_error" };
    default:
      return {
        stopReason: "error",
        errorMessage: `Provider finish_reason: ${reason}`,
      };
  }
}
