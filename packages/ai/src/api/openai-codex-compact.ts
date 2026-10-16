/**
 * Codex remote compaction (V2): the ordinary Responses stream with a `compaction_trigger` input,
 * returning the retained user inputs and the one encrypted compaction checkpoint.
 */
import type {
  ResponseCompactionItemParam,
  ResponseInputItem,
} from "openai/resources/responses/responses.js";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { applyServiceTierPricing } from "../model-pricing.ts";
import { calculateCost } from "../model-capabilities.ts";
import type { Context, JsonValue, Model, Usage } from "../types.ts";
import { headersToRecord } from "../utils/headers.ts";
import { RetryDelayExceededError, retryProviderRequest } from "../utils/provider-retry.ts";
import { normalizeContext, resolveTranscript } from "../utils/transcript.ts";
import { emptyCost } from "./assistant-stream.ts";
import { OpenAICodexCompactionError } from "./openai-codex-compaction-error.ts";
import {
  buildRequestBody,
  CodexProtocolError,
  CodexRequestError,
  compressRequestBodyZstd,
  DEFAULT_MAX_RETRIES,
  extractCodexEventError,
  type OpenAICodexResponsesOptions,
  parseSSE,
  reportsUsageLimit,
  resolveCodexServiceTier,
  retryableCodexRequest,
} from "./openai-codex-protocol.ts";
import {
  buildSSEHeaders,
  CodexFrameJson,
  extractAccountId,
  normalizeTimeoutMs,
  readRecord,
  resolveCodexUrl,
  TERMINAL_RESPONSE_TYPES,
} from "./openai-codex-wire.ts";
import type { OpenAICompactResult } from "./openai-compact.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import type { ResponsesInput } from "./openai-responses-convert.ts";
import { withPriorityTier } from "./openai-responses-stream.ts";

export type OpenAICodexCompactResult = OpenAICompactResult;

const DEFAULT_COMPACT_IDLE_TIMEOUT_MS = 300_000;

/** Compaction retries a failed HTTP open on these statuses only, never on provider error prose. */
const RETRYABLE_COMPACTION_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Terminal error codes after which another compaction attempt can succeed. */
const RETRYABLE_COMPACTION_CODES: ReadonlySet<unknown> = new Set([
  "server_error",
  "rate_limit_exceeded",
  "overloaded",
]);

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

const compactUsage = Type.Union([
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
]);

const compactServiceTier = Type.Union([
  Type.Null(),
  Type.Literal("auto"),
  Type.Literal("default"),
  Type.Literal("flex"),
  Type.Literal("scale"),
  Type.Literal("priority"),
]);

/** A completed compaction response. Codex may omit the status, but never contradicts it. */
const codexCompactCompleted = Type.Object({
  id: Type.String({ minLength: 1 }),
  status: Type.Optional(Type.Literal("completed")),
  error: Type.Optional(Type.Null()),
  incomplete_details: Type.Optional(Type.Null()),
  usage: Type.Optional(compactUsage),
  service_tier: Type.Optional(compactServiceTier),
});

/** Retained user inputs. Nyte emits auto-detail images; original-detail estimation is unused. */
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
            detail: Type.Literal("auto"),
          }),
        ]),
      ),
    ]),
  }),
);

type RetainedMessages = Static<typeof codexRetainedMessages>;

type RetainedPart = Extract<RetainedMessages[number]["content"], readonly unknown[]>[number];

/** A step of one attempt that failed with a sanitized reason. */
class CompactionStepError extends Error {
  readonly retryable: boolean;

  constructor(reason: string, retryable: boolean) {
    super(reason);
    this.retryable = retryable;
  }
}

