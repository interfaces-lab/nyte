/**
 * The one place that reads provider error text. An assistant message that
 * stopped with `error` or `aborted` is classified here, once, into a closed
 * `FailureClass`; everything downstream switches on the class.
 *
 * Context-window patterns are based on
 * https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/overflow.ts
 * and the transient-error patterns on
 * https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/retry.ts
 * (both synced with pi 7ebf9087e).
 *
 * Context-window examples by provider:
 *
 * - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
 * - Anthropic: "413 {\"error\":{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum size\"}}"
 * - OpenAI: "Your input exceeds the context window of this model"
 * - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
 * - OpenAI-compatible: "Input length (265330) exceeds model's maximum context length (262144)."
 * - Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
 * - xAI: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
 * - Groq: "Please reduce the length of the messages or completion"
 * - OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "the request exceeds the available context size, try increasing it"
 * - LM Studio: "tokens to keep from the initial prompt is greater than the context length"
 * - GitHub Copilot: "prompt token count of X exceeds the limit of Y"
 * - MiniMax: "invalid params, context window exceeds limit"
 * - Kimi For Coding: "Your request exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - Cerebras: "400/413 status code (no body)"
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - z.ai: accepts overflow silently; detected via usage.input > contextWindow
 * - Xiaomi MiMo: truncates input to fill contextWindow, then returns finish_reason "length"
 *   with output=0; detected via stopReason "length" + zero output + input filling the window.
 * - DashScope/Qwen: "Range of input length should be [1, X]"
 * - Ollama: "prompt too long; exceeded max context length by X tokens"
 */
import type { Api, AssistantMessage, Failure, FailureClass, Model } from "@nyte-ai/schema";

const CONTEXT_WINDOW_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /range of input length should be/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];

/**
 * Bedrock formats throttling as "ThrottlingException: Too many tokens, please
 * wait before trying again", which would read as overflow without this.
 */
const NOT_CONTEXT_WINDOW_PATTERN =
  /^(Throttling error|Service unavailable):|rate limit|too many requests/i;

function pattern(parts: readonly string[]): RegExp {
  return new RegExp(parts.join("|"), "i");
}

const QUOTA_PATTERN = pattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
  "available balance",
  "insufficient[_ -]?quota",
  "out of budget",
  "quota exceeded",
  "billing",
]);

const AUTH_PATTERN = pattern([
  "\\b401\\b",
  "unauthori[sz]ed",
  "invalid (?:x-)?api[ _-]?key",
  "authentication",
]);

const RATE_LIMIT_PATTERN = pattern([
  "rate[_ .-]?limit",
  "too many requests",
  "throttl",
  "ResourceExhausted",
  "retry delay",
]);

const OVERLOADED_PATTERN = pattern([
  "\\b529\\b",
  "\\b5(?:00|02|03|04|24)\\b",
  "overload",
  "service.?unavailable",
  "temporarily unavailable",
  "server.?error",
  "internal.?error",
  "provider.?returned.?error",
  "exceeded request buffer limit while retrying upstream",
  "you can retry your request",
  "try your request again",
  "please retry your request",
]);

const NETWORK_PATTERN = pattern([
  "network",
  "fetch failed",
  "ECONN",
  "connection.?(?:lost|refused|reset|error)",
  "other side closed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",
  "websocket.?(?:closed|error)",
  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
]);

const RETRY_DELAY_PATTERN =
  /server requested ([0-9]+(?:\.[0-9]+)?)s retry delay(?: \(max: ([0-9]+(?:\.[0-9]+)?)s\))?/i;

function classForStatus(status: number): FailureClass | undefined {
  if (status === 429) return "rate_limit";

  if (status === 401 || status === 403) return "auth";

  if (status === 402) return "quota";

  if (status === 413) return "context_window";

  if (status >= 500 && status <= 599) return "overloaded";

  return undefined;
}

