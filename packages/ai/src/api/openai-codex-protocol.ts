/**
 * The Codex Responses protocol both transports and compaction share: request options and body,
 * error types, frame decoding and the mapping of Codex frames onto Responses stream events.
 */
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { applyServiceTierPricing } from "../model-pricing.ts";
import { codexFrameLimits } from "../providers/openai-codex-limits.ts";
import type {
  AccountLimits,
  AssistantMessage,
  Model,
  StreamOptions,
  TranscriptContext,
} from "../types.ts";
import { splitDeferredTools } from "../utils/deferred-tools.ts";
import { formatThrownValue } from "../utils/diagnostics.ts";
import { iterateServerSentEvents } from "../utils/sse.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  getDeclaredTools,
  getInitialSystemMessage,
  resolveTranscriptTools,
} from "../utils/transcript.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import {
  CodexFrameJson,
  type CodexFrame,
  readBoolean,
  readNumber,
  readRecord,
  readText,
  TERMINAL_RESPONSE_TYPES,
} from "./openai-codex-wire.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  type ResponsesInput,
  type ResponsesTool,
} from "./openai-responses-convert.ts";
import type { ResponsesServiceTier } from "./openai-responses-events.ts";
import type { OpenAIResponsesStreamOptions } from "./openai-responses-stream.ts";

export interface OpenAICodexResponsesOptions extends StreamOptions {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  textVerbosity?: "low" | "medium" | "high";
  toolChoice?: "auto" | "none" | "required";
}

export interface RequestBody {
  model: string;
  store?: boolean;
  stream?: boolean;
  instructions?: string;
  previous_response_id?: string;
  input?: ResponsesInput;
  tools?: ResponsesTool[];
  tool_choice?: OpenAICodexResponsesOptions["toolChoice"];
  parallel_tool_calls?: boolean;
  temperature?: number;
  reasoning?: { effort?: string; summary?: string };
  service_tier?: ResponseCreateParamsStreaming["service_tier"];
  text?: { verbosity?: string };
  include?: string[];
  prompt_cache_key?: string;
}

/** One Codex request as both transports send it. */
export interface CodexRequest {
  readonly model: Model<"openai-codex-responses">;
  readonly body: RequestBody;
  readonly accountId: string;
  /** The caller's session id, unless prompt caching is off; it keys the WebSocket cache. */
  readonly cacheSessionId: string | undefined;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  /** Bounds the SSE header wait and WebSocket idleness, from `options.timeoutMs`. */
  readonly timeoutMs: number | undefined;
  /** Bounds the WebSocket open handshake, from `options.websocketConnectTimeoutMs`. */
  readonly connectTimeoutMs: number | undefined;
  readonly options: OpenAICodexResponsesOptions | undefined;
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

export const DEFAULT_MAX_RETRIES = 0;

/**
 * The Codex backend accepts zstd-compressed request bodies on the SSE responses endpoint, the
 * endpoint the official Codex client compresses against.
 */
const REQUEST_COMPRESSION_ZSTD_LEVEL = 3;

export const CODEX_TOOL_CALL_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "openai-codex",
  "opencode",
]);

/** A 429 whose body says the plan's quota is spent; waiting does not lift it. */
const USAGE_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

/** Whether a 429 body reports quota exhaustion rather than a passing rate limit. */
export function reportsUsageLimit(errorText: string): boolean {
  return USAGE_LIMIT_PATTERN.test(errorText);
}

/** `bodyJson` as zstd, or null outside Node and Bun, where `node:zlib` is unavailable. */
export function compressRequestBodyZstd(bodyJson: string): Uint8Array<ArrayBuffer> | null {
  if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
    return null;
  }

  try {
    const zlib = process.getBuiltinModule("node:zlib");
    const compressed = zlib.zstdCompressSync(bodyJson, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: REQUEST_COMPRESSION_ZSTD_LEVEL },
    });

    return new Uint8Array(compressed);
  } catch {
    return null;
  }
}

