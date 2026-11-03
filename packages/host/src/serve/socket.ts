import { Buffer } from "node:buffer";
import {
  API_MIN_REVISION,
  API_REVISION,
  CallFrameType,
  compile,
  HELLO_MAX_BYTES,
  HelloFrameType,
  isJson,
  OPERATIONS,
  SdkError,
  SOCKET_LIMITS,
  asId,
  withJson,
} from "@nyte-ai/schema";
import type {
  Activation,
  Authority,
  CallFrame,
  ClientId,
  HelloFrame,
  Json,
  PrincipalId,
  SdkErrorWire,
  Seq,
  SessionChange,
  SessionId,
  WelcomeFrame,
} from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import type { ServerHost, SessionAttachment, StreamingPart } from "@nyte-ai/core/server";
import {
  answersOnce,
  asSdkError,
  decodeInput,
  encodeError,
  namesOperation,
} from "@nyte-ai/protocol";
import type { RawData, WebSocket } from "ws";
import type { TailnetControl } from "../tailnet.ts";
import { bindConnection } from "./binding.ts";
import { sharedClients } from "./clients.ts";
import type { HostEvent, PerformEvent } from "./clients.ts";
import { callBinding, UPLOADS } from "./handler.ts";

export type SocketPeer = {
  readonly connection: Connection;
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly local: boolean;
  readonly server: ServerHost;
  readonly tailnet?: TailnetControl;
  readonly signal: AbortSignal;
  leave(): void;
};

export type TextEntry = {
  readonly part: string;
  readonly run: string | null;
  readonly version: number;
  readonly whole: boolean;
  readonly body: string;
};

type EventOut =
  | WelcomeFrame
  | PerformEvent
  | HostEvent
  | { readonly c: "e"; readonly type: "result"; readonly id: string; readonly output: Json }
  | { readonly c: "e"; readonly type: "error"; readonly id: string; readonly error: SdkErrorWire }
  | {
      readonly c: "e";
      readonly type: "event";
      readonly scope: string;
      readonly seq: Seq;
      readonly kind: "change";
      readonly tables: SessionChange["tables"];
      readonly paths: SessionChange["paths"];
    }
  | {
      readonly c: "e";
      readonly type: "event";
      readonly scope: string;
      readonly seq: null;
      readonly kind: "live";
      readonly activation: Activation;
    };

type Outbox = {
  event(frame: EventOut): void;
  text(entry: TextEntry): void;
};

type Subscription = {
  readonly attachment: SessionAttachment | null;
  readonly sent: Map<string, StreamingPart>;
  release(): void;
};

type Queued = { part: string; run: string | null; version: number; whole: boolean; body: string };

const PING_MS = 30_000;

const MISSED_PONGS = 3;

const HIGH_WATER = 64 * 1024;

const hellos = compile(withJson(HelloFrameType));

const calls = compile(withJson(CallFrameType));

