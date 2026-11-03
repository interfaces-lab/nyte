import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { OpenSocket } from "@nyte-ai/sdk/client";

export const HOST_PORT_ORIGIN = "http://127.0.0.1";

const WINDOW = 1 << 20;

function frameCost(bytes: Uint8Array): number {
  return Math.max(bytes.byteLength, 1024);
}

const Id = Type.Integer({ minimum: 0 });

const HeaderPairs = Type.Array(Type.Tuple([Type.String(), Type.String()]));

const Bytes = Type.Unsafe<Uint8Array>(
  Type.Refine(Type.Unknown(), (value) => value instanceof Uint8Array),
);

const PortMessageType = Type.Union([
  Type.Object({
    kind: Type.Literal("request"),
    id: Id,
    method: Type.String(),
    path: Type.String(),
    headers: HeaderPairs,
    body: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal("response"),
    id: Id,
    status: Type.Integer(),
    headers: HeaderPairs,
    body: Type.Boolean(),
  }),
  Type.Object({ kind: Type.Literal("data"), id: Id, bytes: Bytes }),
  Type.Object({ kind: Type.Literal("end"), id: Id }),
  Type.Object({ kind: Type.Literal("credit"), id: Id, bytes: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal("reset"), id: Id }),
  Type.Object({ kind: Type.Literal("socket"), id: Id, path: Type.String() }),
  Type.Object({ kind: Type.Literal("opened"), id: Id }),
  Type.Object({ kind: Type.Literal("frame"), id: Id, text: Type.String() }),
  Type.Object({ kind: Type.Literal("shut"), id: Id, code: Type.Integer(), reason: Type.String() }),
]);

export type PortMessage = Static<typeof PortMessageType>;

export interface PortEnd {
  open(handlers: { readonly message: (data: unknown) => void; readonly closed: () => void }): void;
  post(message: PortMessage): void;
  close(): void;
}

type Post = (message: PortMessage) => void;

export type SocketLike = ReturnType<OpenSocket>;

type SocketMessage = Extract<PortMessage, { kind: "socket" | "opened" | "frame" | "shut" }>;

type ExchangeMessage = Exclude<PortMessage, SocketMessage>;

export type DialSocket = (path: string) => SocketLike;

export interface HostPort {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly socket: (request: { readonly url: string }) => SocketLike;
}

type SocketListener = (event: {
  readonly data: unknown;
  readonly code: number;
  readonly reason: string;
}) => void;

export function messagePortEnd(port: MessagePort): PortEnd {
  return {
    open({ message, closed }) {
      port.addEventListener("message", (event) => message(event.data));
      port.addEventListener("close", closed, { once: true });
      port.start();
    },
    post: (message) => port.postMessage(message),
    close: () => port.close(),
  };
}

export function portFetch(
  connect: () => Promise<PortEnd>,
): (url: string, init?: RequestInit) => Promise<Response> {
  return hostPort(connect).fetch;
}

export function hostPort(connect: () => Promise<PortEnd>): HostPort {
  let current: Promise<Client> | undefined;

  const client = (): Promise<Client> => {
    if (current !== undefined) return current;

    const opening = connect().then(
      (port) =>
        openClient(port, () => {
          if (current === opening) current = undefined;
        }),
      (cause: unknown) => {
        if (current === opening) current = undefined;

        throw new TypeError(cause instanceof Error ? cause.message : String(cause));
      },
    );

    current = opening;

    return opening;
  };

  return {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      request.signal.throwIfAborted();
      const aborted = Promise.withResolvers<never>();
      const abort = (): void => aborted.reject(request.signal.reason);
      request.signal.addEventListener("abort", abort, { once: true });

      try {
        return (await Promise.race([client(), aborted.promise])).send(request);
      } finally {
        request.signal.removeEventListener("abort", abort);
      }
    },
    socket: (request) => {
      const target = new URL(request.url);

      return portSocket(client, `${target.pathname}${target.search}`);
    },
  };
}

