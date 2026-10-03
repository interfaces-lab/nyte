/**
 * Response helpers and bounded reads. Error messages are fixed per code and
 * never echo input.
 */
import type { ErrorBody, ErrorCode } from "@nyte-ai/connect";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/** Most bytes the broker reads from a request body. */
export const REQUEST_BODY_LIMIT = 16_384;

const STATUS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  revoked: 410,
  owner_disabled: 403,
  session_revoked: 401,
  limit: 409,
  rate_limited: 429,
  unreachable: 502,
  invalid: 400,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

const MESSAGES = {
  unauthorized: "Authentication failed.",
  forbidden: "Not allowed.",
  not_found: "Not found.",
  conflict: "A concurrent change won. Try again.",
  revoked: "This environment was removed.",
  owner_disabled: "This account is disabled.",
  session_revoked: "Sign in again.",
  limit: "Limit reached.",
  rate_limited: "Too many requests.",
  unreachable: "The desktop did not answer.",
  invalid: "Invalid request.",
  internal: "Internal error.",
} as const satisfies Record<ErrorCode, string>;

/**
 * A request that ends with an error answer. Thrown inside handlers, answered
 * once at the top. `status` overrides the code's usual one, as 503 does for a
 * dependency that cannot answer now.
 */
export class Refusal extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number = STATUS[code]) {
    super(code);
    this.name = "Refusal";
    this.code = code;
    this.status = status;
  }
}

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export function refusal(
  code: ErrorCode,
  init: { readonly status?: number; readonly headers?: Record<string, string> } = {},
): Response {
  const body: ErrorBody = { error: { code, message: MESSAGES[code] } };

  return json(init.status ?? STATUS[code], body, init.headers);
}

/**
 * Read at most `limit` bytes of UTF-8 text. Undefined when the stream is
 * longer, not UTF-8, or fails, so callers never buffer an unbounded answer.
 */
export async function readText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string | undefined> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      size += value.byteLength;

      if (size > limit) {
        await reader.cancel().catch(() => undefined);

        return undefined;
      }

      chunks.push(value);
    }
  } catch {
    return undefined;
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** A request body as text, refused when it is too large or not UTF-8. */
export async function requestText(request: Request, limit = REQUEST_BODY_LIMIT): Promise<string> {
  const declared = request.headers.get("content-length");

  if (declared !== null && !(Number(declared) <= limit)) throw new Refusal("invalid");
  const text = await readText(request.body, limit);

  if (text === undefined) throw new Refusal("invalid");

  return text;
}

/** Parse JSON text against a schema. Anything else is undefined. */
export function parseJson<S extends TSchema>(schema: S, text: string): Static<S> | undefined {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  return Value.Check(schema, value) ? value : undefined;
}

/** Parse a request body against its schema or refuse it. */
export function parseBody<S extends TSchema>(schema: S, text: string): Static<S> {
  const value = parseJson(schema, text);

  if (value === undefined) throw new Refusal("invalid");

  return value;
}