/**
 * The Codex request body. Later system messages anchor their own tool additions, and
 * `addedToolNames` on a tool result only loads request-list tools the transcript did not anchor,
 * so nothing is declared twice.
 */
export function buildRequestBody(
  model: Model<"openai-codex-responses">,
  context: TranscriptContext,
  options: OpenAICodexResponsesOptions | undefined,
  cacheSessionId: string | undefined,
  grammarToolInputProperties: ReadonlyMap<string, string> = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
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

  const transcriptTools = resolveTranscriptTools(context.messages, deferredToolsMode !== undefined);

  const toolPlacement = splitDeferredTools(
    { messages: context.messages, tools: transcriptTools.requestTools },
    deferredToolsMode !== undefined,
  );

  const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
    includeSystemPrompt: false,
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    deferredTools: toolPlacement.deferred,
    deferredToolsMode,
    toolOptions: {
      strict: null,
      supportsStrictMode,
      supportsOpenAIGrammarTools,
    },
  });

  const initialSystemMessage = getInitialSystemMessage(context.messages);
  const instructions = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";

  const body: RequestBody = {
    model: model.id,
    store: false,
    stream: true,
    instructions: instructions || "You are a helpful assistant.",
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
        ? model.thinkingLevelMap?.off === undefined
          ? "none"
          : model.thinkingLevelMap.off
        : (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort);

    if (effort !== null) {
      body.reasoning = {
        effort,
        summary: options.reasoningSummary ?? "auto",
      };
    }
  } else if (model.reasoning && model.thinkingLevelMap?.off !== null) {
    body.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
  }

  return body;
}

/** Codex answers `default` for a flex or priority request it served at that tier. */
export function resolveCodexServiceTier(
  responseServiceTier: ResponsesServiceTier | undefined,
  requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): ResponsesServiceTier | undefined {
  if (
    responseServiceTier === "default" &&
    (requestServiceTier === "flex" || requestServiceTier === "priority")
  ) {
    return requestServiceTier;
  }

  return responseServiceTier ?? requestServiceTier;
}

/** How the shared Responses stream processor reads a Codex response. */
export function codexStreamOptions(request: CodexRequest): OpenAIResponsesStreamOptions {
  return {
    serviceTier: request.options?.serviceTier,
    grammarToolInputProperties: request.grammarToolInputProperties,
    resolveServiceTier: resolveCodexServiceTier,
    applyServiceTierPricing: (usage, serviceTier) =>
      applyServiceTierPricing(usage, serviceTier, request.model),
  };
}

/**
 * A failed Codex request attempt, carrying `status` and `headers` so the shared provider retry
 * policy applies; `retryable` vetoes a retry the policy would allow, such as a 429 that is quota
 * exhaustion, which waiting does not lift.
 */
export class CodexRequestError extends Error {
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number | undefined,
    headers: Headers | undefined,
    retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CodexRequestError";
    this.status = status;
    this.headers = headers;
    this.retryable = retryable;
  }
}

/** The retry veto for Codex attempts: only a {@link CodexRequestError} marked retryable runs again. */
export function retryableCodexRequest(error: unknown): boolean {
  return error instanceof CodexRequestError && error.retryable;
}

/** An error the Codex API reported in a frame, with its machine-readable code. */
export class CodexApiError extends Error {
  readonly code?: string;
  readonly payload?: unknown;

  constructor(message: string, options?: { code?: string; payload?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "CodexApiError";
    this.code = options?.code;
    this.payload = options?.payload;
  }
}

/** A frame that is not valid Codex protocol JSON. */
export class CodexProtocolError extends Error {
  readonly payload?: unknown;

