import { OpenAICodexCompactionError } from "./openai-codex-compaction-error.ts";
import type * as NodeZlib from "node:zlib";
import type {
  Tool as OpenAITool,
  ResponseCompactionItemParam,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

import { calculateCost, clampThinkingLevel } from "../models.ts";
import { getServiceTierCostMultiplier } from "../model-pricing.ts";
import { registerSessionResourceCleanup } from "../session-resources.ts";
import type {
  AccountLimits,
  Api,
  AssistantMessage,
  Context,
  JsonValue,
  Model,
  ProviderEnv,
  ProviderHeaders,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  Usage,
} from "../types.ts";
import { combineAbortSignals } from "../utils/abort-signals.ts";
import { splitDeferredTools } from "../utils/deferred-tools.ts";
import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
  formatThrownValue,
} from "../utils/diagnostics.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import type { OpenAICompactResult } from "./openai-compact.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
  type ResponsesStreamEvent,
  ResponsesUsageError,
  stripStreamingScratchState,
} from "./openai-responses-shared.ts";
import { buildBaseOptions } from "./simple-options.ts";

// ============================================================================
// Wire Decoding
// ============================================================================

/**
 * The fields this adapter acts on in a raw Codex SSE/WebSocket frame. Frames
 * carry more fields; unlisted ones pass through untouched. Decoding happens once
 * at the two ingress points (`parseSSE`, `parseWebSocket`) so downstream code
 * branches on decoded values instead of re-narrowing raw JSON.
 */
interface CodexFrame {
  readonly type: string;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly error?: unknown;
  readonly response?: unknown;
  readonly item?: unknown;
}

interface CodexEventError {
  code?: string;
  message?: string;
}

