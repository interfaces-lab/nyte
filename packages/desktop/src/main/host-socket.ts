import { request as httpRequest } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { SOCKET_LIMITS } from "@nyte-ai/schema";
import type { SocketLike } from "../shared/host-port.ts";
import WebSocket from "ws";

export function socketFetch(path: string): (request: Request) => Promise<Response> {
  return (request) => send(path, request);
}

/** Opens a WebSocket to the host's socket. A `ws` socket throws an `error` event nobody listens for, which crashes main while the host is down, so the error is dropped: the `close` that follows it tells the window. */
export function socketDial(path: string): (target: string) => SocketLike {
  return (target) => {
    const socket = new WebSocket(`ws+unix://${path}:${target}`, {
      maxPayload: SOCKET_LIMITS.maxFrameBytes,
    });

    socket.on("error", () => undefined);

    return socket;
  };
}

async function send(path: string, request: Request): Promise<Response> {
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  const headers: OutgoingHttpHeaders = {};

  request.headers.forEach((value, name) => {
    if (name !== "authorization") headers[name] = value;
  });

  const answered = Promise.withResolvers<Response>();

  const outgoing = httpRequest(
    {
      socketPath: path,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: "localhost" },
      signal: request.signal,
    },
    (incoming) => answered.resolve(response(incoming, request.method)),
  );

  outgoing.once("error", (cause) => {
    answered.reject(request.signal.aborted ? request.signal.reason : new TypeError(cause.message));
  });

  if (request.body === null) outgoing.end();
  else void upload(request.body, outgoing);

  return answered.promise;
}

async function upload(
  body: ReadableStream<Uint8Array>,
  outgoing: ReturnType<typeof httpRequest>,
): Promise<void> {
  const reader = body.getReader();

  try {
    for (let read = await reader.read(); !read.done; read = await reader.read())
      if (!outgoing.write(read.value))
        await new Promise<void>((drained) => {
          outgoing.once("drain", drained);
          outgoing.once("close", drained);
        });

    outgoing.end();
  } catch (cause) {
    outgoing.destroy(cause instanceof Error ? cause : new Error(String(cause)));
  }
}

function response(incoming: IncomingMessage, method: string): Response {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) for (const each of value) headers.append(name, each);
    else headers.set(name, value);
  }

  const status = incoming.statusCode ?? 502;
  const empty = method === "HEAD" || status === 204 || status === 304;

  if (empty) incoming.resume();

  return new Response(empty ? null : stream(incoming), { status, headers });
}

function stream(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));

        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.on("end", () => controller.close());
      incoming.on("error", (cause) => controller.error(new TypeError(cause.message)));
      incoming.on("aborted", () => controller.error(new TypeError("The Nyte host went away.")));
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      incoming.destroy();
    },
  });
}
