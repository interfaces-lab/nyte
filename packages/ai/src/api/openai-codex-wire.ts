/**
 * The ChatGPT Codex backend's wire basics: endpoint URLs, the account id inside the OAuth
 * token, request headers, and the raw frame both transports decode.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ProviderHeaders } from "../types.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";

/**
 * The fields this adapter acts on in a raw Codex SSE/WebSocket frame. Frames
 * carry more fields; unlisted ones pass through untouched. Decoding happens once
 * at the two ingress points (`parseSSE`, `parseWebSocket`) so downstream code
 * branches on decoded values instead of re-narrowing raw JSON.
 */
export interface CodexFrame {
  readonly type: string;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly error?: unknown;
  readonly response?: unknown;
  readonly item?: unknown;
}

export const CodexFrameJson = Type.Object({ type: Type.String() });

const TextJson = Type.String();

const BooleanJson = Type.Boolean();

const NumberJson = Type.Number();

const JsonObjectJson = Type.Record(Type.String(), Type.Unknown());

/** `value` when it is a string. */
export function readText(value: unknown): string | undefined {
  return Value.Check(TextJson, value) ? value : undefined;
}

/** `value` when it is a boolean. */
export function readBoolean(value: unknown): boolean | undefined {
  return Value.Check(BooleanJson, value) ? value : undefined;
}

/** `value` when it is a number. */
export function readNumber(value: unknown): number | undefined {
  return Value.Check(NumberJson, value) ? value : undefined;
}

/** `value` when it is a JSON object. */
export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return Value.Check(JsonObjectJson, value) ? value : undefined;
}

/** Frame types that end a Codex response. */
export const TERMINAL_RESPONSE_TYPES: ReadonlySet<string> = new Set([
  "response.completed",
  "response.done",
  "response.incomplete",
  "response.failed",
]);

export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";

/** The OpenAI auth claim of a ChatGPT OAuth access token. */
const AccessTokenClaimsSchema = Type.Object({
  "https://api.openai.com/auth": Type.Object({
    chatgpt_account_id: Type.String({ minLength: 1 }),
  }),
});

/** A caller timeout floored to whole milliseconds; a negative or non-finite one is rejected. */
export function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid timeoutMs: ${String(value)}`);
  }

  return Math.floor(value);
}

export function resolveCodexUrl(baseUrl?: string): string {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");

  if (normalized.endsWith("/codex/responses")) return normalized;

  if (normalized.endsWith("/codex")) return `${normalized}/responses`;

  return `${normalized}/codex/responses`;
}

export function resolveCodexWebSocketUrl(baseUrl?: string): string {
  const url = new URL(resolveCodexUrl(baseUrl));

  if (url.protocol === "https:") url.protocol = "wss:";

  if (url.protocol === "http:") url.protocol = "ws:";

  return url.toString();
}

/** The ChatGPT account id from the OAuth access token's JWT payload. */
export function extractAccountId(token: string): string {
  const parts = token.split(".");
  let claims: unknown;

  try {
    claims = parts.length === 3 ? JSON.parse(atob(parts[1])) : undefined;
  } catch {
    claims = undefined;
  }

  if (!Value.Check(AccessTokenClaimsSchema, claims)) {
    throw new Error("Failed to extract accountId from token");
  }

  return claims["https://api.openai.com/auth"].chatgpt_account_id;
}

/** Model and caller headers plus the Codex identity every request carries. */
export function buildBaseCodexHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: ProviderHeaders | undefined,
  accountId: string,
  token: string,
): Headers {
  const headers = new Headers(
    Object.entries(providerHeadersToRecord(initHeaders, additionalHeaders) ?? {}),
  );
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "nyte");
  headers.set("User-Agent", getNyteUserAgent());

  return headers;
}

export function buildSSEHeaders(
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

export function buildWebSocketHeaders(
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