/** A Codex terminal response status. */
const CodexResponseStatusSchema = Type.Union([
  Type.Literal("completed"),
  Type.Literal("incomplete"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("queued"),
  Type.Literal("in_progress"),
]);
type CodexResponseStatus = Static<typeof CodexResponseStatusSchema>;

const TextJson = Type.String();
const BooleanJson = Type.Boolean();
const NumberJson = Type.Number();
const JsonObjectJson = Type.Record(Type.String(), Type.Unknown());
const CodexFrameJson = Type.Object({ type: Type.String() });

function textOf(value: unknown): string | undefined {
  return Value.Check(TextJson, value) ? value : undefined;
}

function boolOf(value: unknown): boolean | undefined {
  return Value.Check(BooleanJson, value) ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return Value.Check(NumberJson, value) ? value : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return Value.Check(JsonObjectJson, value) ? value : undefined;
}

/** Returns the frame when its payload decodes, or `undefined` for frames without an event type. */
function decodeCodexFrame(value: unknown): CodexFrame | undefined {
  if (!Value.Check(CodexFrameJson, value)) return undefined;
  return value;
}

function isTerminalResponseType(type: string): boolean {
  return (
    type === "response.completed" ||
    type === "response.done" ||
    type === "response.incomplete" ||
    type === "response.failed"
  );
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_COMPACT_IDLE_TIMEOUT_MS = 300_000;
const BASE_DELAY_MS = 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;
// The Codex backend accepts zstd-compressed request bodies on the SSE responses
// endpoint (the same endpoint the official Codex client compresses against).
const REQUEST_COMPRESSION_ZSTD_LEVEL = 3;
const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";
const PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found";

// ============================================================================
// Types
// ============================================================================

export interface OpenAICodexResponsesOptions extends StreamOptions {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  textVerbosity?: "low" | "medium" | "high";
  toolChoice?: "auto" | "none" | "required";
}

interface RequestBody {
  model: string;
  store?: boolean;
  stream?: boolean;
  instructions?: string;
  previous_response_id?: string;
  input?: ResponseInput;
  tools?: OpenAITool[];
  tool_choice?: OpenAICodexResponsesOptions["toolChoice"];
  parallel_tool_calls?: boolean;
  temperature?: number;
  reasoning?: { effort?: string; summary?: string };
  service_tier?: ResponseCreateParamsStreaming["service_tier"];
  text?: { verbosity?: string };
  include?: string[];
  prompt_cache_key?: string;
  [key: string]: unknown;
}

type SuccessfulAssistantMessage = AssistantMessage & { stopReason: "stop" | "length" | "toolUse" };

function assertSuccessfulOutput(
  output: AssistantMessage,
): asserts output is SuccessfulAssistantMessage {
  if (output.stopReason === "pending") {
    throw new Error("Codex stream ended without a stop reason");
  }
  if (output.stopReason === "error" || output.stopReason === "aborted") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
}

// ============================================================================
// Retry Helpers
// ============================================================================

function isTerminalRateLimitError(errorText: string): boolean {
  return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(
    errorText,
  );
}

function isRetryableError(status: number, errorText: string): boolean {
  if (status === 429 && isTerminalRateLimitError(errorText)) {
    return false;
  }
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(
    errorText,
  );
}

function getRetryAfterDelayMs(headers: Headers): number | undefined {
  const retryAfterMs = headers.get("retry-after-ms");
  if (retryAfterMs !== null) {
    const millis = Number(retryAfterMs);
    if (Number.isFinite(millis)) {
      return Math.max(0, millis);
    }
  }

  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

class RetryDelayExceededError extends Error {}

function validateRetryDelayMs(delayMs: number, options?: StreamOptions): number {
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  if (maxRetryDelayMs > 0 && delayMs > maxRetryDelayMs) {
    throw new RetryDelayExceededError(
      `Server requested ${Math.ceil(delayMs / 1000)}s retry delay (max: ${Math.ceil(maxRetryDelayMs / 1000)}s)`,
    );
  }
  return delayMs;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request was aborted"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Request was aborted"));
    });
  });
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid timeoutMs: ${String(value)}`);
  }
  return Math.floor(value);
}

// ============================================================================
// Request Compression
// ============================================================================

interface NodeProcessLike {
  versions?: { node?: string; bun?: string };
  getBuiltinModule?: (id: string) => typeof NodeZlib;
}

function nodeProcessLike(): NodeProcessLike | undefined {
  // SAFETY: reads the ambient `process` object structurally so this module also loads in browser builds where it is undefined.
  return (globalThis as { process?: NodeProcessLike }).process;
}

function loadNodeZlib(): typeof NodeZlib | null {
  const proc = nodeProcessLike();
  if (!proc?.versions?.node && !proc?.versions?.bun) {
    return null;
  }
  return proc.getBuiltinModule?.("node:zlib") ?? null;
}

// Returns the zstd-compressed body bytes, or null when compression is
// unavailable (browser/Vite builds). Callers fall back to sending the
// uncompressed JSON when this returns null.
function compressRequestBodyZstd(bodyJson: string): Uint8Array | null {
  const zlib = loadNodeZlib();
  if (!zlib) {
    return null;
  }
  try {
    // A runtime without zstd support throws below and lands in the catch.
    const compressed = zlib.zstdCompressSync(bodyJson, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: REQUEST_COMPRESSION_ZSTD_LEVEL },
    });
    return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  } catch {
    return null;
  }
}

// ============================================================================
// Main Stream Function
// ============================================================================

export const stream: StreamFunction<"openai-codex-responses", OpenAICodexResponsesOptions> = (
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "openai-codex-responses",
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
      const apiKey = options?.apiKey;
      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }

      const accountId = extractAccountId(apiKey);
      const grammarToolInputProperties = createGrammarToolInputProperties(
        context.tools,
        model.compat?.supportsOpenAIGrammarTools ?? false,
      );
      const cacheSessionId = options?.cacheRetention === "none" ? undefined : options?.sessionId;
      const codexSessionId = clampOpenAIPromptCacheKey(cacheSessionId);
      let body = buildRequestBody(
        model,
        context,
        options,
        codexSessionId,
        grammarToolInputProperties,
      );
      const nextBody = await options?.onPayload?.(body, model);
      if (nextBody !== undefined) {
        // SAFETY: onPayload's contract is to return this provider's request body (possibly mutated); its signature is unknown because each API defines its own shape.
        body = nextBody as RequestBody;
      }
      const websocketRequestId = codexSessionId || uuidv7();
      const sseHeaders = buildSSEHeaders(
        model.headers,
        options?.headers,
        accountId,
        apiKey,
        codexSessionId,
      );
      const websocketHeaders = buildWebSocketHeaders(
        model.headers,
        options?.headers,
        accountId,
        apiKey,
        websocketRequestId,
      );
      const bodyJson = JSON.stringify(body);
      const httpTimeoutMs = normalizeTimeoutMs(options?.timeoutMs);
      const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs);
      const transport = options?.transport || "auto";
      let startEmitted = false;
      const websocketDisabledForSession =
        transport !== "sse" && isWebSocketSseFallbackActive(cacheSessionId);
      if (websocketDisabledForSession) {
        recordWebSocketSseFallback(cacheSessionId);
      }

      if (transport !== "sse" && !websocketDisabledForSession) {
        let websocketStarted = false;
        let retriedWebSocketConnectionLimit = false;
        let retriedMissingWebSocketContinuation = false;
        while (true) {
          websocketStarted = false;
          try {
            await processWebSocketStream(
              resolveCodexWebSocketUrl(model.baseUrl),
              body,
              websocketHeaders,
              output,
              stream,
              model,
              () => {
                websocketStarted = true;
                if (!startEmitted) {
                  startEmitted = true;
                  stream.push({ type: "start", partial: output });
                }
              },
              httpTimeoutMs,
              websocketConnectTimeoutMs,
              cacheSessionId,
              accountId,
              grammarToolInputProperties,
              options,
            );

            if (options?.signal?.aborted) {
              throw new Error("Request was aborted");
            }
            assertSuccessfulOutput(output);
            stream.push({
              type: "done",
              reason: output.stopReason,
              message: output,
            });
            stream.end();
            return;
          } catch (error) {
            const aborted = options?.signal?.aborted;
            const connectionLimitBeforeStart =
              !websocketStarted && isWebSocketConnectionLimitReachedError(error);
            const previousResponseNotFound = isPreviousResponseNotFoundError(error);
            if (!aborted && previousResponseNotFound && !retriedMissingWebSocketContinuation) {
              retriedMissingWebSocketContinuation = true;
              continue;
            }
            if (!aborted && connectionLimitBeforeStart && !retriedWebSocketConnectionLimit) {
              retriedWebSocketConnectionLimit = true;
              continue;
            }
            if (aborted || (isCodexNonTransportError(error) && !connectionLimitBeforeStart)) {
              throw error;
            }
            appendAssistantMessageDiagnostic(
              output,
              createAssistantMessageDiagnostic("provider_transport_failure", error, {
                configuredTransport: transport,
                fallbackTransport: websocketStarted ? undefined : "sse",
                eventsEmitted: websocketStarted,
                phase: websocketStarted
                  ? "after_message_stream_start"
                  : "before_message_stream_start",
                requestBytes: new TextEncoder().encode(bodyJson).byteLength,
              }),
            );
            recordWebSocketFailure(cacheSessionId, error);
            if (websocketStarted) {
              throw error;
            }
            recordWebSocketSseFallback(cacheSessionId);
            break;
          }
        }
      }

      // Compress the request body once for the SSE path. The Codex backend
      // decodes Content-Encoding: zstd; the WebSocket transport above sends the
      // uncompressed JSON frame, matching the official Codex client.
      const compressedBody = compressRequestBodyZstd(bodyJson);
      if (compressedBody) {
        sseHeaders.set("content-encoding", "zstd");
      }
      const sseBody: Uint8Array | string = compressedBody ?? bodyJson;

      // Fetch with retry logic for rate limits and transient errors
      let response: Response | undefined;
      let lastError: Error | undefined;
      const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }

        try {
          const headerTimeoutSignal =
            httpTimeoutMs !== undefined && httpTimeoutMs > 0
              ? AbortSignal.timeout(httpTimeoutMs)
              : undefined;
          const combinedSignal = combineAbortSignals([options?.signal, headerTimeoutSignal]);
          try {
            response = await (options?.fetch ?? globalThis.fetch)(resolveCodexUrl(model.baseUrl), {
              method: "POST",
              headers: sseHeaders,
              // SAFETY: a zstd-compressed Uint8Array is valid BodyInit at runtime; TS 5.7+ types Buffer as Uint8Array<ArrayBufferLike>, which DOM's BodyInit rejects (Nyte divergence).
              body: sseBody as NonNullable<Parameters<typeof fetch>[1]>["body"],
              signal: combinedSignal.signal,
            });
          } catch (error) {
            if (headerTimeoutSignal?.aborted && !options?.signal?.aborted) {
              throw new Error(`Codex SSE response headers timed out after ${httpTimeoutMs}ms`);
            }
            throw error;
          } finally {
            combinedSignal.cleanup();
          }
          await options?.onResponse?.(
            { status: response.status, headers: headersToRecord(response.headers) },
            model,
          );

          if (response.ok) {
            break;
          }

          const errorText = await response.text();
          if (attempt < maxRetries && isRetryableError(response.status, errorText)) {
            const retryAfterDelayMs = getRetryAfterDelayMs(response.headers);
            const delayMs =
              retryAfterDelayMs === undefined
                ? BASE_DELAY_MS * 2 ** attempt
                : validateRetryDelayMs(retryAfterDelayMs, options);

            await sleep(delayMs, options?.signal);
            continue;
          }

          // Parse error for friendly message on final attempt or non-retryable error
          const fakeResponse = new Response(errorText, {
            status: response.status,
            statusText: response.statusText,
          });
          const info = await parseErrorResponse(fakeResponse);
          throw new Error(info.friendlyMessage || info.message);
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === "AbortError" || error.message === "Request was aborted") {
              throw new Error("Request was aborted");
            }
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          // Network errors are retryable
          if (
            attempt < maxRetries &&
            !(lastError instanceof RetryDelayExceededError) &&
            !lastError.message.includes("usage limit")
          ) {
            const delayMs = BASE_DELAY_MS * 2 ** attempt;
            await sleep(delayMs, options?.signal);
            continue;
          }
          throw lastError;
        }
      }

      if (!response?.ok) {
        throw lastError ?? new Error("Failed after retries");
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      if (!startEmitted) {
        startEmitted = true;
        stream.push({ type: "start", partial: output });
      }
      await processStream(response, output, stream, model, grammarToolInputProperties, options);

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      assertSuccessfulOutput(output);
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      stripStreamingScratchState(output.content);
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = formatProviderError(normalizeProviderError(error));
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

export const streamSimple: StreamFunction<"openai-codex-responses", SimpleStreamOptions> = (
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = {
    ...buildBaseOptions(model, context, options, apiKey),
    toolChoice: options?.toolChoice,
    serviceTier: options?.fast === true ? "priority" : undefined,
  } satisfies OpenAICodexResponsesOptions;
  const clampedReasoning = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

  return stream(model, context, {
    ...base,
    reasoningEffort,
  } satisfies OpenAICodexResponsesOptions);
};

// ============================================================================
// Request Building
// ============================================================================

function buildRequestBody(
  model: Model<"openai-codex-responses">,
  context: Context,
  options: OpenAICodexResponsesOptions | undefined,
  cacheSessionId: string | undefined,
  grammarToolInputProperties: ReadonlyMap<string, string> = createGrammarToolInputProperties(
    context.tools,
    model.compat?.supportsOpenAIGrammarTools ?? false,
  ),
): RequestBody {
  const supportsStrictMode = model.compat?.supportsStrictMode ?? true;
  const supportsOpenAIGrammarTools = model.compat?.supportsOpenAIGrammarTools ?? false;
  const deferredToolsMode = model.compat?.supportsAdditionalTools
    ? "additional-tools"
    : model.compat?.supportsToolSearch
      ? "tool-search"
      : undefined;
  const toolPlacement = splitDeferredTools(context, deferredToolsMode !== undefined);
  const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
    includeSystemPrompt: false,
    grammarToolInputProperties,
    deferredTools: toolPlacement.deferred,
    deferredToolsMode,
    toolOptions: {
      strict: null,
      supportsStrictMode,
      supportsOpenAIGrammarTools,
    },
  });

  const body: RequestBody = {
    model: model.id,
    store: false,
    stream: true,
    instructions: context.systemPrompt || "You are a helpful assistant.",
    input: messages,
    text: { verbosity: options?.textVerbosity || "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: cacheSessionId,
    tool_choice: options?.toolChoice ?? "auto",
    parallel_tool_calls: true,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (options?.serviceTier !== undefined) {
    body.service_tier = options.serviceTier;
  }

  if (toolPlacement.immediate.length > 0) {
    body.tools = convertResponsesTools(toolPlacement.immediate, {
      strict: null,
      supportsStrictMode,
      supportsOpenAIGrammarTools,
    });
  }

  if (options?.reasoningEffort !== undefined) {
    const effort =
      options.reasoningEffort === "none"
        ? (model.thinkingLevelMap?.off ?? "none")
        : (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort);
    if (effort !== null) {
      body.reasoning = {
        effort,
        summary: options.reasoningSummary ?? "auto",
      };
    }
  }

  return body;
}

export type OpenAICodexCompactResult = OpenAICompactResult;

export { OpenAICodexCompactionError };

const compactTokenCount = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const codexCompactionItem = Type.Object({
  type: Type.Literal("compaction"),
  id: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  encrypted_content: Type.String({ minLength: 1 }),
});
type CodexCompactionOutput =
  | { readonly kind: "missing" }
  | { readonly kind: "checkpoint"; readonly item: Static<typeof codexCompactionItem> }
  | { readonly kind: "invalid"; readonly reason: string };

const codexCompactCompleted = Type.Object({
  id: Type.String({ minLength: 1 }),
  // Codex's SSE protocol permits omitted status, but never a contradictory status.
  status: Type.Optional(Type.Literal("completed")),
  error: Type.Optional(Type.Null()),
  incomplete_details: Type.Optional(Type.Null()),
  usage: Type.Optional(
    Type.Union([
      Type.Null(),
      Type.Object({
        input_tokens: compactTokenCount,
        output_tokens: compactTokenCount,
        total_tokens: compactTokenCount,
        input_tokens_details: Type.Optional(
          Type.Union([
            Type.Null(),
            Type.Object({
              cached_tokens: Type.Optional(compactTokenCount),
              cache_write_tokens: Type.Optional(compactTokenCount),
            }),
          ]),
        ),
        output_tokens_details: Type.Optional(
          Type.Union([
            Type.Null(),
            Type.Object({
              reasoning_tokens: Type.Optional(compactTokenCount),
            }),
          ]),
        ),
      }),
    ]),
  ),
  service_tier: Type.Optional(
    Type.Union([
      Type.Null(),
      Type.Literal("auto"),
      Type.Literal("default"),
      Type.Literal("flex"),
      Type.Literal("scale"),
      Type.Literal("priority"),
    ]),
  ),
});
const codexRetainedMessages = Type.Array(
  Type.Object({
    role: Type.Literal("user"),
    content: Type.Union([
      Type.String(),
      Type.Array(
        Type.Union([
          Type.Object({ type: Type.Literal("input_text"), text: Type.String() }),
          Type.Object({
            type: Type.Literal("input_image"),
            image_url: Type.String(),
            // Nyte emits auto-detail images. Original-detail patch estimation is not used.
            detail: Type.Literal("auto"),
          }),
        ]),
      ),
    ]),
  }),
);

/**
 * Codex V2 uses the ordinary Responses stream, not /responses/compact.
 * History retention follows openai/codex@121f91fd5d9dc66017866ce9bdc49f1e182721df,
 * core/src/compact_remote_v2.rs and compact_remote_v2_images.rs.
 * timeoutMs bounds header wait and stream idleness, not total duration.
 * It defaults to five minutes; zero disables it.
 */
export async function compactOpenAICodexContext(
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: OpenAICodexResponsesOptions,
): Promise<OpenAICodexCompactResult> {
  const apiKey = options?.apiKey;
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  const accountId = extractAccountId(apiKey);
  const cacheSessionId =
    options?.cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId);
  const request = buildRequestBody(model, context, options, cacheSessionId);
  request.input = [
    ...(request.input ?? []),
    { type: "compaction_trigger" } satisfies ResponseInputItem.CompactionTrigger,
  ];
  const nextBody = await options?.onPayload?.(request, model);
  const body = recordOf(nextBody === undefined ? request : nextBody);
  const input = body?.input;
  if (
    !body ||
    !Value.Check(Type.Array(Type.Unknown()), input) ||
    !Value.Check(
      Type.Object({ type: Type.Literal("compaction_trigger") }, { additionalProperties: false }),
      input.at(-1),
    ) ||
    input.slice(0, -1).some((item) => recordOf(item)?.type === "compaction_trigger")
  ) {
    throw new Error("Invalid Codex compaction request input");
  }
  const userInputs = input.filter((item) => recordOf(item)?.role === "user");
  if (!Value.Check(codexRetainedMessages, userInputs)) {
    throw new Error("Invalid Codex compaction user input");
  }
  const headers = buildSSEHeaders(
    model.headers,
    options?.headers,
    accountId,
    apiKey,
    cacheSessionId,
  );
  const betaFeatures = new Set(
    (headers.get("x-codex-beta-features") ?? "").split(",").filter(Boolean),
  );
  betaFeatures.add("remote_compaction_v2");
  headers.set("x-codex-beta-features", [...betaFeatures].join(","));
  const encodedBody = JSON.stringify({
    ...body,
    store: false,
    stream: true,
    input,
  });
  const compressedBody = compressRequestBodyZstd(encodedBody);
  if (compressedBody) headers.set("content-encoding", "zstd");
  const url = new URL(resolveCodexUrl(model.baseUrl));
  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs) ?? DEFAULT_COMPACT_IDLE_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("Invalid Codex compaction maxRetries");
  }
  let response: Response | undefined;
  let failure = "Request failed";
  let usage: Usage | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      response = undefined;
      failure = "Request failed";
      const headerTimeout = new AbortController();
      const combinedSignal = combineAbortSignals([options?.signal, headerTimeout.signal]);
      const timer = timeoutMs > 0 ? setTimeout(() => headerTimeout.abort(), timeoutMs) : undefined;
      let retryable = true;
      let output: CodexCompactionOutput = { kind: "missing" };
      try {
        response = await (options?.fetch ?? globalThis.fetch)(url, {
          method: "POST",
          headers,
          body: compressedBody ? new Uint8Array(compressedBody) : encodedBody,
          signal: combinedSignal.signal,
        });
        clearTimeout(timer);
        retryable = false;
        await options?.onResponse?.(
          { status: response.status, headers: headersToRecord(response.headers) },
          model,
        );
        if (!response.ok) {
          failure = "HTTP request failed";
          // Only status codes authorize an HTTP retry, never provider error prose.
          retryable = response.status === 408 || isRetryableError(response.status, "");
          if (response.status === 429) {
            const bodyTimer =
              timeoutMs > 0 ? setTimeout(() => headerTimeout.abort(), timeoutMs) : undefined;
            try {
              retryable = !isTerminalRateLimitError(await response.text());
            } finally {
              clearTimeout(bodyTimer);
            }
          }
          throw new Error(failure);
        }
        retryable = true;
        for await (const event of parseSSE(response, combinedSignal.signal, timeoutMs)) {
          if (event.type === "response.output_item.done") {
            const item = event.item;
            // Keep reading malformed output to account for terminal usage, but never commit it.
            if (!Value.Check(CodexFrameJson, item)) {
              output = { kind: "invalid", reason: "Invalid output item" };
              continue;
            }
            if (item.type !== "compaction" || output.kind === "invalid") continue;
            if (!Value.Check(codexCompactionItem, item)) {
              output = { kind: "invalid", reason: "Invalid compaction item" };
              continue;
            }
            if (output.kind === "checkpoint") {
              output = { kind: "invalid", reason: "Expected exactly one compaction item" };
              continue;
            }
            // Persist only protocol fields, never arbitrary server metadata.
            const checkpoint: Static<typeof codexCompactionItem> = {
              type: item.type,
              encrypted_content: item.encrypted_content,
            } satisfies ResponseCompactionItemParam;
            if (item.id !== undefined) checkpoint.id = item.id;
            output = { kind: "checkpoint", item: checkpoint };
          } else if (isTerminalResponseType(event.type) || event.type === "response.cancelled") {
            retryable = false;
            const terminal = recordOf(event.response);
            const tokens = terminal?.usage;
            if (
              tokens !== undefined &&
              !Value.Check(codexCompactCompleted.properties.usage, tokens)
            ) {
              failure = "Invalid terminal usage";
              throw new Error(failure);
            }
            if (tokens) {
              const cached = tokens.input_tokens_details?.cached_tokens ?? 0;
              const written = tokens.input_tokens_details?.cache_write_tokens ?? 0;
              const reported: Usage = {
                input: Math.max(0, tokens.input_tokens - cached - written),
                output: tokens.output_tokens,
                cacheRead: cached,
                cacheWrite: written,
                reasoning: tokens.output_tokens_details?.reasoning_tokens ?? 0,
                totalTokens: tokens.total_tokens,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              };
              calculateCost(model, reported);
              applyServiceTierPricing(
                reported,
                resolveCodexServiceTier(
                  Value.Check(codexCompactCompleted.properties.service_tier, terminal?.service_tier)
                    ? terminal?.service_tier
                    : undefined,
                  options?.serviceTier,
                ),
                model,
              );
              if (usage) {
                for (const key of [
                  "input",
                  "output",
                  "cacheRead",
                  "cacheWrite",
                  "totalTokens",
                ] as const) {
                  reported[key] += usage[key];
                }
                reported.reasoning = (reported.reasoning ?? 0) + (usage.reasoning ?? 0);
                for (const key of [
                  "input",
                  "output",
                  "cacheRead",
                  "cacheWrite",
                  "total",
                ] as const) {
                  reported.cost[key] += usage.cost[key];
                }
              }
              usage = reported;
            }
            if (event.type !== "response.completed") {
              failure = output.kind === "invalid" ? output.reason : "Compaction did not complete";
              const code = recordOf(terminal?.error)?.code;
              retryable =
                event.type === "response.failed" &&
                (code === "server_error" ||
                  code === "rate_limit_exceeded" ||
                  code === "overloaded");
              throw new Error(failure);
            }
            if (!Value.Check(codexCompactCompleted, event.response)) {
              failure = "Invalid completed response or usage";
              throw new Error(failure);
            }
            if (output.kind !== "checkpoint") {
              failure =
                output.kind === "invalid" ? output.reason : "Expected exactly one compaction item";
              throw new Error(failure);
            }
            const data = [...retainCodexUserInputs(userInputs), output.item];
            return usage === undefined ? { data } : { data, usage };
          } else if (event.type === "error") {
            failure = "Compaction did not complete";
            const code = extractCodexEventError(event).code;
            retryable =
              code === "server_error" || code === "rate_limit_exceeded" || code === "overloaded";
            throw new Error(failure);
          }
        }
        failure =
          output.kind === "invalid" ? output.reason : "Stream ended before response.completed";
        throw new Error(failure);
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        if (headerTimeout.signal.aborted)
          failure = response ? "HTTP error body timed out" : "Response headers timed out";
        else if (error instanceof DOMException && error.name === "TimeoutError")
          failure = "Stream idle timeout";
        else if (error instanceof CodexProtocolError) {
          failure = "Invalid SSE stream";
          retryable = false;
        }
        if (!retryable || output.kind === "invalid" || attempt >= maxRetries) throw error;
      } finally {
        clearTimeout(timer);
        combinedSignal.cleanup();
        await response?.body?.cancel().catch(() => {});
      }
      const delayMs =
        getRetryAfterDelayMs(response?.headers ?? new Headers()) ?? BASE_DELAY_MS * 2 ** attempt;
      failure = "Retry delay exceeded";
      await sleep(validateRetryDelayMs(delayMs, options), options?.signal);
    }
  } catch (error) {
    if (options?.signal?.aborted) failure = "Request was aborted";
    else if (error instanceof RetryDelayExceededError) failure = error.message;
    const requestId =
      response?.headers.get("x-request-id") ?? response?.headers.get("x-openai-request-id");
    const safeRequestId =
      requestId && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId) ? requestId : undefined;
    // Do not attach a cause, response body, or raw SSE payload: they may echo prompts or credentials.
    throw new OpenAICodexCompactionError(
      `Codex compaction: ${failure}; ${url.origin}${url.pathname}${response ? `; HTTP ${response.status}` : ""}${safeRequestId ? `; request ID ${safeRequestId}` : ""}`,
      usage,
    );
  }
}

function retainCodexUserInputs(messages: Static<typeof codexRetainedMessages>): JsonValue[] {
  let remaining = 64_000;
  const retained: JsonValue[] = [];
  const encoder = new TextEncoder();
  for (const message of messages.toReversed()) {
    if (remaining === 0) break;
    const content = Array.isArray(message.content)
      ? message.content
      : [{ type: "input_text", text: message.content } as const];
    // Official auto-detail estimate is ceil(7373 / 4), independent of base64 size.
    const budgeted = content.map((part) => ({
      part,
      tokens: part.type === "input_image" ? 1844 : Math.ceil(encoder.encode(part.text).length / 4),
    }));
    const cost = Math.max(
      1,
      budgeted.reduce((sum, item) => sum + item.tokens, 0),
    );
    if (cost <= remaining) {
      retained.push({ type: "message", role: "user", content });
      remaining -= cost;
      continue;
    }
    // Text-only boundaries keep earlier parts; image boundaries keep later parts.
    const hasImages = content.some((part) => part.type === "input_image");
    const parts: Array<(typeof content)[number]> = [];
    for (const { part, tokens } of hasImages ? budgeted.toReversed() : budgeted) {
      if (part.type === "input_image") {
        if (tokens <= remaining) {
          parts.push(part);
          remaining -= tokens;
        } else remaining = 0;
      } else if (remaining > 0) {
        if (tokens <= remaining) {
          if (part.text) parts.push(part);
          remaining -= tokens;
        } else {
          const bytes = encoder.encode(part.text);
          const budget = remaining * 4;
          let left = budget / 2;
          let right = bytes.length - budget / 2;
          // Slice only at UTF-8 character boundaries, as Codex's truncation helper does.
          while (left > 0 && (bytes[left] & 0xc0) === 0x80) left--;
          while (right < bytes.length && (bytes[right] & 0xc0) === 0x80) right++;
          const decoder = new TextDecoder();
          parts.push({
            type: "input_text",
            text: `${decoder.decode(bytes.subarray(0, left))}…${Math.ceil((bytes.length - budget) / 4)} tokens truncated…${decoder.decode(bytes.subarray(right))}`,
          });
          remaining = 0;
        }
      }
    }
    if (hasImages) parts.reverse();
    if (parts.length > 0) retained.push({ type: "message", role: "user", content: parts });
    // Never backfill older messages when a boundary image does not fit.
    remaining = 0;
  }
  return retained.reverse();
}

function accountWindow(
  fallbackId: "primary" | "secondary",
  value: unknown,
): AccountLimits["windows"][number] | undefined {
  const record = recordOf(value);
  const usedPercent = numberOf(record?.["used_percent"]);
  if (usedPercent === undefined) return undefined;
  const windowSeconds = numberOf(record?.["limit_window_seconds"]);
  const resetAtSeconds = numberOf(record?.["reset_at"]);
  const id =
    windowSeconds === 5 * 60 * 60
      ? "five_hour"
      : windowSeconds === 7 * 24 * 60 * 60
        ? "seven_day"
        : fallbackId;
  return {
    id,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    ...(resetAtSeconds === undefined ? {} : { resetsAt: resetAtSeconds * 1000 }),
    ...(windowSeconds === undefined ? {} : { windowMinutes: windowSeconds / 60 }),
  };
}

/** Fetch current ChatGPT subscription windows from `wham/usage`. */
export async function fetchOpenAICodexAccountLimits(
  model: Model<"openai-codex-responses">,
  options?: OpenAICodexResponsesOptions,
): Promise<AccountLimits> {
  const apiKey = options?.apiKey;
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  const accountId = extractAccountId(apiKey);
  const headers = buildBaseCodexHeaders(model.headers, options?.headers, accountId, apiKey);
  headers.set("accept", "application/json");
  const rawBase = model.baseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/, "").replace(/\/codex$/, "");
  const timeoutSignal =
    options?.timeoutMs !== undefined && options.timeoutMs > 0
      ? AbortSignal.timeout(normalizeTimeoutMs(options.timeoutMs) ?? 0)
      : undefined;
  const combinedSignal = combineAbortSignals([options?.signal, timeoutSignal]);
  let response: Response;
  try {
    response = await (options?.fetch ?? globalThis.fetch)(`${baseUrl}/wham/usage`, {
      method: "GET",
      headers,
      signal: combinedSignal.signal,
    });
  } finally {
    combinedSignal.cleanup();
  }
  await options?.onResponse?.(
    { status: response.status, headers: headersToRecord(response.headers) },
    model,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Codex usage request failed (${String(response.status)}): ${text || response.statusText}`,
    );
  }
  const decoded: unknown = await response.json();
  const root = recordOf(decoded);
  if (root === undefined) throw new Error("Codex usage response was not an object");
  const limits = recordOf(root.rate_limit);
  const windows = [
    accountWindow("primary", limits?.primary_window),
    accountWindow("secondary", limits?.secondary_window),
  ].filter((window) => window !== undefined);
  return {
    providerId: model.provider,
    ...(typeof root.plan_type === "string" ? { plan: root.plan_type } : {}),
    windows,
    observedAt: Date.now(),
  };
}

