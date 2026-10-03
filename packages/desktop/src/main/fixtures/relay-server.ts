/**
 * A stand-in for the broker's relay over a real `ws` server on loopback. It
 * checks a desktop's first frame through `authenticate`, opens channels the
 * way the Worker does, and holds everything the desktop sends to the
 * framing and credit rules: a frame that breaks them is recorded and closes
 * the socket with `invalid`. Response bodies are granted credit only as the
 * caller reads them. The desktop under test dials it with the global
 * `WebSocket` through `dial`.
 */
import assert from "node:assert/strict";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket as ServerSocket } from "ws";
import {
  PUBLIC_RELAY_METHODS,
  RELAY_CHUNK_BYTES,
  RELAY_CLOSE,
  RELAY_PONG,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeChunks,
  hasNullBody,
  parseDesktopFrame,
  publicRelayTarget,
  relayRefusal,
  relayRequestHeaders,
} from "@nyte-ai/connect/relay";
import type {
  DesktopFrame,
  RelayFrame,
  RelayMethod,
  RelayRequestHeaders,
} from "@nyte-ai/connect/relay";
import { randomId } from "@nyte-ai/connect/signing";

const RELAY_PATH = /^\/v1\/environments\/([0-9a-f-]{36})\/relay$/u;

const METHODS = ["GET", "POST", "DELETE"] as const;

interface Exchange {
  readonly ch: string;
  readonly head: PromiseWithResolvers<Response>;
  readonly queue: Uint8Array[];
  readonly waiters: Set<() => void>;
  /** Request bytes the desktop still has room for. */
  credit: number;
  /** Response bytes received and not yet read. */
  unreturned: number;
  status: number | undefined;
  ended: boolean;
  reset: boolean;
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");

  return Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data).toString("utf8");
}

function wake(exchange: Exchange): void {
  for (const resolve of exchange.waiters) resolve();
  exchange.waiters.clear();
}

function waitOn(exchange: Exchange): Promise<void> {
  return new Promise((resolve) => exchange.waiters.add(resolve));
}

export interface RelayServerOptions {
  /** The broker origin the desktop was built with. */
  readonly origin: string;
  /** Undefined accepts the socket; a number closes it with that code. */
  readonly authenticate: (input: {
    readonly environmentId: string;
    readonly proof: string;
  }) => Promise<number | undefined>;
}

export class RelayServer {
  /** Close codes of every desktop socket, as the server saw them. */
  readonly closes: number[] = [];
  /** Frames from the desktop that broke the contract. */
  readonly violations: string[] = [];
  /** Auth frames answered, accepted or not. */
  auths = 0;
  /** Exchanges the desktop reset. */
  resets = 0;
  /** Response body bytes the desktop sent. */
  received = 0;
  /** Request body bytes sent to the desktop. */
  uploaded = 0;
  /** Stop answering pings, as a dead relay would. */
  muted = false;
  private readonly server: WebSocketServer;
  private readonly options: RelayServerOptions;
  private socket: ServerSocket | undefined;
  private environmentId: string | undefined;
  private readonly exchanges = new Map<string, Exchange>();

  private constructor(server: WebSocketServer, options: RelayServerOptions) {
    this.server = server;
    this.options = options;
    server.on("connection", (socket, request) => this.accept(socket, request.url ?? ""));
  }