/** `total` plus `next`, counts and cost alike. */
function addUsage(total: Usage | undefined, next: Usage): Usage {
  if (total === undefined) return next;

  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    reasoning: (total.reasoning ?? 0) + (next.reasoning ?? 0),
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

/** The priced usage of a terminal response; absent usage is unknown, never zero. */
function terminalUsage(
  terminal: Record<string, unknown> | undefined,
  model: Model<"openai-codex-responses">,
  options: OpenAICodexResponsesOptions | undefined,
): Usage | undefined {
  const tokens = terminal?.usage;

  if (tokens !== undefined && !Value.Check(compactUsage, tokens)) {
    throw new CompactionStepError("Invalid terminal usage", false);
  }

  if (!tokens) return undefined;
  const cached = tokens.input_tokens_details?.cached_tokens ?? 0;
  const written = tokens.input_tokens_details?.cache_write_tokens ?? 0;
  const usage: Usage = {
    input: Math.max(0, tokens.input_tokens - cached - written),
    output: tokens.output_tokens,
    cacheRead: cached,
    cacheWrite: written,
    reasoning: tokens.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: tokens.total_tokens,
    cost: emptyCost(),
  };
  const serviceTier = terminal?.service_tier;

  calculateCost(model, usage);
  applyServiceTierPricing(
    usage,
    resolveCodexServiceTier(
      Value.Check(compactServiceTier, serviceTier) ? serviceTier : undefined,
      options?.serviceTier,
    ),
    model,
  );

  return usage;
}

/**
 * Folds one `output_item.done` item into the attempt's output. Malformed output is kept reading
 * so terminal usage is still accounted for, but never committed; a checkpoint keeps only
 * protocol fields, never arbitrary server metadata.
 */
function readOutputItem(item: unknown, output: CodexCompactionOutput): CodexCompactionOutput {
  if (!Value.Check(CodexFrameJson, item)) return { kind: "invalid", reason: "Invalid output item" };

  if (item.type !== "compaction" || output.kind === "invalid") return output;

  if (!Value.Check(codexCompactionItem, item)) {
    return { kind: "invalid", reason: "Invalid compaction item" };
  }

  if (output.kind === "checkpoint") {
    return { kind: "invalid", reason: "Expected exactly one compaction item" };
  }

  const checkpoint: Static<typeof codexCompactionItem> = {
    type: item.type,
    encrypted_content: item.encrypted_content,
  } satisfies ResponseCompactionItemParam;

  if (item.id !== undefined) checkpoint.id = item.id;

  return { kind: "checkpoint", item: checkpoint };
}

/**
 * Codex V2 uses the ordinary Responses stream, not /responses/compact.
 * History retention follows openai/codex@121f91fd5d9dc66017866ce9bdc49f1e182721df,
 * core/src/compact_remote_v2.rs and compact_remote_v2_images.rs.
 * timeoutMs bounds header wait and stream idleness, not total duration.
 * It defaults to five minutes; zero disables it. A failure throws an
 * {@link OpenAICodexCompactionError} without a cause, response body, or raw SSE payload,
 * since those may echo prompts or credentials.
 */
export async function compactOpenAICodexContext(
  model: Model<"openai-codex-responses">,
  context: Context,
  requested?: OpenAICodexResponsesOptions,
): Promise<OpenAICodexCompactResult> {
  const options = withPriorityTier(requested);
  const apiKey = options?.apiKey;

  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  const accountId = extractAccountId(apiKey);

  const cacheSessionId =
    options?.cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId);

  const request = buildRequestBody(
    model,
    resolveTranscript(normalizeContext(context), model.compat?.supportsMidConvoSystemMessages),
    options,
    cacheSessionId,
  );
  const input: ResponsesInput = [
    ...(request.input ?? []),
    { type: "compaction_trigger" } satisfies ResponseInputItem.CompactionTrigger,
  ];
  request.input = input;
  await options?.onPayload?.(request, model);

  const userInputs = input.filter((item) => "role" in item && item.role === "user");

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

  const encodedBody = JSON.stringify(request);
  const compressedBody = compressRequestBodyZstd(encodedBody);

  if (compressedBody) headers.set("content-encoding", "zstd");
  const url = new URL(resolveCodexUrl(model.baseUrl));
  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs) ?? DEFAULT_COMPACT_IDLE_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("Invalid Codex compaction maxRetries");
  }

  let response: Response | undefined;
  let usage: Usage | undefined;

  const attempt = async (): Promise<OpenAICodexCompactResult> => {
    response = undefined;
    const headerTimeout = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([options.signal, headerTimeout.signal])
      : headerTimeout.signal;
    const timer = timeoutMs > 0 ? setTimeout(() => headerTimeout.abort(), timeoutMs) : undefined;
    let retryable = true;
    let output: CodexCompactionOutput = { kind: "missing" };

    try {
      response = await (options?.fetch ?? globalThis.fetch)(url, {
        method: "POST",
        headers,
        body: compressedBody ?? encodedBody,
        signal,
      });
      clearTimeout(timer);
      retryable = false;
      await options?.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      );

      if (!response.ok) {
        retryable = RETRYABLE_COMPACTION_STATUSES.has(response.status);

        if (response.status === 429) {
          const bodyTimer =
            timeoutMs > 0 ? setTimeout(() => headerTimeout.abort(), timeoutMs) : undefined;

          try {
            retryable = !reportsUsageLimit(await response.text());
          } finally {
            clearTimeout(bodyTimer);
          }
        }

        throw new CompactionStepError("HTTP request failed", retryable);
      }

      retryable = true;

      for await (const event of parseSSE(response, signal, timeoutMs)) {
        if (event.type === "response.output_item.done") {
          output = readOutputItem(event.item, output);
        } else if (TERMINAL_RESPONSE_TYPES.has(event.type) || event.type === "response.cancelled") {
          retryable = false;
          const terminal = readRecord(event.response);
          const reported = terminalUsage(terminal, model, options);

          if (reported) usage = addUsage(usage, reported);

          if (event.type !== "response.completed") {
            throw new CompactionStepError(
              output.kind === "invalid" ? output.reason : "Compaction did not complete",
              event.type === "response.failed" &&
                RETRYABLE_COMPACTION_CODES.has(readRecord(terminal?.error)?.code),
            );
          }

          if (!Value.Check(codexCompactCompleted, event.response)) {
            throw new CompactionStepError("Invalid completed response or usage", false);
          }

          if (output.kind !== "checkpoint") {
            throw new CompactionStepError(
              output.kind === "invalid" ? output.reason : "Expected exactly one compaction item",
              false,
            );
          }

          const data = [...retainCodexUserInputs(userInputs), output.item];

          return usage === undefined ? { data } : { data, usage };
        } else if (event.type === "error") {
          throw new CompactionStepError(
            "Compaction did not complete",
            RETRYABLE_COMPACTION_CODES.has(extractCodexEventError(event).code),
          );
        }
      }

      throw new CompactionStepError(
        output.kind === "invalid" ? output.reason : "Stream ended before response.completed",
        retryable,
      );
    } catch (error) {
      if (options?.signal?.aborted) throw error;

      const failure = headerTimeout.signal.aborted
        ? response
          ? "HTTP error body timed out"
          : "Response headers timed out"
        : error instanceof DOMException && error.name === "TimeoutError"
          ? "Stream idle timeout"
          : error instanceof CodexProtocolError
            ? "Invalid SSE stream"
            : error instanceof CompactionStepError
              ? error.message
              : "Request failed";
      const stepRetryable =
        error instanceof CompactionStepError
          ? error.retryable
          : retryable && !(error instanceof CodexProtocolError);

      throw new CodexRequestError(
        failure,
        response?.ok === false ? response.status : undefined,
        response?.headers,
        stepRetryable && output.kind !== "invalid",
      );
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => undefined);
    }
  };

  try {
    return await retryProviderRequest(attempt, {
      maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
      retryable: retryableCodexRequest,
    });
  } catch (error) {
    const failure = options?.signal?.aborted
      ? "Request was aborted"
      : error instanceof RetryDelayExceededError || error instanceof CodexRequestError
        ? error.message
        : "Request failed";
    const requestId =
      response?.headers.get("x-request-id") ?? response?.headers.get("x-openai-request-id");
    const safeRequestId =
      requestId && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId) ? requestId : undefined;

    throw new OpenAICodexCompactionError(
      `Codex compaction: ${failure}; ${url.origin}${url.pathname}${response ? `; HTTP ${response.status}` : ""}${safeRequestId ? `; request ID ${safeRequestId}` : ""}`,
      usage,
    );
  }
}

