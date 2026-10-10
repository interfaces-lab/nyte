import { SdkErrorWireSchema } from "@nyte-ai/schema";
import type { ByteReader, Json, OutputFrame, SdkErrorWire } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { SdkErrorCode } from "@nyte-ai/core";
import { isRecord, parseJson } from "./json.ts";

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

/** One frame of a server-sent event stream: a logged event's seq as its id, or null, and its JSON data. */
export type SseFrame = { readonly id: string | null; readonly data: Json };

/** Names the request header that carries an operation's JSON input when the body carries its bytes. */
export const INPUT_HEADER = "X-Nyte-Input";

const DATA = 0;

const CONTROL = 1;

/** Serialises an `SdkError` as the wire error: code, message, host, issues and correlation. */
export function encodeError(error: SdkError): SdkErrorWire {
  return {
    code: error.code,
    message: error.message,
    hostId: error.hostId,
    issues: error.issues,
    correlation: error.correlation,
  };
}

/** Rebuilds the `SdkError` a wire error carries; a body that is not a wire error is the code `statusCode` gives the response's status, `internal` without one. */
export function decodeError(value: Json, status?: number): SdkError {
  const result = SdkErrorWireSchema["~standard"].validate(value);

  if (result instanceof Promise || result.issues !== undefined)
    return new SdkError(
      status === undefined ? "internal" : statusCode(status),
      typeof value === "string" && value !== ""
        ? value
        : "The host answered with an error it did not describe.",
    );
  const wire = result.value;

  return new SdkError(wire.code, wire.message, {
    hostId: wire.hostId,
    issues: wire.issues,
    correlation: wire.correlation,
  });
}

/** Returns the error code an HTTP status stands for when the body is not a wire error: `invalid` for 400 and 413, `internal` for any status the table does not name. */
export function statusCode(status: number): SdkErrorCode {
  if (status === 413) return "invalid";

  for (const [code, known] of Object.entries(errorStatus))
    if (known === status && isCode(code)) return code;

  return "internal";
}

/** Frames JSON values as server-sent events: `id:` when the frame has one (a logged event's seq), then `data:` with the JSON; a `: ping` comment every `heartbeatMs` while it waits; an error the source throws is the last frame, an `error` event carrying the wire error. Cancelling the stream returns the source. */
export function sseFrames(
  source: AsyncIterable<SseFrame>,
  options?: { readonly heartbeatMs?: number },
): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const every = options?.heartbeatMs;

      if (every !== undefined)
        timer = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), every);
    },
    async pull(controller) {
      try {
        const next = await iterator.next();

        if (next.done === true) {
          clearInterval(timer);
          controller.close();

          return;
        }

        const id = next.value.id === null ? "" : `id: ${next.value.id}\n`;
        controller.enqueue(encoder.encode(`${id}data: ${JSON.stringify(next.value.data)}\n\n`));
      } catch (error) {
        clearInterval(timer);
        const wire = JSON.stringify(encodeError(asSdkError(error)));
        controller.enqueue(encoder.encode(`event: error\ndata: ${wire}\n\n`));
        controller.close();
      }
    },
    async cancel() {
      clearInterval(timer);
      await iterator.return?.();
    },
  });
}

/** Parses a server-sent event stream into its frames: each one's id, or null, and its JSON data; comments are skipped, and an `error` event throws the `SdkError` it carries. Returning early cancels the stream. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const read = await reader.read();
      buffer += read.done ? decoder.decode() : decoder.decode(read.value, { stream: true });
      const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
      buffer = read.done ? "" : (blocks.pop() ?? "");

      for (const block of blocks) {
        const frame = frameOf(block);

        if (frame !== null) yield frame;
      }

      if (read.done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Returns an `application/octet-stream` response over a byte reader: its mime in `X-Nyte-Mime` and its size as `Content-Length` when known (§40w), plus `headers`; cancelling the body closes the reader. */
export function octetStream(body: {
  readonly reader: ByteReader;
  readonly headers?: Readonly<Record<string, string>>;
}): Response {
  const { reader } = body;
  const chunks = reader.chunks()[Symbol.asyncIterator]();
  const headers = new Headers(body.headers);
  headers.set("Content-Type", "application/octet-stream");

  if (reader.mime !== null) headers.set("X-Nyte-Mime", reader.mime);

  if (reader.size !== null) headers.set("Content-Length", String(reader.size));

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();

        if (next.done === true) {
          controller.close();
          await reader.close();

          return;
        }

        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        await reader.close();
      }
    },
    async cancel() {
      await chunks.return?.();
      await reader.close();
    },
  });

  return new Response(stream, { status: 200, headers });
}

