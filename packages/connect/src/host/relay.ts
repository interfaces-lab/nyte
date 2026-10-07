/**
 * This Mac's WebSocket to the broker's relay, and the relayed HTTP exchanges
 * it carries to the account listener on `127.0.0.1`.
 *
 * Every relayed request goes to the one loopback port the host bound, with
 * the host `node:http` writes for it and only the method, path, and headers
 * the contract's schemas let through, so a frame can name nothing else on
 * this Mac. Redirects are never followed, and only success and failure
 * statuses travel back. Bodies move under per-channel credit: request bytes
 * are acknowledged only once the local socket took them, and response bytes
 * are read from the local server only as the relay grants room. Anything
 * that breaks the framing closes the socket; every close, replacement, or
 * `dropStreams` ends every relayed exchange.
 */
import { request } from "node:http";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  RELAY_AUTH_TIMEOUT_MS,
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHANNEL_LIMIT,
  RELAY_CLOSE,
  RELAY_PING,
  RELAY_PING_INTERVAL_MS,
  RELAY_RETRY_MAX_MS,
  RELAY_RETRY_MIN_MS,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeChunks,
  hasNullBody,
  parseRelayFrame,
  relayResponseHeaders,
} from "../relay.ts";
import type { DesktopFrame, RelayFrame, RelayMethod } from "../relay.ts";
import type { ConnectRelay } from "../view.ts";

export interface RelayTiming {
  /** Ping interval; a ping still unanswered at the next one closes the socket. */
  readonly pingMs: number;
  /** Longest wait for `ready` after dialing. */
  readonly readyMs: number;
  readonly retryMinMs: number;
  readonly retryMaxMs: number;
}

const DEFAULT_TIMING: RelayTiming = {
  pingMs: RELAY_PING_INTERVAL_MS,
  readyMs: RELAY_AUTH_TIMEOUT_MS * 2,
  retryMinMs: RELAY_RETRY_MIN_MS,
  retryMaxMs: RELAY_RETRY_MAX_MS,
};

/** Opens the socket. Production uses the global `WebSocket`; tests point it at a local relay. */
export type RelayDial = (url: string) => WebSocket;

export interface RelayConnectionOptions {
  /** `wss://<origin>/v1/environments/<id>/relay`. */
  readonly url: string;
  /** The account listener's loopback port. */
  readonly port: number;
  /** A fresh `auth` proof for each dial. */
  readonly proof: () => Promise<string>;
  readonly dial?: RelayDial;
  readonly onChange: () => void;
  /** The relay closed with `revoked`; only a lease answer may forget the link. */
  readonly onRevoked: () => void;
  readonly timing?: Partial<RelayTiming>;
}

/** One relayed HTTP exchange. */
interface Channel {
  readonly id: string;
  readonly method: RelayMethod;
  readonly local: ClientRequest;
  /** Request bytes taken in and not yet returned as credit. */
  unreturned: number;
  received: number;
  requestEnded: boolean;
  /** Response bytes the relay still has room for. */
  credit: number;
  response: IncomingMessage | undefined;
  /** Read from the local response, waiting for credit. */
  pending: Buffer;
  responseEnded: boolean;
}

function isRelayStatus(status: number): boolean {
  return (status >= 200 && status <= 299) || (status >= 400 && status <= 599);
}

function headersOf(response: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(response.headers))
    if (value !== undefined && !Array.isArray(value)) headers.set(name, value);

  return headers;
}

export class RelayConnection {
  private readonly options: RelayConnectionOptions;
  private readonly timing: RelayTiming;
  private readonly dial: RelayDial;
  private socket: WebSocket | undefined;
  private ready = false;
  private current: ConnectRelay = { kind: "stopped" };
  private attempt = 0;
  private readyAt: number | undefined;
  /** Advanced by every dial, reconnect, and close; a dial from an older one opens nothing. */
  private dialing = 0;
  private awaitingPong = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private readonly channels = new Map<string, Channel>();

  constructor(options: RelayConnectionOptions) {
    this.options = options;
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.dial = options.dial ?? ((url) => new WebSocket(url));
  }

  start(): void {
    if (this.stopped || this.current.kind !== "stopped") return;
    this.setStatus({ kind: "connecting" });
    void this.connect();
  }

  status(): ConnectRelay {
    return this.current;
  }

  /** End every relayed exchange; the socket stays. */
  dropStreams(): void {
    for (const channel of this.channels.values()) this.reset(channel);
  }

