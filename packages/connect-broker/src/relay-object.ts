/**
 * The relay Durable Object: one per environment, named by its id. It holds
 * the environment itself (`environment-record.ts`, in the object's SQLite),
 * the desktop's hibernatable WebSocket, and a channel on it for each phone
 * request the Worker forwards (see `@nyte-ai/connect/relay`). The Worker asks
 * it about the environment by RPC (`environment-api.ts`).
 *
 * Hibernation-safe: a socket's state lives in its attachment (a session id
 * and an auth deadline, never a credential), and pings are answered by the
 * runtime's auto-response. One alarm serves the pending-auth deadlines and
 * the D1 writes the record still owes. Channels live only in memory, and only
 * while their exchange is in flight.
 *
 * Imported by the Worker entry alone; the broker and its Node tests never load
 * the Workers runtime module.
 */
import { DurableObject } from "cloudflare:workers";
import { RandomId, Uuid } from "@nyte-ai/connect";
import type { EnrollRequest, EnrollResponse, LeaseResponse } from "@nyte-ai/connect";
import {
  ChannelId,
  RELAY_AUTH_TIMEOUT_MS,
  RELAY_CHANNEL_LIMIT,
  RELAY_CLOSE,
  RELAY_PENDING_LIMIT,
  RELAY_PING,
  RELAY_PONG,
  RelayMethod,
  RelayPath,
  RelaySocketPath,
  decodeChunk,
  parseDesktopFrame,
  relayRefusal,
  relayRequestHeaders,
} from "@nyte-ai/connect/relay";
import type {
  DesktopFrame,
  RelayFrame,
  RelayRefusalCode,
  RelayRequestHeaders,
} from "@nyte-ai/connect/relay";
import { randomId } from "@nyte-ai/connect/signing";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { Env } from "./config.ts";
import { parseConfig } from "./config.ts";
import type {
  Actor,
  Answer,
  EnvironmentApi,
  OwnerStanding,
  Presence,
  Proven,
} from "./environment-api.ts";
import { RelayAdmission } from "./environment-api.ts";
import { EnvironmentRecord } from "./environment-record.ts";
import type { DesktopExchange, Effect, Outcome } from "./environment-record.ts";
import { consoleLogger } from "./log.ts";
import { RelayChannel } from "./relay-channel.ts";
import {
  RELAY_HEADERS,
  RELAY_INTERNAL_ORIGIN,
  RELAY_OPERATIONS,
  bearerToken,
} from "./relay-stub.ts";
import { SocketChannel } from "./socket-channel.ts";

const Attachment = Type.Union([
  Type.Object({ state: Type.Literal("pending"), session: RandomId, deadline: Type.Integer() }),
  /** `deadline` stays as the socket's arrival order: the latest proven socket wins. */
  Type.Object({ state: Type.Literal("ready"), session: RandomId, deadline: Type.Integer() }),
]);

type Attachment = Static<typeof Attachment>;

type CloseReason = keyof typeof RELAY_CLOSE;

interface Socket {
  readonly socket: WebSocket;
  readonly attachment: Attachment;
}

const OPEN = 1;

/** The standard close code for a server that cannot go on, such as a broken configuration. */
const INTERNAL_ERROR = 1011;

/** A close code this side may send: the peer's own when it is one, else a normal close. */
function sendableCode(code: number): number {
  return (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
    ? code
    : 1000;
}

function readAttachment(socket: WebSocket): Attachment | undefined {
  const value: unknown = socket.deserializeAttachment();

  return Value.Check(Attachment, value) ? value : undefined;
}

/** Send `frame` unless the socket is closing; its close handler ends what is left. */
function send(socket: WebSocket, frame: RelayFrame): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {}
}

/** Close `socket`, which either side may already have closed. */
function closeSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {}
}

export class EnvironmentRelay extends DurableObject<Env> implements EnvironmentApi {
  readonly #record: EnvironmentRecord | undefined;
  readonly #channels = new Map<string, RelayChannel | SocketChannel>();
  /** Sessions whose `auth` frame is being checked. */
  readonly #verifying = new Set<string>();
  /** Channels whose `forward` is being admitted; a reset meanwhile removes the id. */
  readonly #admitting = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RELAY_PING, RELAY_PONG));
    const config = parseConfig(env);
    const id = ctx.id.name;