export function serveSession(socket: WebSocket, peer: SocketPeer): void {
  const binding = bindConnection(peer.connection, {
    server: peer.server,
    tailnet: peer.tailnet,
  });

  const flights = new Set<AbortController>();
  const clients = sharedClients(peer.server);

  let client: {
    readonly id: ClientId;
    readonly membership: ReturnType<typeof clients.join>;
  } | null = null;

  let closed = false;
  let missed = 0;
  let waiting = false;

  const close = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    socket.close(code, truncate(reason));
  };

  const subscriptions = new Map<string, Subscription>();
  let textOpen = false;

  const outbox = openOutbox(socket, close, () => {
    textOpen = false;

    for (const subscription of subscriptions.values()) subscription.sent.clear();
  });

  const stream = (subscription: Subscription): void => {
    if (!textOpen || subscription.attachment === null) return;
    const live = subscription.attachment.streaming();
    const kept = new Set<string>();

    for (const part of live) {
      kept.add(part.part);
      const previous = subscription.sent.get(part.part);

      if (previous !== undefined && previous.version === part.version) continue;
      subscription.sent.set(part.part, part);

      const appended =
        previous !== undefined &&
        part.version > previous.version &&
        part.markdown.startsWith(previous.markdown);

      const body = appended ? part.markdown.slice(previous.markdown.length) : part.markdown;

      if (!appended || body !== "")
        outbox.text({
          part: part.part,
          run: part.run,
          version: part.version,
          whole: !appended,
          body,
        });
    }

    for (const part of subscription.sent.keys())
      if (!kept.has(part)) subscription.sent.delete(part);
  };

  const attachSession = async (scope: string, id: SessionId): Promise<void> => {
    await peer.connection.session(id).info();
    const attachment = peer.server.wire.attach(id, peer.principal);

    try {
      await attachment.ready();
    } catch (error) {
      attachment.release();

      throw error;
    }

    if (closed || subscriptions.has(scope)) {
      attachment.release();

      return;
    }

    let sent = attachment.seq();
    let activation = JSON.stringify(attachment.activation());

    const live = (): void =>
      outbox.event({
        c: "e",
        type: "event",
        scope,
        seq: null,
        kind: "live",
        activation: attachment.activation(),
      });

    const changed = (): void => {
      if (attachment.seq() > sent) {
        const change = attachment.changesSince(sent);
        sent = change.seq;

        if (Object.keys(change.tables).length > 0 || change.paths.length > 0)
          outbox.event({
            c: "e",
            type: "event",
            scope,
            seq: change.seq,
            kind: "change",
            tables: change.tables,
            paths: change.paths,
          });
      }

      const now = JSON.stringify(attachment.activation());

      if (now !== activation) {
        activation = now;
        live();
      }

      stream(subscription);
    };

    const unsubscribe = attachment.subscribe(changed);

    const subscription: Subscription = {
      attachment,
      sent: new Map(),
      release() {
        unsubscribe();
        attachment.release();
      },
    };

    subscriptions.set(scope, subscription);
    live();
    stream(subscription);
  };

  const subscribe = async (scopes: readonly string[]): Promise<void> => {
    const targets = scopes.map((scope) => readScope(scope, client?.id ?? null));

    for (const target of targets) {
      if (subscriptions.has(target.scope)) continue;

      if (target.kind === "session") await attachSession(target.scope, target.session);
      else if (target.kind === "host") observeHost();
      else listenAsClient();
    }
  };

  const observeHost = (): void => {
    outbox.event({
      c: "e",
      type: "event",
      scope: "host",
      seq: null,
      kind: "live",
      clients: clients.rows(),
    });
    const stop = clients.observe((event) => outbox.event(event));
    subscriptions.set("host", { attachment: null, sent: new Map(), release: stop });
  };

  const listenAsClient = (): void => {
    const membership = client?.membership;

    if (client === null || membership === undefined) return;
    subscriptions.set(`client/${client.id}`, {
      attachment: null,
      sent: new Map(),
      release: () => membership.listen(false),
    });
    membership.listen(true);
  };

  const askClient = async (input: Json): Promise<Json> => {
    if (client === null) throw new SdkError("invalid", "Say hello first.");
    const request = decodeInput("client.perform", input);

    return clients.perform({ client: client.id, principal: peer.principal }, request);
  };

  const reply = (input: Json): void => {
    if (client === null) throw new SdkError("invalid", "Say hello first.");
    const answer = decodeInput("client.reply", input);

    if ((answer.result === undefined) === (answer.error === undefined))
      throw new SdkError("invalid", "A reply carries exactly one of result and error.");

    clients.reply(
      client.id,
      answer.call,
      answer.error === undefined
        ? { kind: "result", result: answer.result ?? null }
        : { kind: "error", code: answer.error.code, message: answer.error.message },
    );
  };

  const unsubscribe = (scopes: readonly string[]): void => {
    for (const scope of scopes) {
      subscriptions.get(scope)?.release();
      subscriptions.delete(scope);
    }
  };

  const openText = (): void => {
    textOpen = true;

    for (const subscription of subscriptions.values()) {
      subscription.sent.clear();
      stream(subscription);
    }
  };

  const greet = (data: string): void => {
    const value = Buffer.byteLength(data) > HELLO_MAX_BYTES ? undefined : readJson(data);

    if (!hellos.Check(value)) {
      close(1008, "The first frame must be a hello of at most 4 KB.");

      return;
    }

    const refusal = refuseRevisions(value);

    if (refusal !== null) {
      close(1008, refusal);

      return;
    }

    const id = asId<"client">(crypto.randomUUID());

    const membership = clients.join({
      row: {
        id,
        principal: peer.principal,
        kind: value.client.kind,
        name: value.client.name,
        version: value.client.version,
        actions: value.client.actions,
        since: Date.now(),
      },
      deliver: (event) => outbox.event(event),
    });

    client = { id, membership };
    outbox.event({
      c: "e",
      type: "welcome",
      api_revision: Math.min(API_REVISION, value.api_revision ?? API_REVISION),
      api_min_revision: API_MIN_REVISION,
      api_server_revision: API_REVISION,
      client_id: id,
      limits: SOCKET_LIMITS,
    });
  };

  const answer = async (frame: CallFrame): Promise<void> => {
    const flight = new AbortController();
    flights.add(flight);

    try {
      const output = await dispatch(frame.op, frame.input ?? {}, flight.signal);
      outbox.event({ c: "e", type: "result", id: frame.id, output });
    } catch (error) {
      outbox.event({ c: "e", type: "error", id: frame.id, error: encodeError(asSdkError(error)) });
    } finally {
      flights.delete(flight);
    }
  };

  const dispatch = async (op: string, input: Json, signal: AbortSignal): Promise<Json> => {
    if (!namesOperation(op) || !answersOnce(op))
      throw new SdkError("unknown", `No call answers ${op} on the socket.`);

    if ("local" in OPERATIONS[op] && !peer.local)
      throw new SdkError("denied", `${op} answers only on the host's local socket.`);
    const needed = OPERATIONS[op].authority;

    if (!peer.authority.has(needed))
      throw new SdkError("denied", `${op} needs ${needed} authority.`);

    if (UPLOADS.has(op)) throw new SdkError("invalid", `${op} carries bytes; call it over HTTP.`);

    if (op === "events.subscribe") {
      await subscribe(decodeInput(op, input).scopes);

      return null;
    }

    if (op === "events.unsubscribe") {
      unsubscribe(decodeInput(op, input).scopes);

      return null;
    }

    if (op === "client.perform") return askClient(input);

    if (op === "client.reply") {
      reply(input);

      return null;
    }

    if (op === "text.open") {
      decodeInput(op, input);
      openText();

      return null;
    }

    return callBinding(binding, op, input, { body: null, signal });
  };

  const receive = (data: RawData, binary: boolean): void => {
    if (closed) return;

    if (binary) {
      close(1003, "The socket carries JSON text frames only.");

      return;
    }

    const text = rawText(data);

    if (client === null) {
      greet(text);

      return;
    }

    const value = readJson(text);

    if (!calls.Check(value)) {
      close(1008, "After the hello, a client sends only calls.");

      return;
    }

    void answer(value);
  };

  const heartbeat = setInterval(() => {
    if (waiting) missed += 1;

    if (missed >= MISSED_PONGS) {
      closed = true;
      socket.terminate();

      return;
    }

    waiting = true;
    socket.ping();
  }, PING_MS);

  heartbeat.unref();

  const revoked = (): void => {
    const reason = peer.signal.reason;
    close(1008, reason instanceof SdkError ? reason.message : "The host disconnected its clients.");
  };

  socket.on("message", receive);
  socket.on("pong", () => {
    waiting = false;
    missed = 0;
  });
  socket.on("error", () => socket.terminate());
  socket.once("close", () => {
    closed = true;
    clearInterval(heartbeat);
    peer.signal.removeEventListener("abort", revoked);

    for (const flight of flights) flight.abort(new SdkError("unavailable", "The socket closed."));
    flights.clear();

    for (const subscription of subscriptions.values()) subscription.release();
    subscriptions.clear();
    client?.membership.leave();
    peer.leave();
  });

  if (peer.signal.aborted) revoked();
  else peer.signal.addEventListener("abort", revoked, { once: true });
}