/** A WebSocket over the window's host port. As with a WebSocket, an abnormal closure (1006, such as a dial the host refused) fires `error` first, since `openHostSocket` waits for `open` or `error` and never sees a bare `close`. */
function portSocket(client: () => Promise<Client>, path: string): SocketLike {
  const listeners = new Map<string, Set<SocketListener>>();
  let opened: OpenedSocket | null = null;
  let shut = false;

  const emit = (type: string, data: unknown, code = 0, reason = ""): void => {
    for (const listener of listeners.get(type) ?? []) listener({ data, code, reason });
  };

  const close = (code: number, reason: string): void => {
    if (shut) return;
    shut = true;
    emit("close", undefined, code, reason);
  };

  void client().then(
    (connected) => {
      if (shut) return;
      opened = connected.dial(path, {
        opened: () => emit("open", undefined),
        frame: (text) => emit("message", text),
        shut: (code, reason) => {
          if (code === 1006) emit("error", undefined);
          close(code, reason);
        },
      });
    },
    (cause: unknown) => {
      emit("error", undefined);
      close(1006, cause instanceof Error ? cause.message : String(cause));
    },
  );

  return {
    send(data) {
      if (opened === null || shut) throw new TypeError("The Nyte host's socket is not open.");
      opened.send(data);
    },
    close(code, reason) {
      opened?.close(code ?? 1000, reason ?? "");
      close(code ?? 1000, reason ?? "");
    },
    addEventListener(type: string, listener: SocketListener) {
      const known = listeners.get(type) ?? new Set<SocketListener>();
      known.add(listener);
      listeners.set(type, known);
    },
  };
}

interface OpenedSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
}

interface SocketHandlers {
  readonly opened: () => void;
  readonly frame: (text: string) => void;
  readonly shut: (code: number, reason: string) => void;
}

export function servePort(
  port: PortEnd,
  fetch: (request: Request) => Promise<Response>,
  dial?: DialSocket,
): void {
  const exchanges = new Map<
    number,
    { receive: (message: ExchangeMessage) => void; abandon: () => void }
  >();

  const sockets = new Map<number, SocketLike>();
  const post: Post = (message) => port.post(message);

  const shut = (): void => {
    for (const exchange of exchanges.values()) exchange.abandon();
    exchanges.clear();

    for (const socket of sockets.values()) socket.close(1001, "The window closed.");
    sockets.clear();
  };

  port.open({
    message(data) {
      const message = readMessage(data);

      if (message === undefined || message.kind === "response" || message.kind === "opened") {
        port.close();
        shut();

        return;
      }

      if (message.kind === "request") {
        answer(message);

        return;
      }

      if (message.kind === "socket" || message.kind === "frame" || message.kind === "shut") {
        relaySocket(message);

        return;
      }

      exchanges.get(message.id)?.receive(message);
    },
    closed: shut,
  });

  function relaySocket(
    message: Extract<SocketMessage, { kind: "socket" | "frame" | "shut" }>,
  ): void {
    const id = message.id;

    if (message.kind === "frame") {
      sockets.get(id)?.send(message.text);

      return;
    }

    if (message.kind === "shut") {
      sockets.get(id)?.close(sendableCode(message.code), message.reason);
      sockets.delete(id);

      return;
    }

    if (sockets.has(id) || dial === undefined) {
      post({ kind: "shut", id, code: 1011, reason: "The host's socket is not served here." });

      return;
    }

    const socket = dial(message.path);
    sockets.set(id, socket);
    socket.addEventListener("open", () => post({ kind: "opened", id }));
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") post({ kind: "frame", id, text: event.data });
      else if (event.data instanceof Uint8Array || event.data instanceof ArrayBuffer)
        post({ kind: "frame", id, text: new TextDecoder().decode(event.data) });
    });
    socket.addEventListener("close", (event) => {
      if (sockets.get(id) !== socket) return;
      sockets.delete(id);
      post({ kind: "shut", id, code: event.code, reason: event.reason });
    });
  }

  function answer(message: Extract<PortMessage, { kind: "request" }>): void {
    const { id } = message;
    const controller = new AbortController();
    let download: Outbound | undefined;

    const upload = message.body
      ? inbound(
          (bytes) => post({ kind: "credit", id, bytes }),
          () => undefined,
        )
      : undefined;

    const abandon = (): void => {
      exchanges.delete(id);
      const reason = new TypeError("The window's request was abandoned.");
      controller.abort(reason);
      upload?.fail(reason);
      download?.stop();
    };

    exchanges.set(id, {
      receive(frame) {
        switch (frame.kind) {
          case "data":
            upload?.push(frame.bytes);

            return;
          case "end":
            upload?.end();

            return;
          case "credit":
            download?.credit(frame.bytes);

            return;
          case "reset":
            abandon();

            return;
          case "request":
          case "response":
            return;
          default: {
            const _exhaustive: never = frame;

            return _exhaustive;
          }
        }
      },
      abandon,
    });

    void (async () => {
      const url = new URL(message.path, HOST_PORT_ORIGIN);
      const init = { method: message.method, headers: message.headers, signal: controller.signal };

      const withBody =
        upload === undefined ? init : { ...init, body: upload.stream, duplex: "half" as const };

      let response: Response;

      try {
        response = await fetch(new Request(url, withBody));
      } catch {
        if (!exchanges.has(id)) return;
        post({ kind: "reset", id });
        abandon();

        return;
      }

      if (!exchanges.has(id)) {
        await response.body?.cancel().catch(() => undefined);

        return;
      }

      post({
        kind: "response",
        id,
        status: response.status,
        headers: [...response.headers],
        body: response.body !== null,
      });

      if (response.body === null) {
        exchanges.delete(id);

        return;
      }

      download = outbound(id, response.body, post, {
        ended: () => exchanges.delete(id),
        failed: () => {
          post({ kind: "reset", id });
          abandon();
        },
      });
    })();
  }
}

