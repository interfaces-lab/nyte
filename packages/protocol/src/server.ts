import { OPERATIONS } from "@nyte-ai/schema";
import type { Authority, Json } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { bindConnection } from "./binding.ts";
import type {
  Binding,
  BindingOptions,
  BindingRequest,
  ByteBinding,
  ByteName,
  CallBinding,
  CallName,
  FrameBinding,
  FrameName,
} from "./binding.ts";
import { decodeInput, encodeOutput } from "./codec.ts";
import type { OperationName } from "./declarations.ts";
import { parseJson } from "./json.ts";
import { abortable, mapped } from "./streams.ts";
import {
  HOST_HEADER,
  INPUT_HEADER,
  asSdkError,
  encodeError,
  errorStatus,
  octetStream,
  outputFrames,
  readInputHeader,
  sseFrames,
} from "./wire.ts";
import { CANCEL_PATH, CHANNEL_HEADER, CHANNEL_PATH, STREAM_HEADER } from "./stream-channel.ts";
import { createStreamChannels } from "./stream-server.ts";

/** Describes the handler: how a request authenticates to a connection (with the headers its answer carries, such as a pairing's `X-Nyte-Credential`, §40j), what the binding needs, the body limit and the allowed origins. */
export type HandlerOptions = BindingOptions & {
  connection(request: Request): Promise<{
    readonly connection: Connection;
    readonly authority: ReadonlySet<Authority>;
    readonly headers?: Readonly<Record<string, string>>;
  }>;
  readonly maxBodyBytes?: number;
  readonly origins?: readonly string[];
};

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const BYTE_ROWS: { readonly [N in ByteName]: true } = {
  "connection.blob": true,
  "files.bytes": true,
  "page.capture": true,
};

const UPLOADS: ReadonlySet<string> = new Set([
  "files.write",
  "job.write",
  "files.upload",
] satisfies readonly CallName[]);

const ALLOWED_HEADERS = `Authorization, Content-Type, ${INPUT_HEADER}, ${CHANNEL_HEADER}, ${STREAM_HEADER}`;

const EXPOSED_HEADERS = `X-Nyte-Version, X-Nyte-Mime, X-Nyte-Credential, ${HOST_HEADER}, ${CHANNEL_HEADER}`;

const tooLarge = new WeakSet<SdkError>();

