/**
 * The Anthropic Messages adapter: request parameters, the event stream, and
 * the simple reasoning mapping.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type {
  BetaTool,
  BetaCacheControlEphemeral,
  MessageCreateParamsStreaming,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { calculateCost, clampThinkingLevel } from "../model-capabilities.ts";
import { ANTHROPIC_FAST_MODE_COST_MULTIPLIER } from "../model-pricing.ts";
import { resolveCacheRetention } from "../prompt-cache.ts";
import type {
  CacheRetention,
  Model,
  ProviderEnv,
  ProviderHeaders,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
  Usage,
} from "../types.ts";
import { splitDeferredTools } from "../utils/deferred-tools.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { parseStreamingJson, parseToolCallArguments, repairJson } from "../utils/json-parse.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { iterateServerSentEvents } from "../utils/sse.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  getCurrentTools,
  getDeclaredTools,
  getInitialSystemMessage,
  hasToolRedefinitions,
  resolveTranscript,
} from "../utils/transcript.ts";
import { runAssistantStream } from "./assistant-stream.ts";
import {
  AnthropicEventSchema,
  AnthropicEventTypeSchema,
  IgnoredAnthropicEventSchema,
  type AnthropicEvent,
} from "./anthropic-events.ts";
import { buildCopilotDynamicHeaders } from "./github-copilot-headers.ts";
import {
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
} from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";
import { toClaudeCodeName, fromClaudeCodeName } from "./claude-code.ts";
import { claudeHeaderLimits } from "../providers/anthropic-limits.ts";
import {
  FAST_MODE_BETA,
  MID_CONVERSATION_TOOL_CHANGES_BETA,
  shouldUseServerSideFallbackBeta,
  getAnthropicCompat,
  mergeAnthropicHeaders,
  appendAnthropicBeta,
  assertRequestAuth,
  getAnthropicFederation,
  createClient,
  shouldUseFineGrainedToolStreamingBeta,
} from "./anthropic-client.ts";
import { normalizeToolCallId, convertMessages, convertTools } from "./anthropic-convert.ts";

function getCacheControl(
  model: Model<"anthropic-messages">,
  cacheRetention?: CacheRetention,
  env?: ProviderEnv,
): BetaCacheControlEphemeral | undefined {
  const retention = resolveCacheRetention(cacheRetention, env);

  if (retention === "none") return undefined;

  const cacheControl: BetaCacheControlEphemeral = { type: "ephemeral" };

  if (retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention) {
    cacheControl.ttl = "1h";
  }

  return cacheControl;
}

const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

export type AnthropicThinkingDisplay = "summarized" | "omitted";

/**
 * Stable deferred tool declared whenever native tool changes are in use. Anthropic adds
 * hidden prompt scaffolding as soon as any tool has `defer_loading`; declaring this
 * placeholder from the first request keeps that scaffolding in the cached prefix, so the
 * first real late tool does not invalidate the cache (measured: full miss without it).
 * It is never activated and the model cannot see it.
 */
const DEFERRED_TOOL_PLACEHOLDER: BetaTool = {
  name: "__pi_deferred_placeholder__",
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { type: "object", properties: {}, required: [] },
  defer_loading: true,
};

