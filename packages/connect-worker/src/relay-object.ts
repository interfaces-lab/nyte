/**
 * The relay Durable Object: one per environment, named by its id. It holds
 * the desktop's hibernatable WebSocket and turns each phone request the
 * Worker forwards into a channel on it (see `@nyte-ai/connect/relay`).
 *
 * Hibernation-safe: a socket's state lives in its attachment (ids, a session
 * id, and an auth deadline, never a credential), the auth deadline is an
 * alarm, and pings are answered by the runtime's auto-response. Channels live
 * only in memory, and only while their phone request is in flight.
 *
 * Imported by the Worker entry alone; the broker and its Node tests never load
 * the Workers runtime module.
 */
import { DurableObject } from "cloudflare:workers";
import { RandomId, Uuid } from "@nyte-ai/connect";
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
  decodeChunk,
  parseDesktopFrame,
  relayRefusal,
  relayRequestHeaders,
} from "@nyte-ai/connect/relay";
import type { DesktopFrame, RelayFrame } from "@nyte-ai/connect/relay";
import { randomId } from "@nyte-ai/connect/signing";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { ownerStanding } from "./clerk.ts";
import type { Env } from "./config.ts";
import { createContext } from "./context.ts";
import type { Context } from "./context.ts";
import { Refusal } from "./http.ts";
import { consoleLogger, errorName } from "./log.ts";
import { verifyRelayProof } from "./proof.ts";
import { RelayChannel } from "./relay-channel.ts";
import { RELAY_HEADERS, RELAY_INTERNAL_ORIGIN, RELAY_OPERATIONS } from "./relay-stub.ts";
import { attachRelay, detachRelay } from "./store.ts";

const Attachment = Type.Union([
  Type.Object({
    state: Type.Literal("pending"),
    environmentId: Uuid,
    session: RandomId,
    deadline: Type.Integer(),
  }),
  Type.Object({ state: Type.Literal("ready"), environmentId: Uuid, session: RandomId }),
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

function attachmentOf(socket: WebSocket): Attachment | undefined {
  const value: unknown = socket.deserializeAttachment();

  return Value.Check(Attachment, value) ? value : undefined;
}

function send(socket: WebSocket, frame: RelayFrame): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // The socket is closing; its close handler ends what is left.
  }
}

export class EnvironmentRelay extends DurableObject<Env> {
  readonly #channels = new Map<string, RelayChannel>();
  /** Sessions whose `auth` frame is being checked. */
  readonly #verifying = new Set<string>();
  /** Orders socket takeovers and their D1 writes, so the latest proof always wins. */
  #attaching: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RELAY_PING, RELAY_PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const environmentId = request.headers.get(RELAY_HEADERS.environment);

    if (url.origin !== RELAY_INTERNAL_ORIGIN || !Value.Check(Uuid, environmentId))
      return relayRefusal("not_found");