function applyServiceTierPricing(
  usage: Usage,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  model: Pick<Model<"openai-codex-responses">, "id">,
) {
  const multiplier = getServiceTierCostMultiplier(model, serviceTier ?? undefined);
  if (multiplier === 1) return;

  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

function resolveCodexServiceTier(
  responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): ResponseCreateParamsStreaming["service_tier"] | undefined {
  if (
    responseServiceTier === "default" &&
    (requestServiceTier === "flex" || requestServiceTier === "priority")
  ) {
    return requestServiceTier;
  }
  return responseServiceTier ?? requestServiceTier;
}

function resolveCodexUrl(baseUrl?: string): string {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

function resolveCodexWebSocketUrl(baseUrl?: string): string {
  const url = new URL(resolveCodexUrl(baseUrl));
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return url.toString();
}

// ============================================================================
// Response Processing
// ============================================================================

async function processStream(
  response: Response,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model: Model<"openai-codex-responses">,
  grammarToolInputProperties: ReadonlyMap<string, string>,
  options?: OpenAICodexResponsesOptions,
): Promise<void> {
  await processResponsesStream(
    mapCodexEvents(parseSSE(response, options?.signal), output),
    output,
    stream,
    model,
    {
      serviceTier: options?.serviceTier,
      grammarToolInputProperties,
      resolveServiceTier: resolveCodexServiceTier,
      applyServiceTierPricing: (usage, serviceTier) =>
        applyServiceTierPricing(usage, serviceTier, model),
    },
  );
}

class CodexApiError extends Error {
  readonly code?: string;
  readonly payload?: unknown;

  constructor(message: string, options?: { code?: string; payload?: unknown; cause?: unknown }) {
    super(message);
    this.name = "CodexApiError";
    this.code = options?.code;
    this.payload = options?.payload;
    this.cause = options?.cause;
  }
}

class CodexProtocolError extends Error {
  readonly payload?: unknown;

  constructor(message: string, options?: { payload?: unknown; cause?: unknown }) {
    super(message);
    this.name = "CodexProtocolError";
    this.payload = options?.payload;
    this.cause = options?.cause;
  }
}

function isCodexNonTransportError(cause: unknown): boolean {
  return (
    cause instanceof CodexApiError ||
    cause instanceof CodexProtocolError ||
    cause instanceof ResponsesUsageError
  );
}

function isWebSocketConnectionLimitReachedError(cause: unknown): boolean {
  return cause instanceof CodexApiError && cause.code === WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE;
}

function isPreviousResponseNotFoundError(cause: unknown): boolean {
  return cause instanceof CodexApiError && cause.code === PREVIOUS_RESPONSE_NOT_FOUND_CODE;
}

function extractCodexEventError(event: CodexFrame): CodexEventError {
  const nested = recordOf(event.error);
  return {
    code: textOf(event.code) ?? textOf(nested?.code),
    message: textOf(event.message) ?? textOf(nested?.message),
  };
}

async function* mapCodexEvents(
  events: AsyncIterable<CodexFrame>,
  output: AssistantMessage,
): AsyncGenerator<ResponsesStreamEvent> {
  for await (const event of events) {
    const { type } = event;

    if (type === "error") {
      const { code, message } = extractCodexEventError(event);
      throw new CodexApiError(`Codex error: ${message || code || JSON.stringify(event)}`, {
        code,
        payload: event,
      });
    }

    if (isTerminalResponseType(type)) {
      const response = recordOf(event.response);
      const endTurn = boolOf(response?.end_turn);
      if (endTurn !== undefined) {
        output.endTurn = endTurn;
      }
      // SAFETY: Codex shares the Responses terminal metadata. Usage stays unknown
      // in ResponsesStreamEvent and is validated by the shared finalizer.
      yield {
        ...event,
        type: "response.completed",
        response: {
          ...response,
          status: type === "response.failed" ? "failed" : normalizeCodexStatus(response?.status),
        },
      } as ResponsesStreamEvent;
      // Finalize supplied usage before throwing, while retaining Codex error codes
      // used to distinguish API failures from retryable transport failures.
      if (type === "response.failed") {
        const failure = recordOf(response?.error);
        throw new CodexApiError(textOf(failure?.message) || "Codex response failed", {
          code: textOf(failure?.code),
          payload: event,
        });
      }
      return;
    }

    // SAFETY: non-terminal Codex frames are OpenAI Responses stream events by protocol; they pass through verbatim.
    yield event as ResponseStreamEvent;
  }
}

function normalizeCodexStatus(status: unknown): CodexResponseStatus | undefined {
  return Value.Check(CodexResponseStatusSchema, status) ? status : undefined;
}

// ============================================================================
// SSE Parsing
// ============================================================================

async function* parseSSE(
  response: Response,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<CodexFrame> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimedOut = false;
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          void reader.cancel().catch(() => {});
        }, idleTimeoutMs);
      }
      const { done, value } = await reader.read();
      clearTimeout(idleTimer);
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (idleTimedOut) throw new DOMException("Codex SSE idle timeout", "TimeoutError");
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const dataLines = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length > 0) {
          const data = dataLines.join("\n").trim();
          if (data && data !== "[DONE]") {
            try {
              const frame = decodeCodexFrame(JSON.parse(data));
              if (frame) yield frame;
            } catch (cause) {
              throw new CodexProtocolError(`Invalid Codex SSE JSON: ${formatThrownValue(cause)}`, {
                cause,
                payload: data,
              });
            }
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {}
    try {
      reader.releaseLock();
    } catch {}
  }
}

