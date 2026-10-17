import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { applyServiceTierPricing } from "../model-pricing.ts";
import type {
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
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { getClientApiKey, headersToRecord, mergeProviderHeaders } from "../utils/headers.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { runAssistantStream } from "./assistant-stream.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { buildCopilotDynamicHeaders } from "./github-copilot-headers.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  type ResponsesInput,
  type ResponsesTool,
} from "./openai-responses-convert.ts";
import { processResponsesStream, withPriorityTier } from "./openai-responses-stream.ts";
import { readOpenAICompactResponse, type OpenAICompactResult } from "./openai-compact.ts";
import { buildBaseOptions, simpleReasoningEffort } from "./simple-options.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

// OpenAI Responses rejects max_output_tokens below 16.
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

function getCompat(model: Model<"openai-responses">): Required<OpenAIResponsesCompat> {
  return {
    supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    sessionAffinityFormat: model.compat?.sessionAffinityFormat ?? "openai",
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

/**
 * The Responses request body as sent. The SDK's create params cannot carry replayed checkpoint
 * items, function tools without `strict`, or reasoning efforts newer than its union, such as
 * "max", which the API accepts.
 */
type ResponsesRequest = Omit<ResponseCreateParamsStreaming, "input" | "tools" | "reasoning"> & {
  input: ResponsesInput;
  tools?: ResponsesTool[];
  reasoning?: { effort: string; summary?: "auto" | "concise" | "detailed" | null };
  prompt_cache_options?: { mode?: "explicit"; ttl?: "30m" };
};

export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  toolChoice?: ResponseCreateParamsStreaming["tool_choice"];
}

/**
 * Compact through OpenAI's stateless endpoint, preserving its complete output window.
 * https://developers.openai.com/api/docs/guides/compaction#standalone-compact-endpoint
 * Instructions travel separately, so the input does not repeat the system message.
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

  const requestOptions: OpenAI.RequestOptions = { maxRetries: 0 };

  const serviceTier = options?.serviceTier === "priority" ? "priority" : undefined;

  if (options?.signal !== undefined) requestOptions.signal = options.signal;

  if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

  const response = await retryProviderRequest(
    () =>
      client
        .post("/responses/compact", {
          body: { model: model.id, input, instructions, service_tier: serviceTier },
          ...requestOptions,
          __security: { bearerAuth: true },
        })
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

/** Streams an OpenAI Responses request. */
export const stream: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  requested?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
  const options = withPriorityTier(requested);

  const normalizedContext = resolveTranscript(
    context,
    getCompat(model).supportsMidConvoSystemMessages,
  );

  return runAssistantStream(
    model,
    options?.signal,
    "OpenAI Responses",
    async (output, stream) => {
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

      const params = buildParams(
        model,
        normalizedContext,
        options,
        compat,
        cacheRetention,
        grammarToolInputProperties,
      );

      await options?.onPayload?.(params, model);

      const requestOptions: OpenAI.RequestOptions = { maxRetries: 0 };

      if (options?.signal) requestOptions.signal = options.signal;

      if (options?.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

      const result = await retryProviderRequest(
        () =>
          client
            .post<Stream<unknown>>("/responses", {
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

      await processResponsesStream(result.data, output, stream, model, {
        serviceTier: options?.serviceTier,
        grammarToolInputProperties,
        applyServiceTierPricing: (usage, serviceTier) =>
          applyServiceTierPricing(usage, serviceTier, model),
      });
    },
    (error) =>
      formatProviderError(
        normalizeProviderError(error),
        `${model.provider === "openai" ? "OpenAI" : model.provider} API error`,
      ),
  );
};

export const streamSimple: StreamFunction<"openai-responses", SimpleStreamOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  getClientApiKey(model.provider, options?.apiKey, options?.headers);

  return stream(model, context, {
    ...buildBaseOptions(model, context, options),
    reasoningEffort: simpleReasoningEffort(model, options?.reasoning),
  });
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
 * The Responses request body.
 *
 * - Later system messages anchor their own tool additions, and `addedToolNames` on a tool result
 *   only loads request-list tools the transcript did not anchor, so nothing is declared twice.
 * - Stateless (`store: false`) providers continue reasoning across turns only when every response
 *   carries its encrypted reasoning back, so xAI and Copilot always request it.
 * - `samplingParams` merge last, so custom keys override the named request fields.
 */
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

  const params: ResponsesRequest = {
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

      params.reasoning = { effort, summary: options?.reasoningSummary || "auto" };
      params.include = ["reasoning.encrypted_content"];
    } else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) {
      params.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
    }

    if (model.provider === "xai" || model.provider === "github-copilot") {
      params.include = ["reasoning.encrypted_content"];
    }
  }

  if (options?.samplingParams) {
    Object.assign(params, options.samplingParams);
  }

  return params;
}