    switch (url.pathname) {
      case RELAY_OPERATIONS.connect:
        return this.#connect(environmentId);
      case RELAY_OPERATIONS.forward:
        return this.#forward(request);
      case RELAY_OPERATIONS.reset: {
        const deviceId = request.headers.get(RELAY_HEADERS.device);
        const id = request.headers.get(RELAY_HEADERS.channel);

        for (const channel of this.#channels.values())
          if (
            (deviceId === null || channel.deviceId === deviceId) &&
            (id === null || channel.id === id)
          )
            channel.reset("closed");

        return new Response(null, { status: 204 });
      }
      case RELAY_OPERATIONS.revoke:
        for (const { socket } of this.#sockets()) this.#close(socket, "revoked");

        return new Response(null, { status: 204 });
      default:
        return relayRefusal("not_found");
    }
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    let next: number | undefined;

    for (const { socket, attachment } of this.#sockets()) {
      if (attachment.state !== "pending") continue;

      if (attachment.deadline <= now) this.#close(socket, "unauthorized");
      else next = Math.min(next ?? attachment.deadline, attachment.deadline);
    }

    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(socket);
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
    try {
      socket.close(sendableCode(code), reason.slice(0, 120));
    } catch {
      // This side already closed it.
    }

    this.#end(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    this.#end(socket);
  }

  #sockets(): Socket[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = attachmentOf(socket);

      return attachment === undefined || socket.readyState !== OPEN ? [] : [{ socket, attachment }];
    });
  }

  #context(): Context | undefined {
    return createContext({
      env: this.env,
      dependencies: {
        fetch: () => Promise.reject(new Error("The relay makes no outbound requests")),
        now: () => Date.now(),
        log: consoleLogger,
      },
      waitUntil: (task) => this.ctx.waitUntil(task),
    });
  }

  async #connect(environmentId: string): Promise<Response> {
    const pending = this.#sockets()
      .flatMap(({ socket, attachment }) =>
        attachment.state === "pending" ? [{ socket, deadline: attachment.deadline }] : [],
      )
      .sort((left, right) => left.deadline - right.deadline);

    for (const oldest of pending.slice(0, Math.max(0, pending.length + 1 - RELAY_PENDING_LIMIT)))
      this.#close(oldest.socket, "unauthorized");
    const pair = new WebSocketPair();
    const deadline = Date.now() + RELAY_AUTH_TIMEOUT_MS;
    const attachment: Attachment = {
      state: "pending",
      environmentId,
      session: randomId(),
      deadline,
    };

    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(attachment);
    const alarm = await this.ctx.storage.getAlarm();

    if (alarm === null || alarm > deadline) await this.ctx.storage.setAlarm(deadline);

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

    const context = this.#context();

    if (context === undefined) {
      socket.close(INTERNAL_ERROR, "internal");

      return;
    }

    this.#verifying.add(attachment.session);
    let outcome: CloseReason | "ready";

    try {
      const environment = await verifyRelayProof(context, {
        token: frame.proof,
        environmentId: attachment.environmentId,
      });
      const standing =
        environment.state === "revoked"
          ? "deleted"
          : await ownerStanding(context, { userId: environment.owner_id, recheck: false });

      outcome =
        standing === "active" ? "ready" : standing === "deleted" ? "revoked" : "unauthorized";
    } catch (error) {
      if (!(error instanceof Refusal))
        context.log.error("relay.auth_failed", { error: errorName(error) });
      outcome = "unauthorized";
    } finally {
      this.#verifying.delete(attachment.session);
    }

    if (socket.readyState !== OPEN) return;

    if (outcome === "ready" && Date.now() > attachment.deadline) outcome = "unauthorized";

    if (outcome !== "ready") {
      this.#close(socket, outcome);

      return;
    }

    await this.#attach(context, socket, attachment);
  }

  /** Make this socket the environment's one authenticated socket, replacing any other. */
  async #attach(
    context: Context,
    socket: WebSocket,
    attachment: Extract<Attachment, { state: "pending" }>,
  ): Promise<void> {
    const { environmentId, session } = attachment;
    const step = this.#attaching.then(async () => {
      if (socket.readyState !== OPEN) return;

      if (Date.now() > attachment.deadline) {
        this.#close(socket, "unauthorized");

        return;
      }

      if (!(await attachRelay(context.db, { id: environmentId, session }))) {
        this.#close(socket, "revoked");

        return;
      }

      if (socket.readyState !== OPEN) {
        await detachRelay(context.db, { id: environmentId, session });

        return;
      }

      for (const other of this.#sockets())
        if (other.socket !== socket && other.attachment.state === "ready")
          this.#close(other.socket, "replaced");
      const ready: Attachment = { state: "ready", environmentId, session };

      socket.serializeAttachment(ready);
      send(socket, { t: "ready" });
      context.log.info("relay.attached", { environmentId });
    });

    this.#attaching = step.catch((error: unknown) => {
      context.log.error("relay.attach_failed", { environmentId, error: errorName(error) });
      this.#close(socket, "unauthorized");
    });
    await this.#attaching;
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

    const channel = this.#channels.get(frame.ch);

    if (channel === undefined || channel.session !== attachment.session) return;
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
      default: {
        const _exhaustive: never = frame;
        kept = _exhaustive;
      }
    }

    if (!kept) this.#close(socket, "invalid");
  }

  async #forward(request: Request): Promise<Response> {
    const path = request.headers.get(RELAY_HEADERS.path);
    const deviceId = request.headers.get(RELAY_HEADERS.device) ?? undefined;
    const id = request.headers.get(RELAY_HEADERS.channel);
    const method = request.method;

    if (
      !Value.Check(RelayPath, path) ||
      !Value.Check(RelayMethod, method) ||
      !Value.Check(ChannelId, id) ||
      (deviceId !== undefined && !Value.Check(Uuid, deviceId))
    )
      return relayRefusal("not_found");
    const desktop = this.#sockets().find(({ attachment }) => attachment.state === "ready");

    if (desktop === undefined || request.signal.aborted || this.#channels.has(id))
      return relayRefusal("closed");
    const { session } = desktop.attachment;
    let open = 0;

    for (const channel of this.#channels.values()) if (channel.session === session) open += 1;

    if (open >= RELAY_CHANNEL_LIMIT) return relayRefusal("closed");
    const channel = new RelayChannel({
      id,
      session,
      deviceId,
      send: (frame) => send(desktop.socket, frame),
      onDone: () => this.#channels.delete(id),
    });

    this.#channels.set(id, channel);
    request.signal.addEventListener("abort", () => channel.cancel(), { once: true });
    channel.start({
      method,
      path,
      headers: relayRequestHeaders(request.headers),
      body: request.body,
    });

    return channel.response;
  }

  /** Close a socket with a contract code and end everything it carried. */
  #close(socket: WebSocket, reason: CloseReason): void {
    try {
      socket.close(RELAY_CLOSE[reason], reason);
    } catch {
      // Already closed.
    }

    this.#end(socket);
  }

  /** End a socket's channels and, for the authenticated one, its D1 session. */
  #end(socket: WebSocket): void {
    const attachment = attachmentOf(socket);

    if (attachment === undefined) return;

    for (const channel of this.#channels.values())
      if (channel.session === attachment.session) channel.fail("closed");

    if (attachment.state !== "ready") return;
    const context = this.#context();

    if (context !== undefined)
      this.ctx.waitUntil(
        detachRelay(context.db, { id: attachment.environmentId, session: attachment.session }),
      );
  }
}