// ============================================================================
// WebSocket Parsing
// ============================================================================

const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;

/** Structural views of the DOM-shaped events runtimes dispatch on sockets. */
interface WebSocketMessageEvent {
  readonly data?: unknown;
}

interface WebSocketErrorEvent {
  readonly message?: unknown;
  readonly error?: unknown;
}

interface WebSocketCloseEvent {
  readonly code?: unknown;
  readonly reason?: unknown;
  readonly wasClean?: unknown;
}

type WebSocketMessageListener = (event: WebSocketMessageEvent) => void;
type WebSocketErrorListener = (event: WebSocketErrorEvent) => void;
type WebSocketCloseListener = (event: WebSocketCloseEvent) => void;

interface WebSocketLike {
  /** Numeric ready state per the WHATWG spec; absent on exotic runtimes. */
  readonly readyState?: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: WebSocketMessageListener): void;
  addEventListener(type: "error", listener: WebSocketErrorListener): void;
  addEventListener(type: "close", listener: WebSocketCloseListener): void;
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: WebSocketMessageListener): void;
  removeEventListener(type: "error", listener: WebSocketErrorListener): void;
  removeEventListener(type: "close", listener: WebSocketCloseListener): void;
}

interface CachedWebSocketContinuationState {
  lastRequestBody: RequestBody;
  lastResponseId: string;
  lastResponseItems: ResponseInput;
}

