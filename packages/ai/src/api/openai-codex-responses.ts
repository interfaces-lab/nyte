/**
 * The ChatGPT Codex Responses adapter: WebSocket first when the transport allows it, zstd SSE
 * otherwise or after a WebSocket transport failure.
 */
import { codexHeaderLimits } from "../providers/openai-codex-limits.ts";
import type {
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  TranscriptContext,
} from "../types.ts";
import { formatThrownValue } from "../utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { reportsQuotaExhaustion } from "../utils/failure.ts";
import { headersToRecord } from "../utils/headers.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { getDeclaredTools, resolveTranscript } from "../utils/transcript.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { runAssistantStream } from "./assistant-stream.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import {
  buildRequestBody,
  type CodexRequest,
  CodexRequestError,
  codexStreamOptions,
  compressRequestBodyZstd,
  mapCodexEvents,
  type OpenAICodexResponsesOptions,
  parseErrorResponse,
  parseSSE,
  retryableCodexRequest,
} from "./openai-codex-protocol.ts";
import { streamOverWebSocket } from "./openai-codex-websocket.ts";
import {
  buildSSEHeaders,
  buildWebSocketHeaders,
  extractAccountId,
  normalizeTimeoutMs,
  resolveCodexUrl,
} from "./openai-codex-wire.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import { processResponsesStream, withPriorityTier } from "./openai-responses-stream.ts";
import { buildBaseOptions, simpleReasoningEffort } from "./simple-options.ts";

/**
 * Opens one Codex SSE response. `timeoutMs` bounds the wait for response headers; a transport
 * failure or non-2xx answer throws a {@link CodexRequestError}.
 */
async function openCodexSse(
  model: Model<"openai-codex-responses">,
  headers: Headers,
  body: string | Uint8Array<ArrayBuffer>,
  timeoutMs: number | undefined,
  options: OpenAICodexResponsesOptions | undefined,
): Promise<Response> {
  const headerTimeout = new AbortController();
  const timer =
    timeoutMs !== undefined && timeoutMs > 0
      ? setTimeout(() => headerTimeout.abort(), timeoutMs)
      : undefined;
  const signal = options?.signal
    ? AbortSignal.any([options.signal, headerTimeout.signal])
    : headerTimeout.signal;
  let response: Response;

  try {
    response = await (options?.fetch ?? globalThis.fetch)(resolveCodexUrl(model.baseUrl), {
      method: "POST",
      headers,
      body,
      signal,
    });
  } catch (cause) {
    if (options?.signal?.aborted) throw cause;

    throw new CodexRequestError(
      headerTimeout.signal.aborted
        ? `Codex SSE response headers timed out after ${String(timeoutMs)}ms`
        : formatThrownValue(cause),
      undefined,
      undefined,
      true,
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  const responseHeaders = headersToRecord(response.headers);
  await options?.onResponse?.({ status: response.status, headers: responseHeaders }, model);

  if (response.ok) {
    if (options?.onAccountLimits !== undefined) {
      const limits = codexHeaderLimits(responseHeaders, model.provider);

      if (limits !== undefined) await options.onAccountLimits(limits, model);
    }

    return response;
  }

  const errorText = await response.text();
  const info = parseErrorResponse(errorText, response);

  throw new CodexRequestError(
    info.friendlyMessage || info.message,
    response.status,
    response.headers,
    !(response.status === 429 && reportsQuotaExhaustion(errorText)),
  );
}

/**
 * Sends `request` over SSE with a zstd-compressed body, which the Codex backend decodes; the
 * WebSocket transport sends the uncompressed JSON frame, matching the official Codex client.
 */
async function streamOverSse(
  request: CodexRequest,
  headers: Headers,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): Promise<void> {
  const { model, options } = request;
  const bodyJson = JSON.stringify(request.body);
  const compressedBody = compressRequestBodyZstd(bodyJson);

  if (compressedBody) headers.set("content-encoding", "zstd");
  const response = await retryProviderRequest(
    () => openCodexSse(model, headers, compressedBody ?? bodyJson, request.timeoutMs, options),
    {
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
      retryable: retryableCodexRequest,
    },
  );

  if (!response.body) throw new Error("No response body");

  stream.push({ type: "start", partial: output });
  await processResponsesStream(
    mapCodexEvents(parseSSE(response, options?.signal), output),
    output,
    stream,
    model,
    codexStreamOptions(request),
  );
}

export const stream: StreamFunction<"openai-codex-responses", OpenAICodexResponsesOptions> = (
  model: Model<"openai-codex-responses">,
  context: TranscriptContext,
  requested?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
  const options = withPriorityTier(requested);
  const normalizedContext = resolveTranscript(
    context,
    model.compat?.supportsMidConvoSystemMessages,
  );

  return runAssistantStream(model, options?.signal, "Codex", async (output, stream) => {
    const apiKey = options?.apiKey;

    if (!apiKey) {
      throw new Error(`No API key for provider: ${model.provider}`);
    }

    const accountId = extractAccountId(apiKey);
    const grammarToolInputProperties = createGrammarToolInputProperties(
      getDeclaredTools(normalizedContext.messages),
      model.compat?.supportsOpenAIGrammarTools ?? false,
    );
    const cacheSessionId = options?.cacheRetention === "none" ? undefined : options?.sessionId;
    const codexSessionId = clampOpenAIPromptCacheKey(cacheSessionId);
    const body = buildRequestBody(
      model,
      normalizedContext,
      options,
      codexSessionId,
      grammarToolInputProperties,
    );

    await options?.onPayload?.(body, model);

    const request: CodexRequest = {
      model,
      body,
      accountId,
      cacheSessionId,
      grammarToolInputProperties,
      timeoutMs: normalizeTimeoutMs(options?.timeoutMs),
      connectTimeoutMs: normalizeTimeoutMs(options?.websocketConnectTimeoutMs),
      options,
    };
    const websocketHeaders = buildWebSocketHeaders(
      model.headers,
      options?.headers,
      accountId,
      apiKey,
      codexSessionId || uuidv7(),
    );

    if (await streamOverWebSocket(request, websocketHeaders, output, stream)) return;

    await streamOverSse(
      request,
      buildSSEHeaders(model.headers, options?.headers, accountId, apiKey, codexSessionId),
      output,
      stream,
    );
  });
};

export const streamSimple: StreamFunction<"openai-codex-responses", SimpleStreamOptions> = (
  model: Model<"openai-codex-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);

  return stream(model, context, {
    ...buildBaseOptions(model, context, options),
    reasoningEffort: simpleReasoningEffort(model, options.reasoning),
  });
};
