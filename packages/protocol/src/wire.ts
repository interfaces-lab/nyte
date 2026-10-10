import type { ByteReader, Json, OutputFrame, SdkErrorWire } from "@nyte-ai/schema";
import type { SdkError, SdkErrorCode } from "@nyte-ai/core";

/** Maps each error code to the HTTP status the handler answers it with. */
export const errorStatus = {
  invalid: 400,
  unauthenticated: 401,
  denied: 403,
  unknown: 404,
  stale: 409,
  internal: 500,
  unavailable: 503,
} as const satisfies Record<SdkErrorCode, number> satisfies Record<SdkErrorWire["code"], number>;

/** Serialises an `SdkError` as the wire error: code, message, host, issues and correlation. */
export function encodeError(error: SdkError): SdkErrorWire {
  throw new Error("not implemented");
}

/** Rebuilds the `SdkError` a wire error carries; a body that is not a wire error is `internal`. */
export function decodeError(value: Json): SdkError {
  throw new Error("not implemented");
}

/** Frames JSON values as server-sent events: `id:` when the frame has one (a logged event's seq), then `data:` with the JSON. */
export function sseFrames(
  source: AsyncIterable<{ readonly id: string | null; readonly data: Json }>,
): ReadableStream<Uint8Array> {
  throw new Error("not implemented");
}

/** Parses a server-sent event stream into its frames: each one's id, or null, and its JSON data. */
export function parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<{ readonly id: string | null; readonly data: Json }> {
  throw new Error("not implemented");
}

/** Returns an octet-stream response over a byte reader: its size as `Content-Length` and its mime as `Content-Type` when known; cancelling the body closes the reader. */
export function octetStream(reader: ByteReader): Response {
  throw new Error("not implemented");
}

/** Frames a job's output as one octet stream: `bytes` frames raw, each `gap` and the `exit` as a JSON line after a zero-length chunk (decision 7). */
export function outputFrames(source: AsyncIterable<OutputFrame>): ReadableStream<Uint8Array> {
  throw new Error("not implemented");
}

/** Parses an octet stream framed by `outputFrames` back into output frames. */
export function parseOutputFrames(stream: ReadableStream<Uint8Array>): AsyncIterable<OutputFrame> {
  throw new Error("not implemented");
}

/** Returns the request init for an operation whose bytes travel as the body: the JSON input base64url in `X-Nyte-Input`, the bytes as `application/octet-stream`. */
export function withInputHeader(
  input: Json,
  body: Uint8Array | ReadableStream<Uint8Array>,
): RequestInit {
  throw new Error("not implemented");
}

/** Returns the JSON input a request carries in `X-Nyte-Input`, or null when it carries none; a header that is not base64url JSON throws `SdkError("invalid")`. */
export function readInputHeader(request: Request): Json | null {
  throw new Error("not implemented");
}