interface Client {
  send(request: Request): Promise<Response>;
  dial(path: string, handlers: SocketHandlers): OpenedSocket;
}

function openClient(port: PortEnd, lost: () => void): Client {
  const exchanges = new Map<
    number,
    { receive: (message: ExchangeMessage) => void; fail: (reason: unknown) => void }
  >();

  const sockets = new Map<number, SocketHandlers>();
  const post: Post = (message) => port.post(message);
  let next = 0;
  let closed = false;

  const shut = (): void => {
    if (closed) return;
    closed = true;
    lost();
    const reason = new TypeError("The Nyte host's port closed.");

    for (const exchange of exchanges.values()) exchange.fail(reason);
    exchanges.clear();

    for (const socket of sockets.values()) socket.shut(1006, reason.message);
    sockets.clear();
  };

  port.open({
    message(data) {
      const message = readMessage(data);

      if (message === undefined || message.kind === "request" || message.kind === "socket") {
        port.close();
        shut();

        return;
      }

      if (message.kind === "opened") {
        sockets.get(message.id)?.opened();

        return;
      }

      if (message.kind === "frame") {
        sockets.get(message.id)?.frame(message.text);

        return;
      }

      if (message.kind === "shut") {
        const socket = sockets.get(message.id);
        sockets.delete(message.id);
        socket?.shut(message.code, message.reason);

        return;
      }

      exchanges.get(message.id)?.receive(message);
    },
    closed: shut,
  });

  return {
    dial(path, handlers) {
      const id = next++;

      if (closed) {
        queueMicrotask(() => handlers.shut(1006, "The Nyte host's port closed."));

        return { send: () => undefined, close: () => undefined };
      }

      sockets.set(id, handlers);
      post({ kind: "socket", id, path });

      return {
        send: (text) => post({ kind: "frame", id, text }),
        close(code, reason) {
          if (!sockets.delete(id)) return;
          post({ kind: "shut", id, code, reason });
        },
      };
    },
    send(request) {
      if (closed) return Promise.reject(new TypeError("The Nyte host's port closed."));
      const id = next++;
      const response = Promise.withResolvers<Response>();
      let body: Inbound | undefined;
      let upload: Outbound | undefined;

      const finish = (): void => {
        exchanges.delete(id);
        upload?.stop();
        request.signal.removeEventListener("abort", abort);
      };

      const fail = (reason: unknown): void => {
        finish();
        response.reject(reason);
        body?.fail(reason);
      };

      const abort = (): void => {
        post({ kind: "reset", id });
        fail(request.signal.reason);
      };

      const receive = (message: ExchangeMessage): void => {
        switch (message.kind) {
          case "response": {
            body = message.body
              ? inbound(
                  (bytes) => post({ kind: "credit", id, bytes }),
                  () => {
                    post({ kind: "reset", id });
                    finish();
                  },
                )
              : undefined;

            try {
              response.resolve(
                new Response(body?.stream ?? null, {
                  status: message.status,
                  headers: message.headers,
                }),
              );
            } catch (cause) {
              post({ kind: "reset", id });
              fail(new TypeError(cause instanceof Error ? cause.message : String(cause)));

              return;
            }

            if (body === undefined) finish();

            return;
          }

          case "data":
            body?.push(message.bytes);

            return;
          case "end":
            body?.end();
            finish();

            return;
          case "credit":
            upload?.credit(message.bytes);

            return;
          case "reset":
            fail(new TypeError("The Nyte host abandoned the request."));

            return;
          case "request":
            return;
          default: {
            const _exhaustive: never = message;

            return _exhaustive;
          }
        }
      };

      exchanges.set(id, { receive, fail });
      request.signal.addEventListener("abort", abort, { once: true });
      const target = new URL(request.url);
      post({
        kind: "request",
        id,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: [...request.headers],
        body: request.body !== null,
      });

      if (request.body !== null)
        upload = outbound(id, request.body, post, {
          ended: () => undefined,
          failed: (cause) => {
            post({ kind: "reset", id });
            fail(new TypeError(cause instanceof Error ? cause.message : String(cause)));
          },
        });

      return response.promise;
    },
  };
}