function applyAnthropicFastModePricing(usage: Usage, fast: boolean): void {
  if (!fast) return;
  usage.cost.input *= ANTHROPIC_FAST_MODE_COST_MULTIPLIER;
  usage.cost.output *= ANTHROPIC_FAST_MODE_COST_MULTIPLIER;
  usage.cost.cacheRead *= ANTHROPIC_FAST_MODE_COST_MULTIPLIER;
  usage.cost.cacheWrite *= ANTHROPIC_FAST_MODE_COST_MULTIPLIER;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

/**
 * Native tool changes reference tools by name, so a redefined name cannot be expressed,
 * and Anthropic rejects a tool list where every tool is deferred, so there must be an
 * initial active tool to anchor the deferred ones. Otherwise the current tool list is sent.
 */
function usesNativeToolChanges(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
): boolean {
  const compat = getAnthropicCompat(model);
  const initialTools = getInitialSystemMessage(context.messages)?.toolsAdded ?? [];

  return (
    compat.supportsMidConvoSystemMessages &&
    compat.supportsMidConvoToolChanges &&
    initialTools.length > 0 &&
    !hasToolRedefinitions(context.messages)
  );
}

export interface AnthropicOptions extends StreamOptions {
  /**
   * Anthropic inference speed. Fast mode is available only for first-party
   * Claude Opus 5 and Claude Opus 4.8 requests.
   */
  speed?: NonNullable<MessageCreateParamsStreaming["speed"]>;
  /**
   * Enable extended thinking.
   * For adaptive thinking models: the model decides when/how much to think.
   * For older models: uses budget-based thinking with thinkingBudgetTokens.
   * Default: undefined (thinking is omitted unless `streamSimple()` maps
   * a simple reasoning level to this option, or callers set it explicitly).
   */
  thinkingEnabled?: boolean;
  /**
   * Token budget for extended thinking (older models only).
   * Ignored for adaptive thinking models.
   * Default: 1024 when `thinkingEnabled` is true and no budget is provided.
   */
  thinkingBudgetTokens?: number;
  /**
   * Effort level for adaptive thinking models.
   * Controls how much thinking Claude allocates:
   * - "max": Always thinks with no constraints (Opus 4.6 only)
   * - "xhigh": Highest reasoning level (Opus 4.7+, Fable 5)
   * - "high": Always thinks, deep reasoning
   * - "medium": Moderate thinking, may skip for simple queries
   * - "low": Minimal thinking, skips for simple tasks
   * Ignored for older models.
   * Default: omitted unless `streamSimple()` maps a simple reasoning
   * level to this option.
   */
  effort?: AnthropicEffort;
  /**
   * Controls how thinking content is returned in API responses.
   * - "summarized": Thinking blocks contain summarized thinking text.
   * - "omitted": Thinking blocks return an empty thinking field; the encrypted
   *   signature still travels back for multi-turn continuity. Use for faster
   *   time-to-first-text-token when your UI does not surface thinking.
   *
   * Note: Anthropic's API default for Claude Opus 4.7 and Claude Mythos Preview
   * is "omitted". We default to "summarized" here to keep behavior consistent
   * with older Claude 4 models. Set this explicitly to "omitted" to opt in.
   * Default: "summarized" when thinking is enabled.
   */
  thinkingDisplay?: AnthropicThinkingDisplay;
  /**
   * Whether to request the interleaved thinking beta header for non-adaptive
   * thinking models. Adaptive thinking models have interleaved thinking built in,
   * so the header is skipped for them regardless of this setting.
   * Default: true.
   */
  interleavedThinking?: boolean;
  /**
   * Anthropic tool choice behavior. String values map to Anthropic's built-in
   * choices; `{ type: "tool", name }` forces a specific tool.
   * Default: omitted (Anthropic default behavior, currently equivalent to auto).
   */
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
  /**
   * Pre-built Anthropic client instance. When provided, skips internal client
   * construction entirely. Use this to inject alternative SDK clients such as
   * `AnthropicVertex` that shares the same messaging API.
   */
  client?: Anthropic;
}

async function* iterateAnthropicEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<AnthropicEvent> {
  if (!response.body) {
    throw new Error("Attempted to iterate over an Anthropic response with no body");
  }

  let sawMessageStart = false;
  let sawMessageEnd = false;

  for await (const sse of iterateServerSentEvents(response.body, signal)) {
    if (sse.event === "error") {
      throw new Error(sse.data);
    }

    if (!Value.Check(AnthropicEventTypeSchema, sse.event)) continue;

    try {
      let event: unknown;

      try {
        event = JSON.parse(sse.data);
      } catch {
        event = JSON.parse(repairJson(sse.data));
      }

      if (Value.Check(IgnoredAnthropicEventSchema, event) && event.type === sse.event) continue;

      if (!Value.Check(AnthropicEventSchema, event)) {
        throw new Error("Invalid Anthropic event body");
      }

      if (event.type !== sse.event) {
        throw new Error(`Event type ${event.type} does not match ${sse.event}`);
      }

      if (event.type === "message_start") {
        sawMessageStart = true;
      } else if (event.type === "message_stop") {
        sawMessageEnd = true;
      }

      yield event;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
      );
    }
  }

  if (sawMessageStart && !sawMessageEnd) {
    throw new Error("Anthropic stream ended before message_stop");
  }
}

