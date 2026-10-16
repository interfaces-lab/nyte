/**
 * Shared normalization for provider HTTP error objects. Gateways and proxies can return non-2xx bodies the SDK cannot fold into `error.message`; this probes the known SDK field shapes so adapters can surface status and body instead of an opaque message.
 */

export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

export interface NormalizedProviderError {
  /** HTTP status code, when one could be extracted from the SDK error object. */
  status?: number;
  /** Raw HTTP body reason, already trimmed and truncated to the cap. */
  body?: string;
  /** `error.message`, or `safeJsonStringify(error)` for a non-`Error` throw. */
  message: string;
  /** True when `message` already contains the body (no separate body to add). */
  messageCarriesBody: boolean;
}

type ProviderSdkError = Error & {
  statusCode?: unknown;
  status?: unknown;
  body?: unknown;
  error?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { statusCode?: unknown; body?: unknown };
};

export function normalizeProviderError(cause: unknown): NormalizedProviderError {
  if (!(cause instanceof Error)) {
    return { message: safeJsonStringify(cause), messageCarriesBody: false };
  }

  const status = extractStatus(cause);
  const body = extractBody(cause);
  const messageCarriesBody = body === undefined || cause.message.includes(body);

  return {
    status,
    body,
    message: cause.message,
    messageCarriesBody,
  } satisfies NormalizedProviderError;
}

/**
 * Probe the HTTP status, first numeric hit wins, in SDK-field order:
 * `statusCode` (Mistral) → `status` (`openai`, `@google/genai`) →
 * `$metadata.httpStatusCode` (Bedrock) → `$response.statusCode` (Bedrock).
 */
function extractStatus(error: ProviderSdkError): number | undefined {
  if (typeof error.statusCode === "number") return error.statusCode;

  if (typeof error.status === "number") return error.status;

  if (typeof error.$metadata?.httpStatusCode === "number") return error.$metadata.httpStatusCode;

  if (typeof error.$response?.statusCode === "number") return error.$response.statusCode;

  return undefined;
}

/**
 * Probe the raw body reason, first usable hit wins, in SDK-field order:
 * `body` string (Mistral) → `error` parsed JSON body object (`openai` SDK's
 * `this.error`) → `$response.body` (Bedrock). Empty objects and unread response
 * streams are treated as no body so they do not surface as `"{}"` or serialized
 * stream internals. The chosen body is truncated to the cap.
 */
function extractBody(error: ProviderSdkError): string | undefined {
  const bodyText = pickBodyText(error);

  if (bodyText === undefined) return undefined;
  const trimmed = bodyText.trim();

  if (trimmed.length === 0) return undefined;

  return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS);
}

function pickBodyText(error: ProviderSdkError): string | undefined {
  if (typeof error.body === "string") return error.body;

  if (plainObjectWithFields(error.error)) return safeJsonStringify(error.error);
  const responseBody = error.$response?.body;

  if (typeof responseBody === "string") return responseBody;

  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "pipe" in responseBody &&
    typeof responseBody.pipe === "function"
  )
    return undefined;

  if (plainObjectWithFields(responseBody)) return safeJsonStringify(responseBody);

  return undefined;
}

/**
 * Only a PLAIN object counts as an HTTP body. SDK error fields can hold class
 * instances instead of parsed bodies - AWS SDK v3's `$response.body` is an
 * HTTP stream/response wrapper object, and stringifying one produced garbage
 * like `{"_events":...}` as the "body", which then REPLACED `error.message`
 * in the composed display string. `error.message` is where the SDK puts the
 * real deserialized exception text ("Input is too long...", schema validation
 * details, ...), so the one useful string was discarded for noise. A class
 * instance yields no body, `messageCarriesBody` stays true, and the real
 * message survives. Complements the `pipe` sniffing above: web
 * ReadableStreams (pipeTo/pipeThrough, no `pipe`) and non-stream SDK wrapper
 * classes fail the prototype check, while parsed JSON bodies (plain objects
 * by construction) still pass.
 */
function plainObjectWithFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);

  if (proto !== Object.prototype && proto !== null) return false;

  return Object.keys(value).length > 0;
}

/**
 * Compose a display string from a normalized error. When the message already
 * carries the body (Anthropic / `@google/genai` happy path) or no body/status
 * was extracted, the message is returned unchanged. Otherwise the status and
 * body are surfaced, with an optional provider prefix.
 *
 * - no prefix: `"<status>: <body>"`
 * - prefix:    `"<prefix> (<status>): <body>"`
 */
export function formatProviderError(norm: NormalizedProviderError, prefix?: string): string {
  if (norm.messageCarriesBody || norm.status === undefined || norm.body === undefined) {
    return prefix !== undefined && norm.status !== undefined
      ? `${prefix} (${norm.status}): ${norm.message}`
      : norm.message;
  }

  return prefix !== undefined
    ? `${prefix} (${norm.status}): ${norm.body}`
    : `${norm.status}: ${norm.body}`;
}

export function truncateErrorText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);

    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