/** Returns the whole protocol as one fetch handler: `POST /<name>` per row (anything else `unknown`), CORS for `origins`, the row's authority over the connection the request authenticates to, and the body limit (413). Calls answer JSON, watches and JSON streams server-sent events, byte rows an octet stream and `job.output` framed octets (§40h, §40w); the request's abort ends every stream. An error answers its encoded `SdkError` at the status `errorStatus` gives its code. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const bindings = new WeakMap<Connection, Binding>();
  const channels = createStreamChannels();

  const bindingOf = (connection: Connection): Binding => {
    const known = bindings.get(connection);

    if (known !== undefined) return known;
    const created = bindConnection(connection, options);
    bindings.set(connection, created);

    return created;
  };

  return async (request) => {
    const cors = corsOf(request, options.origins);

    if (cors === null)
      return errorResponse(new SdkError("denied", "This origin may not call the host."), {});

    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": ALLOWED_HEADERS,
          "Access-Control-Max-Age": "600",
        },
      });

    try {
      const path = new URL(request.url).pathname.slice(1);
      const name =
        request.method === "POST" && (path === CHANNEL_PATH || path === CANCEL_PATH)
          ? path
          : nameOf(request);
      const authenticated = await options.connection(request);
      if (name === CHANNEL_PATH) {
        await bodyOf(request, limit);
        return withHeaders(channels.open(authenticated.connection, request.signal), {
          ...cors,
          ...authenticated.headers,
        });
      }
      if (name === CANCEL_PATH) {
        const value = await bodyOf(request, limit);
        if (
          typeof value !== "object" ||
          value === null ||
          !("channel" in value) ||
          typeof value.channel !== "string" ||
          !("stream" in value) ||
          typeof value.stream !== "string"
        )
          throw new SdkError("invalid", "A stream cancellation needs its channel and stream.");
        channels.cancel(authenticated.connection, value.channel, value.stream);
        return withHeaders(new Response(null, { status: 204 }), {
          ...cors,
          ...authenticated.headers,
        });
      }
      const needed = OPERATIONS[name].authority;

      if (!authenticated.authority.has(needed))
        throw new SdkError("denied", `${name} needs ${needed} authority.`);
      const binding = bindingOf(authenticated.connection);
      let response: Response;
      const channel = request.headers.get(CHANNEL_HEADER);
      const stream = request.headers.get(STREAM_HEADER);
      if (channel !== null || stream !== null) {
        if (channel === null || stream === null)
          throw new SdkError("invalid", "A shared stream needs its channel and identifier.");
        response = await channels.start(
          authenticated.connection,
          channel,
          stream,
          request.signal,
          (signal) => serve(binding, name, request, limit, signal),
        );
      } else response = await serve(binding, name, request, limit);

      return withHeaders(response, { ...cors, ...authenticated.headers });
    } catch (error) {
      return errorResponse(error, cors);
    }
  };
}

async function serve(
  binding: Binding,
  name: OperationName,
  request: Request,
  limit: number,
  signal = request.signal,
): Promise<Response> {
  const context: BindingRequest = { body: null, signal };

  if (UPLOADS.has(name) && isCall(name)) {
    const body = limited(request, limit);

    return json(await call(binding, name, readInputHeader(request) ?? {}, { ...context, body }));
  }

  const value = await bodyOf(request, limit);

  if (isCall(name)) return json(await call(binding, name, value, context));

  if (name === "job.output")
    return new Response(
      outputFrames(
        abortable(await binding["job.output"](decodeInput(name, value), context), signal),
      ),
      { status: 200, headers: { "Content-Type": "application/octet-stream" } },
    );

  if (isBytes(name)) return octetStream(await bytes(binding, name, value, context), request.signal);

  return new Response(sseFrames(ending(await frames(binding, name, value, context), signal)), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

async function call<N extends CallName>(
  binding: CallBinding,
  name: N,
  value: unknown,
  request: BindingRequest,
): Promise<Json> {
  return encodeOutput(name, await binding[name](decodeInput(name, value), request));
}

async function bytes<N extends ByteName>(
  binding: ByteBinding,
  name: N,
  value: unknown,
  request: BindingRequest,
) {
  return binding[name](decodeInput(name, value), request);
}

async function frames<N extends FrameName>(
  binding: FrameBinding,
  name: N,
  value: unknown,
  request: BindingRequest,
): Promise<AsyncIterable<Json>> {
  return mapped(await binding[name](decodeInput(name, value), request), (frame) =>
    encodeOutput(name, frame),
  );
}

function ending<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = abortable(source, signal)[Symbol.asyncIterator]();

      return {
        async next() {
          const next = await iterator.next();

          if (next.done === true && signal.reason instanceof SdkError) throw signal.reason;

          return next;
        },
        async return() {
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function bodyOf(request: Request, limit: number): Promise<unknown> {
  const stream = limited(request, limit);

  if (stream === null) return {};
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const read = await reader.read();

    if (read.done) break;
    chunks.push(read.value);
  }

  const decoder = new TextDecoder();

  const text =
    chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();

  return text.trim() === "" ? {} : parseJson(text);
}

function limited(request: Request, limit: number): ReadableStream<Uint8Array> | null {
  const declared = Number(request.headers.get("Content-Length") ?? "0");

  if (declared > limit) throw largerThan(limit);

  if (request.body === null) return null;
  let total = 0;

  return request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;

        if (total > limit) controller.error(largerThan(limit));
        else controller.enqueue(chunk);
      },
    }),
    { signal: request.signal },
  );
}

function largerThan(limit: number): SdkError {
  const error = new SdkError("invalid", `The body is larger than ${limit} bytes.`);
  tooLarge.add(error);

  return error;
}

function corsOf(
  request: Request,
  origins: readonly string[] | undefined,
): Readonly<Record<string, string>> | null {
  const origin = request.headers.get("Origin");

  if (origin === null || origin === new URL(request.url).origin) return {};

  if (!(origins ?? []).includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    Vary: "Origin",
  };
}

function nameOf(request: Request): OperationName {
  const path = new URL(request.url).pathname;
  const name = path.slice(1);

  if (request.method !== "POST" || !isOperation(name))
    throw new SdkError("unknown", `No operation answers ${request.method} ${path}.`);

  return name;
}

function json(value: Json): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error: unknown, headers: Readonly<Record<string, string>>): Response {
  const failure = asSdkError(error);

  return new Response(JSON.stringify(encodeError(failure)), {
    status: tooLarge.has(failure) ? 413 : errorStatus[failure.code],
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function withHeaders(response: Response, headers: Readonly<Record<string, string>>): Response {
  const merged = new Headers(response.headers);

  for (const [key, value] of Object.entries(headers)) merged.set(key, value);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

function isOperation(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}

function isCall(name: OperationName): name is CallName {
  const { kind } = OPERATIONS[name];

  return kind === "query" || kind === "command" || kind === "receipt";
}

function isBytes(name: OperationName): name is ByteName {
  return Object.hasOwn(BYTE_ROWS, name);
}