export const stream: StreamFunction<"anthropic-messages", AnthropicOptions> = (
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  requested?: AnthropicOptions,
): AssistantMessageEventStream => {
  const options =
    requested?.fast === true && requested.speed === undefined
      ? { ...requested, speed: "fast" as const }
      : requested;

  const normalizedContext = resolveTranscript(
    context,
    getAnthropicCompat(model).supportsMidConvoSystemMessages,
  );

  const currentTools = getCurrentTools(normalizedContext.messages);
  const nativeToolChanges = usesNativeToolChanges(model, normalizedContext);

  return runAssistantStream(
    model,
    options?.signal,
    "Anthropic",
    async (output, stream) => {
      if (
        options?.speed === "fast" &&
        !(model.provider === "anthropic" && model.modes?.includes("fast") === true)
      ) {
        throw new Error(`Anthropic fast mode is not available for ${model.provider}/${model.id}`);
      }

      let client: Anthropic;
      let isOAuth: boolean;
      let usageModel = model;
      let usedFastMode = false;

      if (options?.client) {
        client = options.client;
        isOAuth = false;
      } else {
        const apiKey = options?.apiKey;
        const federation = getAnthropicFederation(model, apiKey, options?.headers, options?.env);

        if (!federation) assertRequestAuth(model.provider, apiKey, options?.headers);

        let copilotDynamicHeaders: ProviderHeaders | undefined;

        if (model.provider === "github-copilot") {
          copilotDynamicHeaders = buildCopilotDynamicHeaders({
            messages: normalizedContext.messages,
            sessionId: options?.sessionId,
          });
        }

        const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
        const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;

        const created = createClient(
          model,
          apiKey,
          options?.interleavedThinking ?? true,
          shouldUseFineGrainedToolStreamingBeta(model, normalizedContext),
          shouldUseServerSideFallbackBeta(model),
          options?.speed === "fast",
          nativeToolChanges,
          options?.headers,
          options?.fetch,
          copilotDynamicHeaders,
          cacheSessionId,
          federation,
        );

        client = created.client;
        isOAuth = created.isOAuthToken;
      }

      const params = buildParams(model, normalizedContext, isOAuth, nativeToolChanges, options);
      await options?.onPayload?.(params, model);

      const requestOptions: Anthropic.RequestOptions = {
        signal: options?.signal,
        maxRetries: 0,
      };

      if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

      if (options?.client) {
        const requestBetas = [
          ...(options.speed === "fast" ? [FAST_MODE_BETA] : []),
          ...(nativeToolChanges ? [MID_CONVERSATION_TOOL_CHANGES_BETA] : []),
        ];

        if (requestBetas.length > 0) {
          requestOptions.headers = requestBetas.reduce(
            appendAnthropicBeta,
            mergeAnthropicHeaders(model.headers, options.headers),
          );
        }
      }

      const response = await retryProviderRequest(
        () => client.beta.messages.create({ ...params, stream: true }, requestOptions).asResponse(),
        {
          maxRetries: options?.maxRetries,
          maxRetryDelayMs: options?.maxRetryDelayMs,
          signal: options?.signal,
        },
      );

      const responseHeaders = headersToRecord(response.headers);
      await options?.onResponse?.({ status: response.status, headers: responseHeaders }, model);

      if (options?.onAccountLimits !== undefined) {
        const limits = claudeHeaderLimits(responseHeaders, model.provider);

        if (limits !== undefined) await options.onAccountLimits(limits, model);
      }

      stream.push({ type: "start", partial: output });

      type BlockSlot =
        | { kind: "content"; contentIndex: number; block: TextContent | ThinkingContent }
        | { kind: "toolCall"; contentIndex: number; block: ToolCall; json: string };

      const blocks = new Map<number, BlockSlot>();

      for await (const event of iterateAnthropicEvents(response, options?.signal)) {
        if (event.type === "message_start") {
          output.responseId = event.message.id;
          const responseModel = event.message.model;
          if (responseModel !== model.id) output.responseModel = responseModel;

          const fallbackCost =
            responseModel === model.id
              ? undefined
              : model.compat?.allowedFallbackModels?.find(
                  (fallback) =>
                    fallback.provider === model.provider && fallback.model === responseModel,
                )?.cost;

          usageModel = fallbackCost ? { ...model, id: responseModel, cost: fallbackCost } : model;
          usedFastMode = event.message.usage.speed === "fast";
          output.usage.input = event.message.usage.input_tokens || 0;
          output.usage.output = event.message.usage.output_tokens || 0;
          output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
          output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
          output.usage.cacheWrite1h =
            event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(usageModel, output.usage);
          applyAnthropicFastModePricing(output.usage, usedFastMode);
        } else if (event.type === "content_block_start") {
          const content = event.content_block;
          let block: TextContent | ThinkingContent | ToolCall;

          switch (content.type) {
            case "text":
              block = { type: "text", text: content.text ?? "" };
              break;
            case "thinking":
              block = {
                type: "thinking",
                thinking: content.thinking ?? "",
                thinkingSignature: content.signature ?? "",
              };
              break;
            case "redacted_thinking":
              block = {
                type: "thinking",
                thinking: "[Reasoning redacted]",
                thinkingSignature: content.data,
                redacted: true,
              };
              break;
            case "tool_use":
              block = {
                type: "toolCall",
                id: content.id,
                name: isOAuth ? fromClaudeCodeName(content.name, currentTools) : content.name,
                arguments: content.input ?? {},
              };
              break;
          }

          const contentIndex = output.content.push(block) - 1;

          if (block.type === "toolCall") {
            blocks.set(event.index, { kind: "toolCall", contentIndex, block, json: "" });
            stream.push({ type: "toolcall_start", contentIndex, partial: output });
          } else {
            blocks.set(event.index, { kind: "content", contentIndex, block });
            stream.push({
              type: block.type === "text" ? "text_start" : "thinking_start",
              contentIndex,
              partial: output,
            });
          }
        } else if (event.type === "content_block_delta") {
          const slot = blocks.get(event.index);

          if (!slot) continue;
          const { block, contentIndex } = slot;
          const delta = event.delta;

          if (delta.type === "text_delta" && block.type === "text") {
            block.text += delta.text;
            stream.push({ type: "text_delta", contentIndex, delta: delta.text, partial: output });
          } else if (delta.type === "thinking_delta" && block.type === "thinking") {
            block.thinking += delta.thinking;
            stream.push({
              type: "thinking_delta",
              contentIndex,
              delta: delta.thinking,
              partial: output,
            });
          } else if (delta.type === "input_json_delta" && slot.kind === "toolCall") {
            slot.json += delta.partial_json;
            slot.block.arguments = parseStreamingJson(slot.json);
            stream.push({
              type: "toolcall_delta",
              contentIndex,
              delta: delta.partial_json,
              partial: output,
            });
          } else if (delta.type === "signature_delta" && block.type === "thinking") {
            block.thinkingSignature = (block.thinkingSignature ?? "") + delta.signature;
          }
        } else if (event.type === "content_block_stop") {
          const slot = blocks.get(event.index);

          if (!slot) continue;
          blocks.delete(event.index);
          const { block, contentIndex } = slot;

          if (slot.kind === "toolCall") {
            if (slot.json.length > 0) Object.assign(slot.block, parseToolCallArguments(slot.json));
            stream.push({
              type: "toolcall_end",
              contentIndex,
              toolCall: slot.block,
              partial: output,
            });
          } else if (block.type === "text") {
            stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
          } else if (block.type === "thinking") {
            stream.push({
              type: "thinking_end",
              contentIndex,
              content: block.thinking,
              partial: output,
            });
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) {
            output.rawStopReason = event.delta.stop_reason;
            const stopReasonResult = mapStopReason(event.delta);
            output.stopReason = stopReasonResult.stopReason;

            if (stopReasonResult.errorMessage) {
              output.errorMessage = stopReasonResult.errorMessage;
            }
          }

          if (event.usage) {
            if (event.usage.input_tokens != null) {
              output.usage.input = event.usage.input_tokens;
            }

            if (event.usage.output_tokens != null) {
              output.usage.output = event.usage.output_tokens;
            }

            if (event.usage.cache_read_input_tokens != null) {
              output.usage.cacheRead = event.usage.cache_read_input_tokens;
            }

            if (event.usage.cache_creation_input_tokens != null) {
              output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
            }

            const thinkingTokens = event.usage.output_tokens_details?.thinking_tokens;

            if (thinkingTokens != null) {
              output.usage.reasoning = thinkingTokens;
            }
          }

          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(usageModel, output.usage);
          applyAnthropicFastModePricing(output.usage, usedFastMode);
        }
      }
    },
    (error) => (error instanceof Error ? error.message : JSON.stringify(error)),
  );
};