/** Official auto-detail estimate is ceil(7373 / 4), independent of base64 size. */
const IMAGE_TOKENS = 1844;

/**
 * Cuts text to `remaining` tokens by keeping both ends around a truncation marker, slicing only
 * at UTF-8 character boundaries as Codex's truncation helper does.
 */
function truncateMiddle(text: string, remaining: number, encoder: TextEncoder): RetainedPart {
  const bytes = encoder.encode(text);
  const budget = remaining * 4;
  let left = budget / 2;
  let right = bytes.length - budget / 2;

  while (left > 0 && (bytes[left] & 0xc0) === 0x80) left--;

  while (right < bytes.length && (bytes[right] & 0xc0) === 0x80) right++;
  const decoder = new TextDecoder();

  return {
    type: "input_text",
    text: `${decoder.decode(bytes.subarray(0, left))}…${Math.ceil((bytes.length - budget) / 4)} tokens truncated…${decoder.decode(bytes.subarray(right))}`,
  };
}

/**
 * The newest user inputs within a 64k-token budget. At the boundary message, text-only content
 * keeps its earlier parts and image content keeps its later parts; older messages are never
 * backfilled once a boundary does not fit.
 */
function retainCodexUserInputs(messages: RetainedMessages): JsonValue[] {
  let remaining = 64_000;
  const retained: JsonValue[] = [];
  const encoder = new TextEncoder();

  for (const message of messages.toReversed()) {
    if (remaining === 0) break;

    const content: RetainedPart[] = Array.isArray(message.content)
      ? message.content
      : [{ type: "input_text", text: message.content }];
    const budgeted = content.map((part) => ({
      part,
      tokens:
        part.type === "input_image"
          ? IMAGE_TOKENS
          : Math.ceil(encoder.encode(part.text).length / 4),
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

    const hasImages = content.some((part) => part.type === "input_image");
    const parts: RetainedPart[] = [];

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
          parts.push(truncateMiddle(part.text, remaining, encoder));
          remaining = 0;
        }
      }
    }

    if (hasImages) parts.reverse();

    if (parts.length > 0) retained.push({ type: "message", role: "user", content: parts });
    remaining = 0;
  }

  return retained.reverse();
}