/** Frames a job's output as one octet stream (§40h): each `bytes` frame `0x00 <u32be length> <bytes>`, each `gap` and the `exit` `0x01 <u32be length> <json>`; an error the source throws is a last control frame carrying the wire error. Cancelling the stream returns the source. */
export function outputFrames(source: AsyncIterable<OutputFrame>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();

        if (next.done === true) {
          controller.close();

          return;
        }

        const frame = next.value;
        controller.enqueue(
          frame.kind === "bytes"
            ? framed(DATA, frame.data)
            : framed(CONTROL, encoder.encode(JSON.stringify(frame))),
        );
      } catch (error) {
        const failure = { kind: "error", error: encodeError(asSdkError(error)) };
        controller.enqueue(framed(CONTROL, encoder.encode(JSON.stringify(failure))));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Parses an octet stream framed by `outputFrames` back into output frames; a control frame of a kind it does not know is skipped, and an error frame throws the `SdkError` it carries. Returning early cancels the stream. */
export async function* parseOutputFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<OutputFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer: Uint8Array = new Uint8Array(0);

  try {
    for (;;) {
      const read = await reader.read();

      if (read.done) {
        if (buffer.byteLength > 0)
          throw new SdkError("internal", "The output stream ended mid-frame.");

        return;
      }

      buffer = joined(buffer, read.value);

      while (buffer.byteLength >= 5) {
        const length = new DataView(buffer.buffer, buffer.byteOffset, 5).getUint32(1);

        if (buffer.byteLength < 5 + length) break;
        const tag = buffer[0];
        const payload = buffer.slice(5, 5 + length);
        buffer = buffer.slice(5 + length);

        if (tag === DATA) {
          yield { kind: "bytes", data: payload };
          continue;
        }

        const control = controlOf(parseJson(decoder.decode(payload)));

        if (control !== null) yield control;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Returns the request init for an operation whose bytes travel as the body: the JSON input base64url in `X-Nyte-Input`, the bytes as `application/octet-stream`. */
export function withInputHeader(
  input: Json,
  body: Uint8Array | ReadableStream<Uint8Array>,
): RequestInit & { readonly headers: Readonly<Record<string, string>> } {
  return {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", [INPUT_HEADER]: base64url(input) },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  };
}

/** Returns the JSON input a request carries in `X-Nyte-Input`, or null when it carries none; a header that is not base64url JSON throws `SdkError("invalid")`. */
export function readInputHeader(request: Request): Json | null {
  const header = request.headers.get(INPUT_HEADER);

  if (header === null) return null;

  try {
    const binary = atob(header.replace(/-/g, "+").replace(/_/g, "/"));

    return parseJson(
      new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
    );
  } catch {
    throw new SdkError("invalid", `${INPUT_HEADER} is not base64url JSON.`);
  }
}

/** Returns an error as the `SdkError` the wire carries: itself when it is one, else `internal` with a fresh correlation id. */
export function asSdkError(error: unknown): SdkError {
  if (error instanceof SdkError) return error;

  return new SdkError("internal", "The host failed to answer.", {
    correlation: crypto.randomUUID(),
  });
}

function isCode(code: string): code is SdkErrorCode {
  return Object.hasOwn(errorStatus, code);
}

function frameOf(block: string): SseFrame | null {
  let id: string | null = null;
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  if (data.length === 0) return null;
  const json = parseJson(data.join("\n"));

  if (event === "error") throw decodeError(json);

  return { id, data: json };
}

function controlOf(value: Json): OutputFrame | null {
  if (!isRecord(value)) return null;

  if (value.kind === "gap") return { kind: "gap" };

  if (value.kind === "exit")
    return { kind: "exit", code: typeof value.code === "number" ? value.code : null };

  if (value.kind === "error" && value.error !== undefined) throw decodeError(value.error);

  return null;
}

function framed(tag: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + payload.byteLength);
  frame[0] = tag;
  new DataView(frame.buffer).setUint32(1, payload.byteLength);
  frame.set(payload, 5);

  return frame;
}

function joined(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const both = new Uint8Array(left.byteLength + right.byteLength);
  both.set(left);
  both.set(right, left.byteLength);

  return both;
}

function base64url(input: Json): string {
  const utf8 = encodeURIComponent(JSON.stringify(input)).replace(
    /%([0-9A-F]{2})/g,
    (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
  );

  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