/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking.
 * Note: effort "max" is available on all adaptive-thinking Claude models, while native
 * "xhigh" is only available on Opus 4.7/4.8, Sonnet 5, and Fable 5.
 */
function mapThinkingLevelToEffort(
  model: Model<"anthropic-messages">,
  level: SimpleStreamOptions["reasoning"],
): AnthropicEffort {
  const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
  const mappedEffort = ANTHROPIC_EFFORTS.find((effort) => effort === mapped);

  if (mappedEffort !== undefined) return mappedEffort;

  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}

/**
 * Maps a simple reasoning level onto Anthropic thinking. Adaptive models take an effort;
 * budget models clamp the level to what the model supports before choosing a thinking-token
 * budget. An undefined `maxTokens` means the caller set no output cap, so the model cap is
 * used; it is never coerced to 0, which would make the thinking budget the whole `max_tokens`.
 */
export const streamSimple: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  if (!getAnthropicFederation(model, options?.apiKey, options?.headers, options?.env)) {
    assertRequestAuth(model.provider, options?.apiKey, options?.headers);
  }

  const base: AnthropicOptions = buildBaseOptions(model, context, options);

  if (!options?.reasoning) {
    return stream(model, context, {
      ...base,
      thinkingEnabled: false,
    } satisfies AnthropicOptions);
  }

  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = mapThinkingLevelToEffort(model, options.reasoning);

    return stream(model, context, {
      ...base,
      thinkingEnabled: true,
      effort,
    } satisfies AnthropicOptions);
  }

  const reasoning = clampThinkingLevel(model, options.reasoning);

  if (reasoning === "off") {
    return stream(model, context, {
      ...base,
      thinkingEnabled: false,
    } satisfies AnthropicOptions);
  }

  const adjusted = adjustMaxTokensForThinking(
    base.maxTokens,
    model.maxTokens,
    reasoning,
    options.thinkingBudgets,
  );

  const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

  return stream(model, context, {
    ...base,
    maxTokens,
    thinkingEnabled: true,
    thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
  } satisfies AnthropicOptions);
};

