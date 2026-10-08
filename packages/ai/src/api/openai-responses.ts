/**
 * OpenAI Responses adapter.
 *
 * Based on https://github.com/earendil-works/pi/blob/0c7bb7c5c72118e4c71e4c04dfa2ad4a0a6a62f1/packages/ai/src/api/openai-responses.ts
 * Synced with pi 0c7bb7c5c.
 */
/**
 * OpenAI Responses adapter.
 *
 * Based on https://github.com/earendil-works/pi/blob/17de82d7bea18a6589677a9761baabc2060c9efb/packages/ai/src/api/openai-responses.ts
 * Synced with pi 17de82d7b.
 */
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { clampThinkingLevel } from "../models.ts";
import { applyServiceTierPricing } from "../model-pricing.ts";
import type {
  AssistantMessage,
  CacheRetention,
  Context,
  Model,
  OpenAIResponsesCompat,
  ProviderHeaders,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TranscriptContext,
} from "../types.ts";
import { resolveCacheRetention } from "../prompt-cache.ts";
import { splitDeferredTools } from "../utils/deferred-tools.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  getDeclaredTools,
  getInitialSystemMessage,
  normalizeContext,
  resolveTranscript,
  resolveTranscriptTools,
} from "../utils/transcript.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { getClientApiKey, headersToRecord, mergeProviderHeaders } from "../utils/headers.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { buildCopilotDynamicHeaders } from "./github-copilot-headers.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
  stripStreamingScratchState,
  withPriorityTier,
} from "./openai-responses-shared.ts";
import { readOpenAICompactResponse, type OpenAICompactResult } from "./openai-compact.ts";
import { buildBaseOptions } from "./simple-options.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

// OpenAI Responses rejects max_output_tokens below 16: https://github.com/earendil-works/pi/issues/6265
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

function detectSessionAffinityFormat(
  model: Pick<Model<"openai-responses">, "provider" | "baseUrl">,
) {
  return model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")
    ? "openrouter"
    : "openai";
}

function getCompat(model: Model<"openai-responses">): Required<OpenAIResponsesCompat> {
  return {
    supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    sessionAffinityFormat:
      model.compat?.sessionAffinityFormat ?? detectSessionAffinityFormat(model),
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    supportsStrictMode: model.compat?.supportsStrictMode ?? false,
    supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
    supportsAdditionalTools: model.compat?.supportsAdditionalTools ?? false,
    supportsToolSearch: model.compat?.supportsToolSearch ?? false,
    supportsExplicitPromptCacheMode: model.compat?.supportsExplicitPromptCacheMode ?? false,
  };
}

function getPromptCacheRetention(
  compat: Required<OpenAIResponsesCompat>,
  cacheRetention: CacheRetention,
): "24h" | undefined {
  return cacheRetention === "long" &&
    compat.supportsLongCacheRetention &&
    !compat.supportsExplicitPromptCacheMode
    ? "24h"
    : undefined;
}

function getPromptCacheOptions(
  compat: Required<OpenAIResponsesCompat>,
  cacheRetention: CacheRetention,
): { mode?: "explicit"; ttl?: "30m" } | undefined {
  if (!compat.supportsExplicitPromptCacheMode) return undefined;
  if (cacheRetention === "none") return { mode: "explicit" };
  if (cacheRetention === "long" && compat.supportsLongCacheRetention) return { ttl: "30m" };
  return undefined;
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  toolChoice?: ResponseCreateParamsStreaming["tool_choice"];
}

/**
 * Compact through OpenAI's stateless endpoint, preserving its complete output window.
 * https://developers.openai.com/api/docs/guides/compaction#standalone-compact-endpoint
 */