    if ("invalid" in config)
      consoleLogger.error("config.invalid", { bindings: config.invalid.join(",") });
    this.#record =
      "invalid" in config || !Value.Check(Uuid, id)
        ? undefined
        : new EnvironmentRecord({
            id,
            storage: ctx.storage,
            directory: env.DB,
            config,
            log: consoleLogger,
            exchange: (request) => this.#exchange(request),
          });
  }

  async lease(proof: Proven): Promise<Answer<LeaseResponse>> {
    return this.#run((record) => record.lease(proof));
  }

  async enroll(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly body: EnrollRequest;
  }): Promise<Answer<EnrollResponse>> {
    return this.#run((record) => record.enroll(input));
  }

  async release(input: {
    readonly proof: Proven;
    readonly deviceId: string;
  }): Promise<Answer<null>> {
    return this.#run((record) => record.release(input));
  }

  async revokeDevice(input: {
    readonly actor: Actor;
    readonly deviceId: string;
  }): Promise<Answer<{ readonly sessionId: string }>> {
    return this.#run((record) => record.revokeDevice(input));
  }

  async revoke(actor: Actor): Promise<Answer<null>> {
    return this.#run((record) => record.revoke(actor));
  }

  async status(ownerId: string): Promise<Presence | null> {
    return this.#record?.status(ownerId, this.#ready() !== undefined) ?? null;
  }

  async setOwner(standing: OwnerStanding): Promise<void> {
    await this.#run((record) => record.setOwner(standing));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.origin !== RELAY_INTERNAL_ORIGIN) return relayRefusal("not_found");

    switch (url.pathname) {
      case RELAY_OPERATIONS.connect:
        return this.#connect();
      case RELAY_OPERATIONS.forward:
        return this.#forward(request);
      case RELAY_OPERATIONS.socket:
        return this.#socket(request);
      case RELAY_OPERATIONS.reset: {
        const id = request.headers.get(RELAY_HEADERS.channel);

        if (id !== null) {
          this.#admitting.delete(id);
          this.#resetChannels((channel) => channel.id === id);
        }

        return new Response(null, { status: 204 });
      }

      default:
        return relayRefusal("not_found");
    }
  }

  override async alarm(): Promise<void> {
    const now = Date.now();

    for (const { socket, attachment } of this.#sockets())
      if (attachment.state === "pending" && attachment.deadline <= now)
        this.#close(socket, "unauthorized");
    await this.#record?.drain();
    await this.#schedule();
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(socket);
    const frame = parseDesktopFrame(message);

    if (attachment === undefined || frame === undefined) {
      this.#close(socket, "invalid");

      return;
    }

    if (attachment.state === "pending") await this.#authenticate(socket, attachment, frame);
    else this.#receive(socket, attachment, frame);
  }

  /** Finish the closing handshake the desktop started, then end what the socket carried. */
  override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    closeSocket(socket, sendableCode(code), reason.slice(0, 120));
    this.#end(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    this.#end(socket);
  }

  /** Run one record operation, apply its socket effects, and keep the alarm on what the outbox owes. */
  async #run<T>(
    operation: (record: EnvironmentRecord) => Promise<Outcome<T>> | Outcome<T>,
  ): Promise<Answer<T>> {
    const record = this.#record;

    if (record === undefined) return { ok: false, code: "internal" };
    const outcome = await operation(record);

    for (const effect of outcome.effects) this.#apply(effect);
    await this.#schedule();

    return outcome.answer;
  }

  #apply(effect: Effect): void {
    switch (effect.kind) {
      case "end-device":
        this.#resetChannels((channel) => channel.deviceId === effect.deviceId);
        break;
      case "end-channels":
        this.#resetChannels(() => true);
        break;
      case "close":
        for (const { socket } of this.#sockets()) this.#close(socket, "revoked");
        break;
      default: {
        const _exhaustive: never = effect;

        return _exhaustive;
      }
    }
  }

  #resetChannels(matches: (channel: RelayChannel | SocketChannel) => boolean): void {
    for (const channel of this.#channels.values()) {
      if (!matches(channel)) continue;

      if (channel instanceof SocketChannel) channel.reset();
      else channel.reset("closed");
    }
  }

  /** Set the alarm to the earliest pending-auth deadline or outbox retry. */
  async #schedule(): Promise<void> {
    const deadlines = this.#sockets().flatMap(({ attachment }) =>
      attachment.state === "pending" ? [attachment.deadline] : [],
    );

    const due = this.#record?.nextDue();
    const next = Math.min(...deadlines, due ?? Number.POSITIVE_INFINITY);

    if (next === Number.POSITIVE_INFINITY) return;
    const current = await this.ctx.storage.getAlarm();

    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }

  #sockets(): Socket[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = readAttachment(socket);

      return attachment === undefined || socket.readyState !== OPEN ? [] : [{ socket, attachment }];
    });
  }

  #ready(): Socket | undefined {
    return this.#sockets().find(({ attachment }) => attachment.state === "ready");
  }

  async #connect(): Promise<Response> {
    const pending = this.#sockets()
      .flatMap(({ socket, attachment }) =>
        attachment.state === "pending" ? [{ socket, deadline: attachment.deadline }] : [],
      )
      .sort((left, right) => left.deadline - right.deadline);

    for (const oldest of pending.slice(0, Math.max(0, pending.length + 1 - RELAY_PENDING_LIMIT)))
      this.#close(oldest.socket, "unauthorized");
    const pair = new WebSocketPair();

    const attachment: Attachment = {
      state: "pending",
      session: randomId(),
      deadline: Date.now() + RELAY_AUTH_TIMEOUT_MS,
    };

    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(attachment);
    await this.#schedule();

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async #authenticate(
    socket: WebSocket,
    attachment: Extract<Attachment, { state: "pending" }>,
    frame: DesktopFrame,
  ): Promise<void> {
    if (this.#verifying.has(attachment.session)) {
      this.#close(socket, "invalid");

      return;
    }

    if (frame.t !== "auth" || Date.now() > attachment.deadline) {
      this.#close(socket, "unauthorized");

      return;
    }

    const record = this.#record;

    if (record === undefined) {
      socket.close(INTERNAL_ERROR, "internal");

      return;
    }

    this.#verifying.add(attachment.session);
    let outcome: Awaited<ReturnType<EnvironmentRecord["authenticate"]>>;

    try {
      outcome = await record.authenticate(frame.proof);
    } finally {
      this.#verifying.delete(attachment.session);
    }

    if (socket.readyState !== OPEN) return;

    if (outcome === "ready" && Date.now() > attachment.deadline) outcome = "unauthorized";

    if (outcome !== "ready") {
      this.#close(socket, outcome);

      return;
    }

    this.#attach(socket, attachment);
  }

  /**
   * Make this socket the environment's one authenticated socket. The socket
   * that arrived last wins, whichever proof finished verifying first.
   */
  #attach(socket: WebSocket, attachment: Extract<Attachment, { state: "pending" }>): void {
    const others = this.#sockets().filter(
      (other) => other.socket !== socket && other.attachment.state === "ready",
    );

    if (others.some((other) => other.attachment.deadline > attachment.deadline)) {
      this.#close(socket, "replaced");

      return;
    }

    for (const other of others) this.#close(other.socket, "replaced");
    const ready: Attachment = {
      state: "ready",
      session: attachment.session,
      deadline: attachment.deadline,
    };

    socket.serializeAttachment(ready);
    send(socket, { t: "ready" });
    consoleLogger.info("relay.attached", { environmentId: this.ctx.id.name ?? "" });
  }

  #receive(
    socket: WebSocket,
    attachment: Extract<Attachment, { state: "ready" }>,
    frame: DesktopFrame,
  ): void {
    if (frame.t === "auth") {
      this.#close(socket, "invalid");

      return;
    }

    if (frame.t === "ping") {
      send(socket, { t: "pong" });

      return;
    }

    const found = this.#channels.get(frame.ch);

    if (found === undefined || found.session !== attachment.session) return;

    if (found instanceof SocketChannel) {
      if (!this.#socketFrame(found, frame)) this.#close(socket, "invalid");

      return;
    }

    const channel = found;
    let kept: boolean;

    switch (frame.t) {
      case "head":
        kept = channel.onHead(frame);
        break;
      case "data": {
        const bytes = decodeChunk(frame.data);

        kept = bytes !== undefined && channel.onData(bytes);
        break;
      }

      case "end":
        kept = channel.onEnd();
        break;
      case "credit":
        kept = channel.onCredit(frame.bytes);
        break;
      case "reset":
        channel.onReset();
        kept = true;
        break;
      case "message":
      case "close":
        kept = false;
        break;
      default: {
        const _exhaustive: never = frame;
        kept = _exhaustive;
      }
    }

    if (!kept) this.#close(socket, "invalid");
  }

  /** A phone's HTTP exchange: admit its bearer here, then open a channel on the desktop's socket. */
  async #forward(request: Request): Promise<Response> {
    const path = request.headers.get(RELAY_HEADERS.path);
    const id = request.headers.get(RELAY_HEADERS.channel);
    const admission = request.headers.get(RELAY_HEADERS.admission);
    const method = request.method;
    const record = this.#record;

    if (
      !Value.Check(RelayPath, path) ||
      !Value.Check(RelayMethod, method) ||
      !Value.Check(ChannelId, id) ||
      !Value.Check(RelayAdmission, admission)
    )
      return relayRefusal("not_found");

    if (record === undefined) return relayRefusal("internal");
    this.#admitting.add(id);

    const admitted = await record.admit({
      bearer: bearerToken(request.headers),
      admission,
    });

    if (!this.#admitting.delete(id) || request.signal.aborted) return relayRefusal("closed");

    if (!admitted.ok) return relayRefusal(admitted.code);

    const opened = this.#open({
      id,
      method,
      path,
      headers: relayRequestHeaders(request.headers),
      body: request.body,
      deviceId: admitted.deviceId,
    });

    if (typeof opened === "string") return relayRefusal(opened);
    request.signal.addEventListener("abort", () => opened.cancel(), { once: true });

    return opened.response;
  }

  /** The record's way to the desktop: one exchange on a channel only the broker opens. */
  #exchange: DesktopExchange = async (request) => {
    const opened = this.#open({
      id: randomId(),
      method: "POST",
      path: request.path,
      headers: relayRequestHeaders(
        new Headers({ "content-type": "application/json", accept: "application/json" }),
      ),
      body: new Response(request.body).body,
      deviceId: undefined,
    });

    if (typeof opened === "string") throw new Error("The desktop is not connected");

    if (request.signal.aborted) opened.reset("closed");
    else request.signal.addEventListener("abort", () => opened.reset("closed"), { once: true });

    return opened.response;
  };

  /** Open a channel on the desktop's socket, or say why none opens. */
  #open(input: {
    readonly id: string;
    readonly method: RelayMethod;
    readonly path: string;
    readonly headers: RelayRequestHeaders;
    readonly body: ReadableStream<Uint8Array> | null;
    readonly deviceId: string | undefined;
  }): RelayChannel | RelayRefusalCode {
    const desktop = this.#ready();

    if (desktop === undefined || this.#channels.has(input.id)) return "closed";
    const session = desktop.attachment.session;
    let open = 0;

    for (const channel of this.#channels.values()) if (channel.session === session) open += 1;

    if (open >= RELAY_CHANNEL_LIMIT) return "closed";

    const channel = new RelayChannel({
      id: input.id,
      session,
      deviceId: input.deviceId,
      send: (frame) => send(desktop.socket, frame),
      onDone: () => this.#channels.delete(input.id),
    });

    this.#channels.set(input.id, channel);
    channel.start({
      method: input.method,
      path: input.path,
      headers: input.headers,
      body: input.body,
    });

    return channel;
  }

  #socketFrame(
    channel: SocketChannel,
    frame: Exclude<DesktopFrame, { t: "auth" | "ping" }>,
  ): boolean {
    switch (frame.t) {
      case "message":
        return channel.onMessage(frame);
      case "close":
        return channel.onClose(frame);
      case "credit":
        return channel.onCredit(frame.bytes);
      case "reset":
        channel.onReset();

        return true;
      case "head":
      case "data":
      case "end":
        return false;
      default: {
        const _exhaustive: never = frame;

        return _exhaustive;
      }
    }
  }

  #socket(request: Request): Response {
    const path = request.headers.get(RELAY_HEADERS.path);
    const id = request.headers.get(RELAY_HEADERS.channel);

    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
      !Value.Check(RelaySocketPath, path) ||
      !Value.Check(ChannelId, id)
    )
      return relayRefusal("not_found");
    const desktop = this.#ready();

    if (desktop === undefined || this.#channels.has(id)) return relayRefusal("closed");
    const session = desktop.attachment.session;
    let open = 0;

    for (const channel of this.#channels.values()) if (channel.session === session) open += 1;

    if (open >= RELAY_CHANNEL_LIMIT) return relayRefusal("closed");
    const pair = new WebSocketPair();
    pair[1].accept();

    const channel = new SocketChannel({
      id,
      session,
      phone: pair[1],
      send: (frame) => send(desktop.socket, frame),
      onDone: () => this.#channels.delete(id),
    });

    this.#channels.set(id, channel);
    channel.start(path);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Close a socket with a contract code and end everything it carried. */
  #close(socket: WebSocket, reason: CloseReason): void {
    closeSocket(socket, RELAY_CLOSE[reason], reason);
    this.#end(socket);
  }

  /** End a socket's channels. */
  #end(socket: WebSocket): void {
    const attachment = readAttachment(socket);

    if (attachment === undefined) return;

    for (const channel of this.#channels.values()) {
      if (channel.session !== attachment.session) continue;

      if (channel instanceof SocketChannel) channel.fail();
      else channel.fail("closed");
    }
  }
}