interface CachedWebSocketConnection {
  socket: WebSocketLike;
  busy: boolean;
  createdAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  continuation?: CachedWebSocketContinuationState;
}

export interface OpenAICodexWebSocketDebugStats {
  requests: number;
  connectionsCreated: number;
  connectionsReused: number;
  cachedContextRequests: number;
  storeTrueRequests: number;
  fullContextRequests: number;
  deltaRequests: number;
  lastInputItems: number;
  lastDeltaInputItems?: number;
  lastPreviousResponseId?: string;
  websocketFailures: number;
  sseFallbacks: number;
  websocketFallbackActive?: boolean;
  lastWebSocketError?: string;
}

const websocketSessionCache = new Map<string, Map<string, CachedWebSocketConnection>>();
const websocketDebugStats = new Map<string, OpenAICodexWebSocketDebugStats>();
const websocketSseFallbackSessions = new Set<string>();

function getOrCreateWebSocketDebugStats(sessionId: string): OpenAICodexWebSocketDebugStats {
  let stats = websocketDebugStats.get(sessionId);
  if (!stats) {
    stats = {
      requests: 0,
      connectionsCreated: 0,
      connectionsReused: 0,
      cachedContextRequests: 0,
      storeTrueRequests: 0,
      fullContextRequests: 0,
      deltaRequests: 0,
      lastInputItems: 0,
      websocketFailures: 0,
      sseFallbacks: 0,
    };
    websocketDebugStats.set(sessionId, stats);
  }
  return stats;
}