export async function compactOpenAIResponsesContext(
  model: Model<"openai-responses">,
  context: Context,
  requested?: OpenAIResponsesOptions,
): Promise<OpenAICompactResult> {
  const options = withPriorityTier(requested);
  const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
  const compat = getCompat(model);
  const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
  const transcript = resolveTranscript(
    normalizeContext(context),
    compat.supportsMidConvoSystemMessages,
  );

  const client = createClient({
    model,
    context: transcript,
    apiKey,
    options: { headers: options?.headers, fetch: options?.fetch },
    compat,
    cacheRetention,
  });

  // Instructions travel separately so the request does not duplicate the system message.
  const initialSystemMessage = getInitialSystemMessage(transcript.messages);
  const instructions = initialSystemMessage
    ? getSystemMessageText(initialSystemMessage)
    : undefined;

  const input = buildParams(
    model,
    transcript,
    options,
    compat,
    cacheRetention,
    undefined,
    false,
  ).input;

  const requestOptions: NonNullable<Parameters<typeof client.responses.compact>[1]> = {
    maxRetries: 0,
  };

  // The compact endpoint offers the priority tier and nothing else of ours.
  const serviceTier = options?.serviceTier === "priority" ? "priority" : undefined;

  if (options?.signal !== undefined) requestOptions.signal = options.signal;

  if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

  const response = await retryProviderRequest(
    () =>
      client.responses
        .compact(
          { model: model.id, input, instructions, service_tier: serviceTier },
          requestOptions,
        )
        .asResponse(),
    {
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
    },
  );

  await options?.onResponse?.(
    { status: response.status, headers: headersToRecord(response.headers) },
    model,
  );

  return readOpenAICompactResponse(response, model, serviceTier);
}

/**
 * Generate function for OpenAI Responses API
 */
export const stream: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  requested?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
  const options = withPriorityTier(requested);
  const stream = new AssistantMessageEventStream();

  const normalizedContext = resolveTranscript(
    context,
    getCompat(model).supportsMidConvoSystemMessages,
  );

  // Start async processing
  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      // Create OpenAI client
      const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
      const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
      const compat = getCompat(model);

      const grammarToolInputProperties = createGrammarToolInputProperties(
        getDeclaredTools(normalizedContext.messages),
        compat.supportsOpenAIGrammarTools,
      );

      const client = createClient({
        model,
        context: normalizedContext,
        apiKey,
        options,
        cacheRetention,
        compat,
      });

      let params = buildParams(
        model,
        normalizedContext,
        options,
        compat,
        cacheRetention,
        grammarToolInputProperties,
      );

      const nextParams = await options?.onPayload?.(params, model);

      if (nextParams !== undefined) {
        // SAFETY: onPayload's contract is to return this provider's request body (possibly mutated); its signature is unknown because each API defines its own shape.
        params = nextParams as ResponseCreateParamsStreaming;
      }

      const requestOptions: OpenAI.RequestOptions = { maxRetries: 0 };

      if (options?.signal) requestOptions.signal = options.signal;

      if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

      const result = await retryProviderRequest(
        () => client.responses.create(params, requestOptions).withResponse(),
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

      await processResponsesStream(result.data, output, stream, model, {
        serviceTier: options?.serviceTier,
        grammarToolInputProperties,
        applyServiceTierPricing: (usage, serviceTier) =>
          applyServiceTierPricing(usage, serviceTier, model),
      });

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "pending") {
        throw new Error("OpenAI Responses stream ended without a stop reason");
      }

      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      stripStreamingScratchState(output.content);

      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = formatProviderError(
        normalizeProviderError(error),
        `${model.provider === "openai" ? "OpenAI" : model.provider} API error`,
      );
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

export const streamSimple: StreamFunction<"openai-responses", SimpleStreamOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  getClientApiKey(model.provider, options?.apiKey, options?.headers);

  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  } satisfies OpenAIResponsesOptions;

  const clampedReasoning = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;

  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

  return stream(model, context, {
    ...base,
    reasoningEffort,
  } satisfies OpenAIResponsesOptions);
};

