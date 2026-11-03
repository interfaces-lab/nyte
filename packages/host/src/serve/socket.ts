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
  Authority,
  CallFrame,
  ClientId,
  HelloFrame,
  Json,
  PrincipalId,
} from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import type { ServerHost } from "@nyte-ai/core/server";
import { answersOnce, asSdkError, encodeError, namesOperation } from "@nyte-ai/protocol";
import type { RawData, WebSocket } from "ws";
import type { TailnetControl } from "../tailnet.ts";
import { bindConnection } from "./binding.ts";
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

type Outbox = {
  event(frame: Json): void;
  text(entry: TextEntry): void;
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
  let client: { readonly id: ClientId; readonly hello: HelloFrame } | null = null;
  let closed = false;
  let missed = 0;
  let waiting = false;

  const close = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    socket.close(code, truncate(reason));
  };

  const outbox = openOutbox(socket, close);

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
    client = { id, hello: value };
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
      const output = await perform(frame.op, frame.input ?? {}, flight.signal);
      outbox.event({ c: "e", type: "result", id: frame.id, output });
    } catch (error) {
      outbox.event({ c: "e", type: "error", id: frame.id, error: encodeError(asSdkError(error)) });
    } finally {
      flights.delete(flight);
    }
  };

  const perform = async (op: string, input: Json, signal: AbortSignal): Promise<Json> => {
    if (!namesOperation(op) || !answersOnce(op))
      throw new SdkError("unknown", `No call answers ${op} on the socket.`);

    if ("local" in OPERATIONS[op] && !peer.local)
      throw new SdkError("denied", `${op} answers only on the host's local socket.`);
    const needed = OPERATIONS[op].authority;

    if (!peer.authority.has(needed))
      throw new SdkError("denied", `${op} needs ${needed} authority.`);

    if (UPLOADS.has(op)) throw new SdkError("invalid", `${op} carries bytes; call it over HTTP.`);

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
    peer.leave();
  });

  if (peer.signal.aborted) revoked();
  else peer.signal.addEventListener("abort", revoked, { once: true });
}

function openOutbox(socket: WebSocket, close: (code: number, reason: string) => void): Outbox {
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
      }

      pump();
    },
  };
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
