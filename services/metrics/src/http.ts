import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { Stats } from "./stats.ts";

const BODY_LIMIT = 32_768;

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const MESSAGES = {
  400: "Invalid request.",
  404: "Not found.",
  405: "Method not allowed.",
} as const;

export function json(
  status: number,
  body: Stats | { readonly error: string },
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...headers } });
}

export function failure(
  status: keyof typeof MESSAGES,
  headers: Record<string, string> = {},
): Response {
  return json(status, { error: MESSAGES[status] }, headers);
}

export async function readReport<S extends TSchema>(
  request: Request,
  schema: S,
): Promise<Static<S> | undefined> {
  const text = await readBody(request);

  if (text === undefined) return undefined;

  try {
    const value: unknown = JSON.parse(text);

    return Value.Check(schema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readBody(request: Request): Promise<string | undefined> {
  const declared = request.headers.get("content-length");

  if (declared !== null && !(Number(declared) <= BODY_LIMIT)) return undefined;
  const body: ReadableStream<Uint8Array> | null = request.body;

  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  for (;;) {
    const chunk = await reader.read();

    if (chunk.done) return text + decoder.decode();
    size += chunk.value.byteLength;

    if (size > BODY_LIMIT) {
      await reader.cancel();

      return undefined;
    }

    text += decoder.decode(chunk.value, { stream: true });
  }
}