export function getOpenAICodexWebSocketDebugStats(
  sessionId: string,
): OpenAICodexWebSocketDebugStats | undefined {
  const stats = websocketDebugStats.get(sessionId);
  return stats ? { ...stats } : undefined;
}

export function resetOpenAICodexWebSocketDebugStats(sessionId?: string): void {
  if (sessionId) {
    websocketDebugStats.delete(sessionId);
    websocketSseFallbackSessions.delete(sessionId);
    return;
  }
  websocketDebugStats.clear();
  websocketSseFallbackSessions.clear();
}

export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
  const closeEntry = (entry: CachedWebSocketConnection) => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    closeWebSocketSilently(entry.socket, 1000, "debug_close");
  };
  if (sessionId) {
    for (const entry of websocketSessionCache.get(sessionId)?.values() ?? []) closeEntry(entry);
    websocketSessionCache.delete(sessionId);
    return;
  }
  for (const accountEntries of websocketSessionCache.values()) {
    for (const entry of accountEntries.values()) closeEntry(entry);
  }
  websocketSessionCache.clear();
}

registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);

function isWebSocketSseFallbackActive(sessionId: string | undefined): boolean {
  return sessionId ? websocketSseFallbackSessions.has(sessionId) : false;
}

function recordWebSocketSseFallback(sessionId: string | undefined): void {
  if (!sessionId) return;
  const stats = getOrCreateWebSocketDebugStats(sessionId);
  stats.sseFallbacks++;
  stats.websocketFallbackActive = isWebSocketSseFallbackActive(sessionId);
}

function recordWebSocketFailure(sessionId: string | undefined, cause: unknown): void {
  if (!sessionId) return;
  websocketSseFallbackSessions.add(sessionId);

  const stats = getOrCreateWebSocketDebugStats(sessionId);
  stats.websocketFailures++;
  stats.lastWebSocketError = formatThrownValue(cause);
  stats.websocketFallbackActive = true;
}

interface WebSocketConnectOptions {
  headers?: Record<string, string>;
  proxy?: string;
}

type WebSocketConstructor = new (url: string, options?: WebSocketConnectOptions) => WebSocketLike;

let _cachedWebsocket: WebSocketConstructor | null = null;
async function getWebSocketConstructor(env?: ProviderEnv): Promise<WebSocketConstructor | null> {
  if (!env && _cachedWebsocket) return _cachedWebsocket;

  // bun doesn't respect http proxy envs, ref: https://github.com/oven-sh/bun/issues/15489
  // TODO: remove this when bun supports proxy envs in websocket.
  if (nodeProcessLike()?.versions?.bun) {
    const WebSocketWithProxy = class extends WebSocket {
      constructor(url: string | URL, options?: WebSocketConnectOptions) {
        const init: WebSocketConnectOptions = { ...options };
        const proxyUrl = resolveHttpProxyUrlForTarget(
          url.toString().replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
          env,
        );
        if (proxyUrl) init.proxy = proxyUrl.href;
        // SAFETY: Bun honors undici-style option bags (`proxy`) that its WebSocket typings omit.
        super(url, init as ConstructorParameters<typeof WebSocket>[1]);
      }
    };
    if (!env) {
      _cachedWebsocket = WebSocketWithProxy;
    }
    return WebSocketWithProxy;
  }

  // SAFETY: probes for a WebSocket constructor without assuming a DOM lib; browsers, Node >= 22, and Bun all expose one.
  const ctor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!ctor) return null;
  return ctor;
}

class WebSocketCloseError extends Error {
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;

  constructor(message: string, options?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(message);
    this.name = "WebSocketCloseError";
    this.code = options?.code;
    this.reason = options?.reason;
    this.wasClean = options?.wasClean;
  }
}