function structuredClass(message: AssistantMessage): FailureClass | undefined {
  for (const diagnostic of message.diagnostics ?? []) {
    for (const value of [
      diagnostic.details?.status,
      diagnostic.details?.statusCode,
      diagnostic.error?.code,
    ]) {
      const status =
        typeof value === "number"
          ? value
          : typeof value === "string" && /^\d{3}$/u.test(value)
            ? Number(value)
            : Number.NaN;

      if (!Number.isInteger(status)) continue;
      const failureClass = classForStatus(status);

      if (failureClass !== undefined) return failureClass;
    }
  }

  return undefined;
}

function classOf(text: string): FailureClass {
  if (!NOT_CONTEXT_WINDOW_PATTERN.test(text) && CONTEXT_WINDOW_PATTERNS.some((p) => p.test(text))) {
    return "context_window";
  }

  if (RATE_LIMIT_PATTERN.test(text)) return "rate_limit";

  if (OVERLOADED_PATTERN.test(text)) return "overloaded";

  if (NETWORK_PATTERN.test(text)) return "network";

  if (QUOTA_PATTERN.test(text)) return "quota";

  if (AUTH_PATTERN.test(text)) return "auth";

  if (/\b429\b/u.test(text)) return "rate_limit";

  return "provider";
}

function retryAfterMs(message: AssistantMessage): number | undefined {
  for (const diagnostic of message.diagnostics ?? []) {
    for (const key of ["retryAfterMs", "retryDelayMs"]) {
      const value = diagnostic.details?.[key];

      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    }
  }

  const match = message.errorMessage?.match(RETRY_DELAY_PATTERN);
  const seconds = match === null || match === undefined ? Number.NaN : Number(match[1]);
  const maximum = match === null || match === undefined ? Number.NaN : Number(match[2]);

  if (!Number.isFinite(seconds) || seconds < 0) return undefined;

  return Number.isFinite(maximum) && maximum > 0 && seconds > maximum ? undefined : seconds * 1_000;
}

/** Input tokens fill the window: z.ai accepts overflow silently, Xiaomi truncates and stops on `length` with nothing produced. */
function silentOverflow(message: AssistantMessage, contextWindow: number | undefined): boolean {
  if (contextWindow === undefined || contextWindow === 0) return false;
  const inputTokens = message.usage.input + message.usage.cacheRead;

  if (message.stopReason === "stop") return inputTokens > contextWindow;

  return (
    message.stopReason === "length" &&
    message.usage.output === 0 &&
    inputTokens >= contextWindow * 0.99
  );
}

/**
 * Classify an assistant message's failure. `model` enables detecting the
 * overflow a provider accepts without an error. A message that did not fail
 * and did not overflow answers `provider` with an empty message.
 */
export function classifyAssistantFailure(
  message: AssistantMessage,
  model?: Pick<Model<Api>, "contextWindow">,
): Failure {
  if (message.stopReason === "aborted") {
    return { class: "aborted", message: message.errorMessage ?? "Aborted" };
  }

  if (message.stopReason !== "error") {
    return {
      class: silentOverflow(message, model?.contextWindow) ? "context_window" : "provider",
      message: message.errorMessage ?? "",
    };
  }

  const text = message.errorMessage ?? "Unknown error";
  const failure: Failure = { class: structuredClass(message) ?? classOf(text), message: text };
  const delay = retryAfterMs(message);

  return delay === undefined ? failure : { ...failure, retryAfterMs: delay };
}

/** Whether another attempt can change the answer: load, limits that lift, and transport. */
export function isRetryableFailureClass(failureClass: FailureClass): boolean {
  switch (failureClass) {
    case "rate_limit":
    case "overloaded":
    case "network":
      return true;
    case "auth":
    case "quota":
    case "context_window":
    case "aborted":
    case "provider":
    case "runner":
      return false;
    default: {
      const _exhaustive: never = failureClass;

      return _exhaustive;
    }
  }
}