  constructor(message: string, options?: { payload?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "CodexProtocolError";
    this.payload = options?.payload;
  }
}

/** The code and message of an `error` frame, flat or nested under `error`. */
export function extractCodexEventError(event: CodexFrame): CodexEventError {
  const nested = readRecord(event.error);

  return {
    code: readText(event.code) ?? readText(nested?.code),
    message: readText(event.message) ?? readText(nested?.message),
  };
}

async function reportFrameLimits(
  frame: CodexFrame,
  providerId: string,
  onAccountLimits: (limits: AccountLimits) => void | Promise<void>,
): Promise<void> {
  const limits = codexFrameLimits(frame, providerId);

  if (limits !== undefined) await onAccountLimits(limits);
}

/**
 * Maps Codex frames onto Responses stream events. `codex.rate_limits` frames go to
 * `onAccountLimits`, whose failures never fail the assistant stream. Every terminal frame
 * becomes `response.completed` carrying its status, so the shared finalizer accounts for usage
 * before a `response.failed` frame throws a {@link CodexApiError} that keeps the Codex error
 * code, which tells API failures from retryable transport failures.
 */
export async function* mapCodexEvents(
  events: AsyncIterable<CodexFrame>,
  output: AssistantMessage,
  onAccountLimits?: (limits: AccountLimits) => void | Promise<void>,
): AsyncGenerator<unknown> {
  for await (const event of events) {
    const { type } = event;

    if (type === "codex.rate_limits") {
      if (onAccountLimits !== undefined) {
        await reportFrameLimits(event, output.provider, onAccountLimits).catch(() => undefined);
      }

      continue;
    }

    if (type === "error") {
      const { code, message } = extractCodexEventError(event);
      throw new CodexApiError(`Codex error: ${message || code || JSON.stringify(event)}`, {
        code,
        payload: event,
      });
    }

    if (TERMINAL_RESPONSE_TYPES.has(type)) {
      const response = readRecord(event.response);
      const endTurn = readBoolean(response?.end_turn);
      const status = response?.status;

      if (endTurn !== undefined) {
        output.endTurn = endTurn;
      }

      yield {
        ...event,
        type: "response.completed",
        response: {
          ...response,
          status:
            type === "response.failed"
              ? "failed"
              : Value.Check(CodexResponseStatusSchema, status)
                ? status
                : undefined,
        },
      };

      if (type === "response.failed") {
        const failure = readRecord(response?.error);
        throw new CodexApiError(readText(failure?.message) || "Codex response failed", {
          code: readText(failure?.code),
          payload: event,
        });
      }

      return;
    }

    yield event;
  }
}

/** Codex frames from an SSE response body; `[DONE]` and empty data are skipped. */
export async function* parseSSE(
  response: Response,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<CodexFrame> {
  if (!response.body) return;

  for await (const { data } of iterateServerSentEvents(response.body, signal, idleTimeoutMs)) {
    if (data.trim() === "" || data === "[DONE]") continue;
    let frame: unknown;

    try {
      frame = JSON.parse(data);
    } catch (cause) {
      throw new CodexProtocolError(`Invalid Codex SSE JSON: ${formatThrownValue(cause)}`, {
        cause,
        payload: data,
      });
    }

    if (Value.Check(CodexFrameJson, frame)) yield frame;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    return readRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * The message of a failed Codex HTTP response, and a usage-limit explanation for a 429 or a
 * usage-limit error code, with the plan and reset time when the body gives them.
 */
export function parseErrorResponse(
  raw: string,
  response: Response,
): { message: string; friendlyMessage?: string } {
  const fallback = raw || response.statusText || "Request failed";
  const err = readRecord(parseJsonObject(raw)?.error);

  if (!err) return { message: fallback };

  const code = readText(err.code) ?? readText(err.type) ?? "";
  let friendlyMessage: string | undefined;

  if (
    /usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) ||
    response.status === 429
  ) {
    const planType = readText(err.plan_type);
    const plan = planType ? ` (${planType.toLowerCase()} plan)` : "";
    const resetsAt = readNumber(err.resets_at);
    const mins = resetsAt
      ? Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000))
      : undefined;
    const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
    friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
  }

  return { message: readText(err.message) || friendlyMessage || fallback, friendlyMessage };
}