interface Inbound {
  readonly stream: ReadableStream<Uint8Array>;
  push(bytes: Uint8Array): void;
  end(): void;
  fail(reason: unknown): void;
}

function inbound(credit: (bytes: number) => void, cancelled: () => void): Inbound {
  const queue: Uint8Array[] = [];

  let state:
    | { readonly kind: "open" | "ended" | "cancelled" }
    | { readonly kind: "failed"; readonly reason: unknown } = {
    kind: "open",
  };

  let unreturned = 0;
  let arrived: (() => void) | undefined;

  const wake = (): void => {
    arrived?.();
    arrived = undefined;
  };

  return {
    stream: new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          while (queue.length === 0 && state.kind === "open")
            await new Promise<void>((resolve) => {
              arrived = resolve;
            });

          if (state.kind === "failed") {
            controller.error(state.reason);

            return;
          }

          const chunk = queue.shift();

          if (chunk === undefined) {
            controller.close();

            return;
          }

          controller.enqueue(chunk);
          unreturned += frameCost(chunk);

          if (unreturned < WINDOW / 2) return;
          credit(unreturned);
          unreturned = 0;
        },
        cancel() {
          state = { kind: "cancelled" };
          queue.length = 0;
          cancelled();
        },
      },
      { highWaterMark: 0 },
    ),
    push(bytes) {
      if (state.kind !== "open") return;
      queue.push(bytes);
      wake();
    },
    end() {
      if (state.kind !== "open") return;
      state = { kind: "ended" };
      wake();
    },
    fail(reason) {
      if (state.kind !== "open" && state.kind !== "ended") return;
      state = { kind: "failed", reason };
      queue.length = 0;
      wake();
    },
  };
}

interface Outbound {
  credit(bytes: number): void;
  stop(): void;
}

function outbound(
  id: number,
  body: ReadableStream<Uint8Array>,
  post: Post,
  settled: { readonly ended: () => void; readonly failed: (cause: unknown) => void },
): Outbound {
  const reader = body.getReader();
  let unread = 0;
  let stopped = false;
  let credited: (() => void) | undefined;

  const wake = (): void => {
    credited?.();
    credited = undefined;
  };

  void (async () => {
    try {
      for (;;) {
        while (unread >= WINDOW && !stopped)
          await new Promise<void>((resolve) => {
            credited = resolve;
          });

        if (stopped) return;
        const read = await reader.read();

        if (stopped) return;

        if (read.done) {
          post({ kind: "end", id });
          settled.ended();

          return;
        }

        if (read.value.byteLength === 0) continue;
        const bytes = wholeBuffer(read.value);
        unread += frameCost(bytes);
        post({ kind: "data", id, bytes });
      }
    } catch (cause) {
      if (!stopped) settled.failed(cause);
    }
  })();

  return {
    credit(bytes) {
      unread -= bytes;
      wake();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      wake();
      void reader.cancel().catch(() => undefined);
    },
  };
}

function wholeBuffer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

function readMessage(data: unknown): PortMessage | undefined {
  return Value.Check(PortMessageType, data) ? data : undefined;
}

function sendableCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}