function systemBlock(
  text: string,
  cacheControl: BetaCacheControlEphemeral | undefined,
): BetaTextBlockParam {
  const block: BetaTextBlockParam = { type: "text", text };

  if (cacheControl) block.cache_control = cacheControl;

  return block;
}

const AnthropicMetadataSchema = Type.Object({ user_id: Type.String() });

/**
 * The Messages request body.
 *
 * - Native tool changes anchor every later declaration at its system message, so tool results
 *   carry no `tool_reference` loads; otherwise the current tool list is split between up-front
 *   definitions and the ones the transcript loaded via `addedToolNames`.
 * - With native tool changes, initial tools stay active with the cache breakpoint on the last
 *   one. Every later declaration is deferred and only surfaced by its `tool_addition` block;
 *   removed tools stay declared and are withdrawn by `tool_removal`. The request-level list
 *   therefore only grows, keeping the cached prefix intact across tool changes.
 * - Temperature is incompatible with extended thinking and unsupported on Claude Opus 4.7+.
 * - Thinking display defaults to "summarized" so Opus 4.7 and Mythos Preview behave like older
 *   Claude 4 models, whose API default is also "summarized".
 */
function buildParams(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  isOAuthToken: boolean,
  nativeToolChanges: boolean,
  options?: AnthropicOptions,
): MessageCreateParamsStreaming {
  const cacheControl = getCacheControl(model, options?.cacheRetention, options?.env);
  const compat = getAnthropicCompat(model);
  const initialSystemMessage = getInitialSystemMessage(context.messages);
  const initialSystemText = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

  const conversationMessages = initialSystemMessage
    ? transformedMessages.slice(1)
    : transformedMessages;

  const normalizeToolName = isOAuthToken ? toClaudeCodeName : (name: string) => name;
  const initialTools = initialSystemMessage?.toolsAdded ?? [];

  const toolPlacement = splitDeferredTools(
    { messages: conversationMessages, tools: getCurrentTools(context.messages) },
    compat.supportsToolReferences && !nativeToolChanges,
    normalizeToolName,
  );

  let immediateTools = toolPlacement.immediate;
  let deferredTools = [...toolPlacement.deferred.values()];

  if (immediateTools.length === 0 && deferredTools.length > 0) {
    immediateTools = deferredTools;
    deferredTools = [];
  }

  const deferredToolNames = new Set(deferredTools.map((tool) => normalizeToolName(tool.name)));

  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: convertMessages(
      conversationMessages,
      isOAuthToken,
      cacheControl,
      compat.allowEmptySignature,
      deferredToolNames,
      normalizeToolName,
      nativeToolChanges,
    ),
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
  };

  if (options?.speed !== undefined) {
    params.speed = options.speed;
  }

  if (isOAuthToken) {
    params.system = [
      systemBlock("You are Claude Code, Anthropic's official CLI for Claude.", cacheControl),
    ];

    if (initialSystemText) {
      params.system.push(systemBlock(sanitizeSurrogates(initialSystemText), cacheControl));
    }
  } else if (initialSystemText) {
    params.system = [systemBlock(sanitizeSurrogates(initialSystemText), cacheControl)];
  }

  if (
    options?.temperature !== undefined &&
    !options?.thinkingEnabled &&
    compat.supportsTemperature
  ) {
    params.temperature = options.temperature;
  }

  const toolCacheControl = compat.supportsCacheControlOnTools ? cacheControl : undefined;

  if (nativeToolChanges) {
    const initialNames = new Set(initialTools.map((tool) => tool.name));

    const laterTools = getDeclaredTools(context.messages).filter(
      (tool) => !initialNames.has(tool.name),
    );

    params.tools = [
      ...convertTools(
        initialTools,
        isOAuthToken,
        compat.supportsEagerToolInputStreaming,
        compat.supportsStrictTools,
        toolCacheControl,
      ),
      DEFERRED_TOOL_PLACEHOLDER,
      ...convertTools(
        laterTools,
        isOAuthToken,
        compat.supportsEagerToolInputStreaming,
        compat.supportsStrictTools,
      ).map((tool) => ({ ...tool, defer_loading: true })),
    ];
  } else if (immediateTools.length > 0 || deferredTools.length > 0) {
    params.tools = [
      ...convertTools(
        immediateTools,
        isOAuthToken,
        compat.supportsEagerToolInputStreaming,
        compat.supportsStrictTools,
        toolCacheControl,
      ),
      ...convertTools(
        deferredTools,
        isOAuthToken,
        compat.supportsEagerToolInputStreaming,
        compat.supportsStrictTools,
        undefined,
        true,
      ),
    ];
  }

  if (model.reasoning) {
    if (options?.thinkingEnabled) {
      const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? "summarized";

      if (model.compat?.forceAdaptiveThinking === true) {
        params.thinking = { type: "adaptive", display };

        if (options.effort) {
          params.output_config = { effort: options.effort };
        }
      } else {
        params.thinking = {
          type: "enabled",
          budget_tokens: options.thinkingBudgetTokens || 1024,
          display,
        };
      }
    } else if (options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null) {
      params.thinking = { type: "disabled" };
    }
  }

  const metadata = options?.metadata;

  if (Value.Check(AnthropicMetadataSchema, metadata)) {
    params.metadata = { user_id: metadata.user_id };
  }

  const toolChoice = options?.toolChoice;

  switch (toolChoice) {
    case undefined:
      break;
    case "auto":
    case "any":
    case "none":
      params.tool_choice = { type: toolChoice };
      break;
    default:
      params.tool_choice = toolChoice;
  }

  const allowedFallbackModels = model.compat?.allowedFallbackModels;

  if (allowedFallbackModels && allowedFallbackModels.length > 0) {
    params.fallbacks = allowedFallbackModels.map((fallback) => ({ model: fallback.model }));
  }

  return params;
}

interface StopReasonResult {
  stopReason: StopReason;
  errorMessage?: string;
}

/**
 * Maps an Anthropic stop reason. `pause_turn` counts as a stop, so the caller resubmits;
 * `stop_sequence` cannot happen because no stop sequences are sent; `sensitive` (content
 * flagged by safety filters, not yet in the SDK types) is an error.
 */
function mapStopReason(
  delta: Extract<AnthropicEvent, { type: "message_delta" }>["delta"],
): StopReasonResult {
  const reason = delta.stop_reason;

  switch (reason) {
    case "end_turn":
      return { stopReason: "stop" };
    case "max_tokens":
      return { stopReason: "length" };
    case "tool_use":
      return { stopReason: "toolUse" };
    case "refusal":
      return {
        stopReason: "error",
        errorMessage:
          delta.stop_details?.explanation || `The model refused to complete the request`,
      };
    case "pause_turn":
      return { stopReason: "stop" };
    case "stop_sequence":
      return { stopReason: "stop" };
    case "sensitive":
      return { stopReason: "error", errorMessage: "Provider stopped with: sensitive" };
    default:
      throw new Error(`Unhandled stop reason: ${reason}`);
  }
}
