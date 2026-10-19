import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

/** The origin a desktop window's requests to its Nyte Host carry. Nothing listens on it: `portFetch` sends them over a MessagePort. */
export const HOST_PORT_ORIGIN = "http://127.0.0.1";

/** Bytes one side sends on an exchange's body beyond what the other side has read. */
const WINDOW = 1 << 20;

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
]);

/**
 * One frame of an exchange, the fetch the client numbered `id`. Bodies cross
 * as `data` then `end`; `credit` returns the bytes the other side has read,
 * and either side abandons the exchange with `reset`.
 */
export type PortMessage = Static<typeof PortMessageType>;

/** A MessagePort, whichever process holds it. `closed` runs once the other end is gone. */
export interface PortEnd {
  open(handlers: { readonly message: (data: unknown) => void; readonly closed: () => void }): void;
  post(message: PortMessage): void;
  close(): void;
}

type Post = (message: PortMessage) => void;

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

/**
 * A fetch over the port `connect` opens, kept until it closes; the next
 * request then opens another. A request fails with a TypeError, as a dropped
 * connection does, when the port closes under it or none can be opened.
 */
export function portFetch(
  connect: () => Promise<PortEnd>,
): (url: string, init?: RequestInit) => Promise<Response> {
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

  return async (url, init) => {
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
  };
}

/** Answers the port's requests with `fetch` until the port closes, which abandons every exchange still open. */
export function servePort(port: PortEnd, fetch: (request: Request) => Promise<Response>): void {
  const exchanges = new Map<number, { receive: (message: PortMessage) => void; abandon: () => void }>();
  const post: Post = (message) => port.post(message);

  const shut = (): void => {
    for (const exchange of exchanges.values()) exchange.abandon();
    exchanges.clear();
  };

  port.open({
    message(data) {
      const message = readMessage(data);

      if (message === undefined || message.kind === "response") {
        port.close();
        shut();

        return;
      }

      if (message.kind === "request") {
        answer(message);

        return;
      }

      exchanges.get(message.id)?.receive(message);
    },
    closed: shut,
  });

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
      let response: Response;

      try {
        response = await fetch(
          new Request(new URL(message.path, HOST_PORT_ORIGIN), {
            method: message.method,
            headers: message.headers,
            signal: controller.signal,
            ...(upload === undefined ? {} : { body: upload.stream, duplex: "half" as const }),
          }),
        );
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
}

function openClient(port: PortEnd, lost: () => void): Client {
  const exchanges = new Map<
    number,
    { receive: (message: PortMessage) => void; fail: (reason: unknown) => void }
  >();

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
  };

  port.open({
    message(data) {
      const message = readMessage(data);

      if (message === undefined || message.kind === "request") {
        port.close();
        shut();

        return;
      }

      exchanges.get(message.id)?.receive(message);
    },
    closed: shut,
  });

  return {
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

      const receive = (message: PortMessage): void => {
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

/** A body the other side sends, returning credit as this side reads it. */
function inbound(credit: (bytes: number) => void, cancelled: () => void): Inbound {
  const queue: Uint8Array[] = [];
  let state: { readonly kind: "open" | "ended" | "cancelled" } | { readonly kind: "failed"; readonly reason: unknown } = {
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
          unreturned += chunk.byteLength;

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

/** Sends `body` while the other side has read all but WINDOW bytes of it. */
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
        unread += bytes.byteLength;
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

/** Structured clone sends a view's whole ArrayBuffer, so a view into a larger one is copied out first. */
function wholeBuffer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

function readMessage(data: unknown): PortMessage | undefined {
  return Value.Check(PortMessageType, data) ? data : undefined;
}