function isWebSocketReusable(socket: WebSocketLike): boolean {
  // If readyState is unavailable, assume the runtime keeps it open/reusable.
  return socket.readyState === undefined || socket.readyState === 1;
}

function isWebSocketSessionExpired(entry: CachedWebSocketConnection): boolean {
  return Date.now() - entry.createdAt >= SESSION_WEBSOCKET_MAX_AGE_MS;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
  try {
    socket.close(code, reason);
  } catch {}
}

function scheduleSessionWebSocketExpiry(
  sessionId: string,
  accountId: string,
  entry: CachedWebSocketConnection,
): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    if (entry.busy) return;
    closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
    const accountEntries = websocketSessionCache.get(sessionId);
    if (accountEntries?.get(accountId) === entry) accountEntries.delete(accountId);
    if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
  }, SESSION_WEBSOCKET_CACHE_TTL_MS);
  entry.idleTimer.unref?.();
}

async function connectWebSocket(
  url: string,
  headers: Headers,
  signal?: AbortSignal,
  connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS,
  env?: ProviderEnv,
): Promise<WebSocketLike> {
  const WebSocketCtor = await getWebSocketConstructor(env);
  if (!WebSocketCtor) {
    throw new Error("WebSocket transport is not available in this runtime");
  }

  const wsHeaders = headersToRecord(headers);
  delete wsHeaders["OpenAI-Beta"];

  return new Promise<WebSocketLike>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocketLike;

    try {
      socket = new WebSocketCtor(url, { headers: wsHeaders });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error, closeReason?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (closeReason) {
        closeWebSocketSilently(socket, 1000, closeReason);
      }
      reject(error);
    };
    const onOpen: () => void = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError: WebSocketErrorListener = (event) => {
      fail(extractWebSocketError(event));
    };
    const onClose: WebSocketCloseListener = (event) => {
      fail(extractWebSocketCloseError(event));
    };
    const onAbort = () => {
      fail(new Error("Request was aborted"), "aborted");
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort);

    if (connectTimeoutMs > 0) {
      timeout = setTimeout(() => {
        fail(new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`), "connect_timeout");
      }, connectTimeoutMs);
    }
    if (signal?.aborted) {
      onAbort();
    }
  });
}

async function acquireWebSocket(
  url: string,
  headers: Headers,
  sessionId: string | undefined,
  accountId: string,
  signal?: AbortSignal,
  connectTimeoutMs?: number,
  env?: ProviderEnv,
): Promise<{
  socket: WebSocketLike;
  entry?: CachedWebSocketConnection;
  reused: boolean;
  release: (options?: { keep?: boolean }) => void;
}> {
  if (!sessionId) {
    const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
    return {
      socket,
      reused: false,
      release: () => closeWebSocketSilently(socket),
    };
  }

  let accountEntries = websocketSessionCache.get(sessionId);
  const cached = accountEntries?.get(accountId);
  if (cached) {
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = undefined;
    }
    if (!cached.busy && isWebSocketSessionExpired(cached)) {
      closeWebSocketSilently(cached.socket, 1000, "connection_age_limit");
      accountEntries?.delete(accountId);
      if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
    } else if (!cached.busy && isWebSocketReusable(cached.socket)) {
      cached.busy = true;
      return {
        socket: cached.socket,
        entry: cached,
        reused: true,
        release: ({ keep } = {}) => {
          if (!keep || !isWebSocketReusable(cached.socket)) {
            closeWebSocketSilently(cached.socket);
            const currentEntries = websocketSessionCache.get(sessionId);
            if (currentEntries?.get(accountId) === cached) currentEntries.delete(accountId);
            if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
            return;
          }
          cached.busy = false;
          scheduleSessionWebSocketExpiry(sessionId, accountId, cached);
        },
      };
    }
    if (cached.busy) {
      const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
      return {
        socket,
        reused: false,
        release: () => {
          closeWebSocketSilently(socket);
        },
      };
    }
    if (!isWebSocketReusable(cached.socket)) {
      closeWebSocketSilently(cached.socket);
      accountEntries?.delete(accountId);
      if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
    }
  }

  const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
  const entry: CachedWebSocketConnection = { socket, busy: true, createdAt: Date.now() };
  accountEntries = websocketSessionCache.get(sessionId);
  if (!accountEntries) {
    accountEntries = new Map();
    websocketSessionCache.set(sessionId, accountEntries);
  }
  accountEntries.set(accountId, entry);
  return {
    socket,
    entry,
    reused: false,
    release: ({ keep } = {}) => {
      if (!keep || !isWebSocketReusable(entry.socket)) {
        closeWebSocketSilently(entry.socket);
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        const currentEntries = websocketSessionCache.get(sessionId);
        if (currentEntries?.get(accountId) === entry) currentEntries.delete(accountId);
        if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
        return;
      }
      entry.busy = false;
      scheduleSessionWebSocketExpiry(sessionId, accountId, entry);
    },
  };
}

function extractWebSocketError(event: WebSocketErrorEvent): Error {
  const message = textOf(event.message);
  if (message) return new Error(message);

  const nested = event.error;
  if (nested instanceof Error && nested.message.length > 0) return nested;
  const nestedMessage = textOf(recordOf(nested)?.message);
  if (nestedMessage) return new Error(nestedMessage);
  return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: WebSocketCloseEvent): Error {
  const code = numberOf(event.code);
  const reason = textOf(event.reason);
  const codeText = code !== undefined ? ` ${code}` : "";
  const reasonText =
    reason && reason.length > 0
      ? ` ${reason}`
      : code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE
        ? " message too big"
        : "";
  return new WebSocketCloseError(`WebSocket closed${codeText}${reasonText}`.trim(), {
    code,
    reason,
    wasClean: boolOf(event.wasClean),
  });
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
  const text = textOf(data);
  if (text !== undefined) return text;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  const blobLike = recordOf(data);
  if (blobLike && blobLike.arrayBuffer instanceof Function) {
    const arrayBuffer = await blobLike.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(arrayBuffer));
  }
  return null;
}

// Queue events before decoding message data. Blob decoding is asynchronous, so
// decoding inside onMessage lets a following close overtake the terminal frame.
type QueuedWebSocketEvent = { kind: "message"; data: unknown } | { kind: "failure"; error: Error };

async function* parseWebSocket(
  socket: WebSocketLike,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<CodexFrame> {
  const queue: QueuedWebSocketEvent[] = [];
  let pending: (() => void) | null = null;

  const wake = () => {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    resolve();
  };
  const enqueue = (event: QueuedWebSocketEvent) => {
    queue.push(event);
    wake();
  };

  const onMessage: WebSocketMessageListener = (event) => {
    enqueue({ kind: "message", data: event.data });
  };
  const onError: WebSocketErrorListener = (event) => {
    enqueue({ kind: "failure", error: extractWebSocketError(event) });
  };
  const onClose: WebSocketCloseListener = (event) => {
    enqueue({ kind: "failure", error: extractWebSocketCloseError(event) });
  };
  const onAbort = () => {
    enqueue({ kind: "failure", error: new Error("Request was aborted") });
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (queue.length === 0) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve, reject) => {
          pending = resolve;
          if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
            timeout = setTimeout(() => {
              const error = new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
              pending = null;
              closeWebSocketSilently(socket, 1000, "idle_timeout");
              reject(error);
            }, idleTimeoutMs);
          }
        }).finally(() => {
          if (timeout) {
            clearTimeout(timeout);
          }
        });
      }

      const event = queue.shift();
      if (!event) continue;
      if (event.kind === "failure") {
        throw event.error;
      }

      let text: string | null = null;
      let frame: CodexFrame | undefined;
      try {
        text = await decodeWebSocketData(event.data);
        if (text) frame = decodeCodexFrame(JSON.parse(text));
      } catch (cause) {
        throw new CodexProtocolError(`Invalid Codex WebSocket JSON: ${formatThrownValue(cause)}`, {
          cause,
          payload: text,
        });
      }
      if (!frame) continue;
      const terminal = isTerminalResponseType(frame.type);
      yield frame;
      if (terminal) return;
    }
  } finally {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  }
}

function requestBodyWithoutInput(body: RequestBody): RequestBody {
  const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;
  return rest;
}

function responseInputsEqual(a: ResponseInput | undefined, b: ResponseInput | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function requestBodiesMatchExceptInput(a: RequestBody, b: RequestBody): boolean {
  return JSON.stringify(requestBodyWithoutInput(a)) === JSON.stringify(requestBodyWithoutInput(b));
}

function getCachedWebSocketInputDelta(
  body: RequestBody,
  continuation: CachedWebSocketContinuationState,
): ResponseInput | undefined {
  if (!requestBodiesMatchExceptInput(body, continuation.lastRequestBody)) {
    return undefined;
  }

  const currentInput = body.input ?? [];
  const baseline = [
    ...(continuation.lastRequestBody.input ?? []),
    ...continuation.lastResponseItems,
  ];
  if (currentInput.length < baseline.length) {
    return undefined;
  }

  const prefix = currentInput.slice(0, baseline.length);
  if (!responseInputsEqual(prefix, baseline)) {
    return undefined;
  }

  return currentInput.slice(baseline.length);
}

function buildCachedWebSocketRequestBody(
  entry: CachedWebSocketConnection,
  body: RequestBody,
): RequestBody {
  const continuation = entry.continuation;
  if (!continuation) {
    return body;
  }

  const delta = getCachedWebSocketInputDelta(body, continuation);
  if (!delta || !continuation.lastResponseId) {
    entry.continuation = undefined;
    return body;
  }

  return {
    ...body,
    previous_response_id: continuation.lastResponseId,
    input: delta,
  };
}

async function* startWebSocketOutputOnFirstEvent(
  events: AsyncIterable<ResponsesStreamEvent>,
  onStart: () => void,
): AsyncGenerator<ResponsesStreamEvent> {
  let started = false;
  for await (const event of events) {
    // A failed terminal frame is yielded only to account for usage. It must not
    // turn a before-start API failure into an after-start transport failure.
    if (!started && !(event.type === "response.completed" && event.response.status === "failed")) {
      started = true;
      onStart();
    }
    yield event;
  }
}

async function processWebSocketStream(
  url: string,
  body: RequestBody,
  headers: Headers,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model: Model<"openai-codex-responses">,
  onStart: () => void,
  idleTimeoutMs: number | undefined,
  websocketConnectTimeoutMs: number | undefined,
  cacheSessionId: string | undefined,
  accountId: string,
  grammarToolInputProperties: ReadonlyMap<string, string>,
  options?: OpenAICodexResponsesOptions,
): Promise<void> {
  const { socket, entry, reused, release } = await acquireWebSocket(
    url,
    headers,
    cacheSessionId,
    accountId,
    options?.signal,
    websocketConnectTimeoutMs,
    options?.env,
  );
  let keepConnection = true;
  const useCachedContext =
    options?.transport === "websocket-cached" || options?.transport === "auto";
  // ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
  // WebSocket continuation still works via connection-scoped previous_response_id state.
  const fullBody = body;
  const requestBody =
    useCachedContext && entry ? buildCachedWebSocketRequestBody(entry, fullBody) : fullBody;
  const stats = cacheSessionId ? getOrCreateWebSocketDebugStats(cacheSessionId) : undefined;
  if (stats) {
    stats.requests++;
    if (reused) stats.connectionsReused++;
    else stats.connectionsCreated++;
    if (useCachedContext) stats.cachedContextRequests++;
    if (requestBody.store === true) stats.storeTrueRequests++;
    stats.lastInputItems = requestBody.input?.length ?? 0;
    if (requestBody.previous_response_id) {
      stats.deltaRequests++;
      stats.lastDeltaInputItems = requestBody.input?.length ?? 0;
      stats.lastPreviousResponseId = requestBody.previous_response_id;
    } else {
      stats.fullContextRequests++;
      stats.lastDeltaInputItems = undefined;
      stats.lastPreviousResponseId = undefined;
    }
  }
  try {
    socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
    await processResponsesStream(
      startWebSocketOutputOnFirstEvent(
        mapCodexEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs), output),
        onStart,
      ),
      output,
      stream,
      model,
      {
        serviceTier: options?.serviceTier,
        grammarToolInputProperties,
        resolveServiceTier: resolveCodexServiceTier,
        applyServiceTierPricing: (usage, serviceTier) =>
          applyServiceTierPricing(usage, serviceTier, model),
      },
    );
    if (options?.signal?.aborted) {
      keepConnection = false;
    } else if (useCachedContext && entry && output.responseId) {
      const responseItems = convertResponsesMessages(
        model,
        { messages: [output] },
        CODEX_TOOL_CALL_PROVIDERS,
        {
          includeSystemPrompt: false,
          grammarToolInputProperties,
        },
      ).filter(
        (item) => item.type !== "function_call_output" && item.type !== "custom_tool_call_output",
      );
      entry.continuation = {
        lastRequestBody: fullBody,
        lastResponseId: output.responseId,
        lastResponseItems: responseItems,
      };
    }
  } catch (error) {
    if (entry) {
      entry.continuation = undefined;
    }
    keepConnection = false;
    throw error;
  } finally {
    release({ keep: keepConnection });
  }
}

// ============================================================================
// Error Handling
// ============================================================================

async function parseErrorResponse(
  response: Response,
): Promise<{ message: string; friendlyMessage?: string }> {
  const raw = await response.text();
  let message = raw || response.statusText || "Request failed";
  let friendlyMessage: string | undefined;

  try {
    const body = recordOf(JSON.parse(raw));
    const err = body && recordOf(body.error);
    if (err) {
      const code = textOf(err.code) ?? textOf(err.type) ?? "";
      if (
        /usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) ||
        response.status === 429
      ) {
        const planType = textOf(err.plan_type);
        const plan = planType ? ` (${planType.toLowerCase()} plan)` : "";
        const resetsAt = numberOf(err.resets_at);
        const mins = resetsAt
          ? Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000))
          : undefined;
        const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
        friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
      }
      message = textOf(err.message) || friendlyMessage || message;
    }
  } catch {}

  return { message, friendlyMessage };
}

// ============================================================================
// Auth & Headers
// ============================================================================

function extractAccountId(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const payload = JSON.parse(atob(parts[1]));
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (!accountId) throw new Error("No account ID in token");
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}

function buildBaseCodexHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: ProviderHeaders | undefined,
  accountId: string,
  token: string,
): Headers {
  const headers = new Headers(initHeaders);
  for (const [key, value] of Object.entries(additionalHeaders || {})) {
    if (value === null) {
      headers.delete(key);
    } else {
      headers.set(key, value);
    }
  }
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "nyte");
  headers.set("User-Agent", getNyteUserAgent());
  return headers;
}

function buildSSEHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: ProviderHeaders | undefined,
  accountId: string,
  token: string,
  sessionId?: string,
): Headers {
  const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");

  if (sessionId) {
    headers.set("session-id", sessionId);
    headers.set("x-client-request-id", sessionId);
  }

  return headers;
}

function buildWebSocketHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: ProviderHeaders | undefined,
  accountId: string,
  token: string,
  requestId: string,
): Headers {
  const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
  headers.delete("accept");
  headers.delete("content-type");
  headers.delete("OpenAI-Beta");
  headers.delete("openai-beta");
  headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
  headers.set("x-client-request-id", requestId);
  headers.set("session-id", requestId);
  return headers;
}