  static async start(options: RelayServerOptions): Promise<RelayServer> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));

    return new RelayServer(server, options);
  }

  /** The environment whose desktop holds the relay now. */
  connected(): string | undefined {
    return this.environmentId;
  }

  readonly dial = (url: string): WebSocket => {
    const target = new URL(url);
    assert.equal(target.protocol, "wss:");
    assert.equal(`https://${target.host}`, this.options.origin);
    const address = this.server.address();
    assert.ok(Value.Check(Type.Object({ port: Type.Number() }), address));

    return new WebSocket(`ws://127.0.0.1:${String(address.port)}${target.pathname}`);
  };

  /** A phone request to `<origin>/r/<id>/...`, forwarded the way the Worker forwards one. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const target = publicRelayTarget(url);
    const method = METHODS.find((entry) => entry === request.method);

    if (url.origin !== this.options.origin || target === undefined)
      return relayRefusal("not_found");

    if (request.headers.has("origin")) return relayRefusal("forbidden");

    if (
      method === undefined ||
      !PUBLIC_RELAY_METHODS[target.kind].some((allowed) => allowed === method)
    )
      return relayRefusal("method_not_allowed");

    if (target.environmentId !== this.environmentId) return relayRefusal("closed");

    return this.exchange({
      method,
      path: target.path,
      headers: relayRequestHeaders(request.headers),
      body: new Uint8Array(await request.arrayBuffer()),
      signal: request.signal,
    });
  };

  /**
   * One relayed exchange, as the broker opens one itself. A reset before the
   * head answers 503 as the Worker does; one after it errors the body.
   */
  exchange(input: {
    /** A channel id to use instead of a fresh one. */
    readonly ch?: string;
    readonly method: RelayMethod;
    readonly path: string;
    readonly headers?: RelayRequestHeaders;
    readonly body?: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<Response> {
    if (this.socket === undefined) return Promise.resolve(relayRefusal("closed"));

    const exchange: Exchange = {
      ch: input.ch ?? randomId(),
      head: Promise.withResolvers(),
      queue: [],
      waiters: new Set(),
      credit: RELAY_WINDOW_BYTES,
      unreturned: 0,
      status: undefined,
      ended: false,
      reset: false,
    };

    this.exchanges.set(exchange.ch, exchange);
    input.signal?.addEventListener(
      "abort",
      () => {
        if (this.exchanges.get(exchange.ch) !== exchange) return;
        this.frame({ t: "reset", ch: exchange.ch });
        this.end(exchange);
      },
      { once: true },
    );
    this.frame({
      t: "open",
      ch: exchange.ch,
      method: input.method,
      path: input.path,
      headers: input.headers ?? {},
    });
    void this.upload(exchange, input.body ?? new Uint8Array());

    return exchange.head.promise;
  }

  /** Anything on the desktop's socket; a `Buffer` goes as a binary message. */
  send(data: string | Buffer): void {
    this.socket?.send(data);
  }

  /** Close the desktop's socket with a relay close code. */
  close(code: number): void {
    this.socket?.close(code);
  }

  async stop(): Promise<void> {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: ServerSocket, path: string): void {
    const environmentId = RELAY_PATH.exec(path)?.[1];
    let state: "pending" | "verifying" | "ready" = "pending";

    socket.on("message", (data, isBinary) => {
      const frame = isBinary ? undefined : parseDesktopFrame(textOf(data));

      if (frame === undefined) {
        this.violation(socket, isBinary ? "binary" : textOf(data).slice(0, 200));

        return;
      }

      if (state === "pending" && frame.t === "auth" && environmentId !== undefined) {
        state = "verifying";
        void this.options.authenticate({ environmentId, proof: frame.proof }).then((code) => {
          this.auths += 1;

          // The desktop gave up on this socket while it was being checked.
          if (socket.readyState !== socket.OPEN) return;

          if (code !== undefined) {
            socket.close(code);

            return;
          }

          const previous = this.socket;
          state = "ready";
          this.socket = socket;
          this.environmentId = environmentId;

          if (previous !== undefined) {
            this.dropExchanges();
            previous.close(RELAY_CLOSE.replaced);
          }

          socket.send(JSON.stringify({ t: "ready" } satisfies RelayFrame));
        });

        return;
      }

      if (state !== "ready" || frame.t === "auth") {
        this.violation(socket, `${frame.t} before ready or twice`);

        return;
      }

      if (frame.t === "ping") {
        if (!this.muted) socket.send(RELAY_PONG);

        return;
      }

      const problem = this.desktopFrame(frame);

      if (problem !== undefined) this.violation(socket, problem);
    });
    socket.on("close", (code) => {
      this.closes.push(code);

      if (this.socket !== socket) return;
      this.socket = undefined;
      this.environmentId = undefined;
      this.dropExchanges();
    });
  }

  /** Undefined when the frame keeps the contract; otherwise what it broke. */
  private desktopFrame(
    frame: Exclude<DesktopFrame, { t: "auth" } | { t: "ping" }>,
  ): string | undefined {
    const exchange = this.exchanges.get(frame.ch);

    if (exchange === undefined) return undefined;

    switch (frame.t) {
      case "head":
        if (exchange.status !== undefined) return "a second head";
        exchange.status = frame.status;
        exchange.head.resolve(this.response(exchange, frame));

        return undefined;
      case "data": {
        const bytes = decodeChunk(frame.data);

        if (exchange.status === undefined || exchange.ended || bytes === undefined)
          return "data out of order";

        if (hasNullBody(exchange.status)) return "data for a bodyless status";

        if (exchange.unreturned + bytes.byteLength > RELAY_WINDOW_BYTES) return "data past credit";
        exchange.unreturned += bytes.byteLength;
        this.received += bytes.byteLength;
        exchange.queue.push(bytes);
        wake(exchange);

        return undefined;
      }

      case "end":
        if (exchange.status === undefined || exchange.ended) return "end out of order";
        exchange.ended = true;
        wake(exchange);

        if (hasNullBody(exchange.status)) this.exchanges.delete(exchange.ch);

        return undefined;
      case "credit":
        if (exchange.credit + frame.bytes > RELAY_WINDOW_BYTES) return "credit past the window";
        exchange.credit += frame.bytes;
        wake(exchange);

        return undefined;
      case "reset":
        this.resets += 1;
        this.end(exchange);

        return undefined;
      default: {
        const _exhaustive: never = frame;

        return _exhaustive;
      }
    }
  }

  private response(exchange: Exchange, head: Extract<DesktopFrame, { t: "head" }>): Response {
    const headers = new Headers();

    for (const [name, value] of Object.entries(head.headers))
      if (value !== undefined) headers.set(name, value);

    if (hasNullBody(head.status)) return new Response(null, { status: head.status, headers });

    const body = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          for (;;) {
            const chunk = exchange.queue.shift();

            if (chunk !== undefined) {
              controller.enqueue(chunk);
              exchange.unreturned -= chunk.byteLength;

              if (!exchange.ended)
                this.frame({ t: "credit", ch: exchange.ch, bytes: chunk.byteLength });

              return;
            }

            if (exchange.reset) {
              controller.error(new TypeError("The desktop reset the exchange"));

              return;
            }

            if (exchange.ended) {
              this.exchanges.delete(exchange.ch);
              controller.close();

              return;
            }

            await waitOn(exchange);
          }
        },
        cancel: () => {
          if (this.exchanges.get(exchange.ch) !== exchange) return;
          this.frame({ t: "reset", ch: exchange.ch });
          this.end(exchange);
        },
      },
      { highWaterMark: 0 },
    );

    return new Response(body, { status: head.status, headers });
  }

  private async upload(exchange: Exchange, body: Uint8Array): Promise<void> {
    for (let offset = 0; offset < body.byteLength; offset += RELAY_CHUNK_BYTES) {
      const slice = body.subarray(offset, offset + RELAY_CHUNK_BYTES);

      while (exchange.credit < slice.byteLength) {
        if (this.exchanges.get(exchange.ch) !== exchange) return;
        await waitOn(exchange);
      }

      if (this.exchanges.get(exchange.ch) !== exchange) return;
      exchange.credit -= slice.byteLength;
      this.uploaded += slice.byteLength;

      for (const data of encodeChunks(slice)) this.frame({ t: "data", ch: exchange.ch, data });
    }

    if (this.exchanges.get(exchange.ch) === exchange) this.frame({ t: "end", ch: exchange.ch });
  }

  /** The exchange is over here: a pending head answers 503, a body errors. */
  private end(exchange: Exchange): void {
    this.exchanges.delete(exchange.ch);
    exchange.reset = true;
    exchange.head.resolve(relayRefusal("closed"));
    wake(exchange);
  }

  private dropExchanges(): void {
    for (const exchange of this.exchanges.values()) this.end(exchange);
  }

  private frame(frame: RelayFrame): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private violation(socket: ServerSocket, problem: string): void {
    this.violations.push(problem);
    socket.close(RELAY_CLOSE.invalid);
  }
}