function openOutbox(
  socket: WebSocket,
  close: (code: number, reason: string) => void,
  textClosing: () => void,
): Outbox {
  const events: { readonly text: string; readonly bytes: number }[] = [];
  const texts = new Map<string, Queued>();
  let eventBytes = 0;
  let textBytes = 0;
  let textClosed = false;
  let open = true;

  const shut = (code: number, reason: string): void => {
    open = false;
    events.length = 0;
    texts.clear();
    close(code, reason);
  };

  const takeText = (): string | undefined => {
    if (textClosed) {
      textClosed = false;

      return JSON.stringify({ c: "t", type: "closed" });
    }

    const first = texts.values().next();

    if (first.done === true) return undefined;
    const entry = first.value;
    texts.delete(entry.part);
    textBytes -= Buffer.byteLength(entry.body);
    const head = { c: "t", part: entry.part, run: entry.run, version: entry.version };

    return JSON.stringify(
      entry.whole ? { ...head, text: entry.body } : { ...head, append: entry.body },
    );
  };

  const take = (): string | undefined => {
    const event = events.shift();

    if (event === undefined) return takeText();
    eventBytes -= event.bytes;

    return event.text;
  };

  const pump = (): void => {
    while (open && socket.readyState === socket.OPEN && socket.bufferedAmount < HIGH_WATER) {
      const next = take();

      if (next === undefined) return;
      socket.send(next, () => pump());
    }
  };

  return {
    event(frame) {
      if (!open) return;
      const text = JSON.stringify(frame);
      const bytes = Buffer.byteLength(text);

      if (bytes > SOCKET_LIMITS.maxFrameBytes) {
        shut(1009, "oversize");

        return;
      }

      events.push({ text, bytes });
      eventBytes += bytes;

      if (eventBytes > SOCKET_LIMITS.backlogBytes) {
        shut(1008, "backlog");

        return;
      }

      pump();
    },
    text(entry) {
      if (!open) return;
      const queued = texts.get(entry.part);
      const bytes = Buffer.byteLength(entry.body);

      if (queued !== undefined && !entry.whole) {
        queued.body += entry.body;
        queued.version = entry.version;
      } else {
        if (queued !== undefined) textBytes -= Buffer.byteLength(queued.body);
        texts.set(entry.part, { ...entry });
      }

      textBytes += bytes;

      if (textBytes > SOCKET_LIMITS.backlogBytes) {
        texts.clear();
        textBytes = 0;
        textClosed = true;
        textClosing();
      }

      pump();
    },
  };
}

