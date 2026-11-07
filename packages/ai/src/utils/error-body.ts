export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

interface NormalizedProviderError {
  status?: number;
  body?: string;
  message: string;
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

function extractStatus(error: ProviderSdkError): number | undefined {
  if (typeof error.statusCode === "number") return error.statusCode;

  if (typeof error.status === "number") return error.status;

  if (typeof error.$metadata?.httpStatusCode === "number") return error.$metadata.httpStatusCode;

  if (typeof error.$response?.statusCode === "number") return error.$response.statusCode;

  return undefined;
}

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

function plainObjectWithFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);

  if (proto !== Object.prototype && proto !== null) return false;

  return Object.keys(value).length > 0;
}

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

function truncateErrorText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);

    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