function createClient(input: {
  model: Model<"openai-responses">;
  context: TranscriptContext;
  apiKey: string;
  options: Pick<OpenAIResponsesOptions, "fetch" | "headers" | "sessionId"> | undefined;
  cacheRetention: CacheRetention;
  compat: Required<OpenAIResponsesCompat>;
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

  if (cacheSessionId) {
    if (input.compat.sessionAffinityFormat === "openrouter") {
      affinityHeaders["x-session-id"] = cacheSessionId;
    } else {
      if (input.compat.sessionAffinityFormat === "openai") {
        affinityHeaders.session_id = cacheSessionId;
      }

      affinityHeaders["x-client-request-id"] = cacheSessionId;
    }
  }

  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: input.options?.fetch,
    // Options headers come last so they can override defaults
    defaultHeaders: mergeProviderHeaders(
      { "User-Agent": getNyteUserAgent() },
      input.model.headers,
      copilotHeaders,
      affinityHeaders,
      input.options?.headers,
    ),
  });
}

function buildParams(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options: OpenAIResponsesOptions | undefined,
  compat: Required<OpenAIResponsesCompat> = getCompat(model),
  cacheRetention: CacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env),
  grammarToolInputProperties: ReadonlyMap<string, string> = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    compat.supportsOpenAIGrammarTools,
  ),
  includeSystemPrompt = true,
) {
  const deferredToolsMode = compat.supportsAdditionalTools
    ? "additional-tools"
    : compat.supportsToolSearch
      ? "tool-search"
      : undefined;

  // Later system messages anchor their own additions; `addedToolNames` on a tool result
  // only loads request-list tools the transcript did not anchor, so nothing is declared twice.
  const transcriptTools = resolveTranscriptTools(context.messages, deferredToolsMode !== undefined);

  const toolPlacement = splitDeferredTools(
    { messages: context.messages, tools: transcriptTools.requestTools },
    deferredToolsMode !== undefined,
  );

  const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
    includeSystemPrompt,
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
    deferredTools: toolPlacement.deferred,
    deferredToolsMode,
    toolOptions: {
      supportsStrictMode: compat.supportsStrictMode,
      supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
    },
  });

  const params: ResponseCreateParamsStreaming & {
    prompt_cache_options?: { mode?: "explicit"; ttl?: "30m" };
  } = {
    model: model.id,
    input: messages,
    stream: true,
    prompt_cache_key:
      cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
    prompt_cache_retention: getPromptCacheRetention(compat, cacheRetention),
    prompt_cache_options: getPromptCacheOptions(compat, cacheRetention),
    store: false,
  };

  if (options?.maxTokens) {
    params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
  }

  if (options?.temperature !== undefined) {
    params.temperature = options?.temperature;
  }

  if (options?.serviceTier !== undefined) {
    params.service_tier = options.serviceTier;
  }

  if (toolPlacement.immediate.length > 0) {
    params.tools = convertResponsesTools(toolPlacement.immediate, {
      supportsStrictMode: compat.supportsStrictMode,
      supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
    });
  }

  if (options?.toolChoice !== undefined) {
    params.tool_choice = options.toolChoice;
  }

  if (model.reasoning) {
    if (options?.reasoningEffort || options?.reasoningSummary) {
      const effort = options?.reasoningEffort
        ? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
        : "medium";

      params.reasoning = {
        // SAFETY: effort is the caller's level or the model's mapped level; the API accepts
        // levels such as "max" that the SDK's ReasoningEffort union does not list yet.
        effort: effort as NonNullable<typeof params.reasoning>["effort"],
        summary: options?.reasoningSummary || "auto",
      };
      params.include = ["reasoning.encrypted_content"];
    } else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) {
      params.reasoning = {
        // SAFETY: the off level comes from model metadata written for this API.
        effort: (model.thinkingLevelMap?.off ?? "none") as NonNullable<
          typeof params.reasoning
        >["effort"],
      };
    }

    // Stateless (store: false) providers can only continue reasoning across
    // turns when every response carries its encrypted reasoning back.
    if (model.provider === "xai" || model.provider === "github-copilot") {
      params.include = ["reasoning.encrypted_content"];
    }
  }

  // Last so custom keys override the named request fields.
  if (options?.samplingParams) {
    Object.assign(params, options.samplingParams);
  }

  return params;
}