  /** After sleep the socket is likely dead: dial again now. A replaced relay stays stopped. */
  reconnect(): void {
    if (this.stopped || this.current.kind === "failed") return;
    this.detach(1000);
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.setStatus({ kind: "connecting" });
    void this.connect();
  }

  /** Close the socket and every exchange for good. */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.detach(1000);
    this.setStatus({ kind: "stopped" });
  }

  // -------------------------------------------------------------------------
  // The socket
  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    const dialing = ++this.dialing;
    let proof: string;
    let socket: WebSocket;

    try {
      proof = await this.options.proof();

      if (this.stopped || dialing !== this.dialing) return;
      socket = this.dial(this.options.url);
    } catch {
      if (dialing === this.dialing) this.retry();

      return;
    }

    this.socket = socket;
    this.ready = false;
    this.awaitingPong = false;
    socket.addEventListener("open", () => {
      if (this.socket === socket) this.send({ t: "auth", proof });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.receive(socket, parseRelayFrame(event.data));
    });
    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.closedByRelay(event.code);
    });
    this.readyTimer = setTimeout(() => this.drop(socket, 1000), this.timing.readyMs);
  }

  /** Let go of the current socket and every exchange on it. */
  private detach(code: number): WebSocket | undefined {
    this.dialing += 1;
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    clearTimeout(this.readyTimer);
    clearInterval(this.pingTimer);

    for (const channel of this.channels.values()) channel.local.destroy();
    this.channels.clear();
    socket?.close(code);

    return socket;
  }

  /** This side closes the socket, then backs off. */
  private drop(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.detach(code);
    this.retry();
  }

  private closedByRelay(code: number): void {
    this.detach(1000);

    if (code === RELAY_CLOSE.replaced) {
      this.setStatus({ kind: "failed", reason: "replaced" });

      return;
    }

    if (code === RELAY_CLOSE.revoked) this.options.onRevoked();
    this.retry();
  }

  private retry(): void {
    if (this.stopped || this.current.kind === "failed") return;

    // A socket that stayed up through a ping round trip starts the backoff over.
    if (this.readyAt !== undefined && Date.now() - this.readyAt >= this.timing.pingMs)
      this.attempt = 0;
    this.readyAt = undefined;
    this.attempt += 1;

    const ceiling = Math.min(
      this.timing.retryMaxMs,
      this.timing.retryMinMs * 2 ** Math.min(this.attempt - 1, 16),
    );

    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(
      () => void this.connect(),
      Math.max(this.timing.retryMinMs, Math.random() * ceiling),
    );
    this.setStatus({ kind: "retrying", attempt: this.attempt });
  }

  private setStatus(next: ConnectRelay): void {
    const previous = this.current;
    this.current = next;

    if (
      previous.kind !== next.kind ||
      (previous.kind === "retrying" &&
        next.kind === "retrying" &&
        previous.attempt !== next.attempt)
    )
      this.options.onChange();
  }

  private send(frame: DesktopFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private receive(socket: WebSocket, frame: RelayFrame | undefined): void {
    if (frame === undefined) {
      this.drop(socket, RELAY_CLOSE.invalid);

      return;
    }

    if (!this.ready) {
      if (frame.t !== "ready") {
        this.drop(socket, RELAY_CLOSE.invalid);

        return;
      }

      this.ready = true;
      clearTimeout(this.readyTimer);
      this.readyAt = Date.now();
      this.pingTimer = setInterval(() => this.ping(socket), this.timing.pingMs);
      this.setStatus({ kind: "connected" });

      return;
    }

    if (frame.t === "ready") {
      this.drop(socket, RELAY_CLOSE.invalid);

      return;
    }

    if (frame.t === "pong") {
      this.awaitingPong = false;

      return;
    }

    if (frame.t === "open") {
      if (this.channels.has(frame.ch) || this.channels.size >= RELAY_CHANNEL_LIMIT)
        this.drop(socket, RELAY_CLOSE.invalid);
      else this.open(frame);

      return;
    }

    const channel = this.channels.get(frame.ch);

    // Resets race; frames for an exchange already over are expected.
    if (channel === undefined) return;

    if (!this.channelFrame(channel, frame)) this.drop(socket, RELAY_CLOSE.invalid);
  }

  private ping(socket: WebSocket): void {
    if (this.socket !== socket) return;

    if (this.awaitingPong) {
      this.drop(socket, 1000);

      return;
    }

    this.awaitingPong = true;
    socket.send(RELAY_PING);
  }

  // -------------------------------------------------------------------------
  // Exchanges
  // -------------------------------------------------------------------------

  private open(frame: Extract<RelayFrame, { t: "open" }>): void {
    const local = request({
      host: "127.0.0.1",
      port: this.options.port,
      method: frame.method,
      path: frame.path,
      headers: frame.headers,
      agent: false,
    });

    const channel: Channel = {
      id: frame.ch,
      method: frame.method,
      local,
      unreturned: 0,
      received: 0,
      requestEnded: false,
      credit: RELAY_WINDOW_BYTES,
      response: undefined,
      pending: Buffer.alloc(0),
      responseEnded: false,
    };

    this.channels.set(channel.id, channel);
    local.on("error", () => this.reset(channel));
    local.on("response", (response) => this.respond(channel, response));
  }

  /** False when the frame breaks the channel's order or flow control. */
  private channelFrame(
    channel: Channel,
    frame: Extract<RelayFrame, { t: "data" | "end" | "credit" | "reset" }>,
  ): boolean {
    switch (frame.t) {
      case "data": {
        const bytes = decodeChunk(frame.data);

        if (
          channel.requestEnded ||
          bytes === undefined ||
          channel.unreturned + bytes.byteLength > RELAY_WINDOW_BYTES
        )
          return false;
        channel.unreturned += bytes.byteLength;
        channel.received += bytes.byteLength;

        if (channel.method !== "POST" || channel.received > RELAY_BODY_LIMIT_BYTES) {
          this.reset(channel);

          return true;
        }

        channel.local.write(bytes, () => {
          if (this.channels.get(channel.id) !== channel) return;
          channel.unreturned -= bytes.byteLength;
          this.send({ t: "credit", ch: channel.id, bytes: bytes.byteLength });
        });

        return true;
      }

      case "end":
        if (channel.requestEnded) return false;
        channel.requestEnded = true;
        channel.local.end();

        return true;
      case "credit":
        if (channel.credit + frame.bytes > RELAY_WINDOW_BYTES) return false;
        channel.credit += frame.bytes;
        this.pump(channel);

        return true;
      case "reset":
        this.finish(channel);

        return true;
      default: {
        const _exhaustive: never = frame;

        return _exhaustive;
      }
    }
  }

  private respond(channel: Channel, response: IncomingMessage): void {
    const status = response.statusCode ?? 0;

    if (this.channels.get(channel.id) !== channel || !isRelayStatus(status)) {
      this.reset(channel);

      return;
    }

    channel.response = response;
    response.on("error", () => this.reset(channel));
    response.on("close", () => {
      if (!response.complete) this.reset(channel);
    });
    this.send({
      t: "head",
      ch: channel.id,
      status,
      headers: relayResponseHeaders(headersOf(response)),
    });

    if (hasNullBody(status)) {
      this.send({ t: "end", ch: channel.id });
      this.finish(channel);

      return;
    }

    response.on("data", (chunk: Buffer) => {
      channel.pending =
        channel.pending.byteLength === 0 ? chunk : Buffer.concat([channel.pending, chunk]);
      this.pump(channel);
    });
    response.on("end", () => {
      channel.responseEnded = true;
      this.pump(channel);
    });
  }

  /** Send what the credit allows; read more from the local server only once all of it went. */
  private pump(channel: Channel): void {
    if (this.channels.get(channel.id) !== channel) return;
    const size = Math.min(channel.credit, channel.pending.byteLength);

    if (size > 0) {
      const bytes = channel.pending.subarray(0, size);
      channel.pending = channel.pending.subarray(size);
      channel.credit -= size;

      for (const data of encodeChunks(bytes)) this.send({ t: "data", ch: channel.id, data });
    }

    if (channel.pending.byteLength > 0) {
      channel.response?.pause();

      return;
    }

    if (!channel.responseEnded) {
      channel.response?.resume();

      return;
    }

    this.send({ t: "end", ch: channel.id });
    this.finish(channel);
  }

  /** End the exchange here and tell the relay. */
  private reset(channel: Channel): void {
    if (this.channels.get(channel.id) !== channel) return;
    this.finish(channel);
    this.send({ t: "reset", ch: channel.id });
  }

  private finish(channel: Channel): void {
    if (this.channels.get(channel.id) !== channel) return;
    this.channels.delete(channel.id);
    channel.local.destroy();
  }
}
