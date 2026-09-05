/**
 * One stateless `tools/call` against a public MCP search route. opencode does
 * not open an MCP session for these: the routes answer a bare JSON-RPC POST
 * with either a JSON body or one SSE frame, so this posts once and reads the
 * `result` out of whichever came back.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/websearch/mcp.ts
 * and https://github.com/anomalyco/opencode/blob/v2/packages/core/src/tool/http-body.ts
 */
import { Buffer } from "node:buffer";
import type { JsonValue } from "@nyte-ai/schema";
import { type Static, type TObject } from "typebox";
import { Value } from "typebox/value";
import { WebSearchRequestError } from "./provider.ts";

export const MAX_RESPONSE_BYTES = 256 * 1024;
export const REQUEST_TIMEOUT_MS = 25_000;

export interface McpCallOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal | undefined;
  readonly headers?: Headers;
}

function isTimeout(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "TimeoutError";
}

/** Bound the request by `REQUEST_TIMEOUT_MS` and by the caller's own signal. */
export function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/** Rethrow a caller's abort untouched; name a timeout; wrap anything else as a request failure. */
export function requestFailure(
  cause: unknown,
  signal: AbortSignal | undefined,
  timedOut: string,
): Error {
  if (signal?.aborted === true && cause instanceof Error) return cause;
  if (isTimeout(cause)) return new WebSearchRequestError(timedOut, { cause });
  if (cause instanceof WebSearchRequestError) return cause;
  return new WebSearchRequestError(cause instanceof Error ? cause.message : String(cause), {
    cause,
  });
}

/** Read a body up to `maximumBytes`, trusting a declared length only to refuse early. */
export async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  tooLarge: () => Error,
): Promise<string> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isSafeInteger(declared) && declared > maximumBytes) throw tooLarge();
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeFrame<TResult extends TObject>(
  payload: string,
  result: TResult,
): Static<TResult> | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error("MCP route returned a frame that is not JSON", { cause });
  }
  if (!isJsonObject(parsed)) return undefined;
  const candidate = parsed["result"];
  if (candidate === undefined) return undefined;
  if (!Value.Check(result, candidate)) {
    throw new Error("MCP route returned a result the tool does not recognise");
  }
  return candidate;
}

/** The `result` of a JSON body, or of the first SSE `data:` frame that carries one. */
export function parseMcpResponse<TResult extends TObject>(
  body: string,
  result: TResult,
): Static<TResult> | undefined {
  const direct = body.trim() === "" ? undefined : decodeFrame(body, result);
  if (direct !== undefined) return direct;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const frame = decodeFrame(line.slice(6), result);
    if (frame !== undefined) return frame;
  }
  return undefined;
}

/**
 * Post one `tools/call` and decode its result against `output`. A non-2xx
 * answer carries its status so the tool can name rate limits and bad keys.
 * A body the route never sent (empty, or SSE without a result frame) is
 * `undefined`, which providers read as no results.
 */
export async function callMcpTool<TOutput extends TObject>(
  url: string,
  tool: string,
  args: Readonly<Record<string, JsonValue>>,
  output: TOutput,
  options: McpCallOptions,
): Promise<Static<TOutput> | undefined> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });
  if (options.headers !== undefined) {
    for (const [name, value] of options.headers) headers.set(name, value);
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
  try {
    const response = await options.fetch(url, {
      method: "POST",
      headers,
      body,
      signal: requestSignal(options.signal),
    });
    if (!response.ok) {
      const text = await readBoundedBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${String(MAX_RESPONSE_BYTES)} bytes`),
      ).catch(() => "");
      throw new WebSearchRequestError(
        text.trim() || response.statusText || `HTTP ${String(response.status)}`,
        {
          status: response.status,
        },
      );
    }
    const text = await readBoundedBody(
      response,
      MAX_RESPONSE_BYTES,
      () => new Error(`${tool} response exceeded ${String(MAX_RESPONSE_BYTES)} bytes`),
    );
    return parseMcpResponse(text, output);
  } catch (error) {
    throw requestFailure(error, options.signal, `${tool} request timed out`);
  }
}