function readScope(
  scope: string,
  client: ClientId | null,
):
  | { readonly kind: "host"; readonly scope: string }
  | { readonly kind: "session"; readonly scope: string; readonly session: SessionId }
  | { readonly kind: "client"; readonly scope: string } {
  if (scope === "host") return { kind: "host", scope };

  if (scope.startsWith("session/"))
    return { kind: "session", scope, session: asId<"session">(scope.slice("session/".length)) };

  if (scope === `client/${client ?? ""}`) return { kind: "client", scope };

  throw new SdkError(
    "denied",
    `A connection may subscribe only to its own client scope, not ${scope}.`,
  );
}

function refuseRevisions(hello: HelloFrame): string | null {
  const served = `revisions ${API_MIN_REVISION}-${API_REVISION}`;

  if (hello.api_min_revision > API_REVISION)
    return `Update the host: it serves ${served} and the client needs ${hello.api_min_revision} or later.`;

  if (hello.api_revision !== undefined && hello.api_revision < API_MIN_REVISION)
    return `Update the client: the host serves ${served} and the client speaks up to ${hello.api_revision}.`;

  return null;
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");

  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");

  return data.toString("utf8");
}

function readJson(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return isJson(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function truncate(reason: string): string {
  return Buffer.byteLength(reason) <= 123 ? reason : `${reason.slice(0, 118)}...`;
}
