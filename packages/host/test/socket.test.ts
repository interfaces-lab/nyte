import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
  API_REVISION,
  asId,
  compile,
  isJson,
  isJsonObject,
  SessionChangeType,
  withJson,
} from "@nyte-ai/schema";
import type { HeadName, Json, JsonSchema, SessionId } from "@nyte-ai/schema";
import type { Listener } from "@nyte-ai/core";
import { decodeError, decodeOutput, openSessionStore } from "@nyte-ai/protocol";
import type { SessionStore } from "@nyte-ai/protocol";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { afterEach, assert, describe, expect, it } from "vitest";
import { listen } from "../src/index.ts";
import { fakeModels, open } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";

const TOKEN = "a-token-of-at-least-16";

const main: HeadName = asId("main");

const WINDOW = { tail: 50 } as const;

const changes = compile(withJson(SessionChangeType));

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Composed = Awaited<ReturnType<typeof open>>;

type Client = Awaited<ReturnType<typeof connect>>;

function hello(apiMinRevision = 1): Json {
  return {
    c: "e",
    type: "hello",
    api_min_revision: apiMinRevision,
    client: { kind: "other", name: "socket-test", version: "1", actions: [] },
  };
}

async function compose(fake: FakeModels): Promise<Composed> {
  const host = await open(fake);
  cleanups.push(() => host.close());

  return host;
}

async function serve(host: Composed, path?: string): Promise<Listener> {
  const listener = await listen(host, {
    transport: path === undefined ? { kind: "http" } : { kind: "socket", path },
    auth: { kind: "token", token: TOKEN },
  });

  cleanups.push(() => listener.close());

  return listener;
}

function socketUrl(listener: Listener): string {
  const address = listener.address ?? "";

  return address.startsWith("http")
    ? `${address.replace(/^http/, "ws")}/.nyte/ws`
    : `ws+unix://${address}:/.nyte/ws`;
}

async function connect(listener: Listener, greeting: Json = hello()) {
  const socket = new WebSocket(socketUrl(listener), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const frames: JsonSchema[] = [];
  const wakes = new Set<() => void>();
  let calls = 0;

  const closed = new Promise<{ readonly code: number; readonly reason: string }>((done) => {
    socket.once("close", (code, reason) => done({ code, reason: reason.toString() }));
  });

  socket.on("message", (data) => {
    const value: unknown = JSON.parse(readText(data));

    if (isJson(value) && isJsonObject(value)) frames.push(value);

    for (const wake of wakes) wake();
  });

  cleanups.push(async () => {
    socket.terminate();
  });
  await once(socket, "open");
  socket.send(JSON.stringify(greeting));

  const until = async (match: (frame: JsonSchema) => boolean): Promise<JsonSchema> => {
    for (;;) {
      const found = frames.find(match);

      if (found !== undefined) return found;
      await new Promise<void>((woken) => {
        const wake = (): void => {
          wakes.delete(wake);
          woken();
        };

        wakes.add(wake);
      });
    }
  };

  const call = async (op: string, input: Json): Promise<Json> => {
    calls += 1;
    const id = String(calls);
    socket.send(JSON.stringify({ c: "e", type: "call", id, op, input }));

    const answer = await until(
      (frame) => frame.id === id && (frame.type === "result" || frame.type === "error"),
    );

    if (answer.type === "error") throw decodeError(answer.error ?? null);

    return answer.output ?? null;
  };

  return { socket, frames, until, call, closed };
}

function readWindow(client: Client, session: SessionId, resume?: SessionStore) {
  if (resume === undefined)
    return client.call("head.read", { session, head: main, window: WINDOW });
  const from = resume.snapshot().order[0] ?? null;

  return client.call("head.read", {
    session,
    head: main,
    window: WINDOW,
    resume: { seq: resume.seq, from },
  });
}

function applyChanges(store: SessionStore, frames: readonly JsonSchema[]): number {
  let applied = 0;

  for (const frame of frames)
    if (frame.type === "event" && frame.kind === "change" && changes.Check(frame)) {
      store.apply(frame);
      applied += 1;
    }

  return applied;
}

async function freshSnapshot(client: Client, session: SessionId) {
  const read = await readWindow(client, session);
  const before = client.frames.findIndex((frame) => frame.output === read);

  return { snapshot: openSessionStore(decodeOutput("head.read", read)).snapshot(), before };
}

async function startSession(host: Composed, fake: FakeModels): Promise<SessionId> {
  fake.reply({ content: [{ type: "text", text: "Hello." }] });
  const started = await host.sessions.start({ content: "Hi." });
  await started.receipt.settled();

  return started.session.id;
}

async function send(host: Composed, fake: FakeModels, session: SessionId, text: string) {
  fake.reply({ content: [{ type: "text", text: `Re: ${text.slice(0, 20)}` }] });

  return host.session(session).head(main).send(text);
}

describe("the host's WebSocket", () => {
  it("applies the events that arrive before head.read's answer and ends equal to a fresh read", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const client = await connect(listener);

    await client.call("events.subscribe", { scopes: [`session/${session}`] });
    const receipt = await send(host, fake, session, "More.");
    await client.until((frame) => frame.kind === "change");

    const read = await readWindow(client, session);
    const answered = client.frames.findIndex((frame) => frame.output === read);
    const store = openSessionStore(decodeOutput("head.read", read));

    expect(applyChanges(store, client.frames.slice(0, answered))).toBeGreaterThan(0);
    await receipt.settled();
    const fresh = await freshSnapshot(client, session);
    applyChanges(store, client.frames.slice(answered + 1, fresh.before));

    expect(store.stale).toBe(false);
    expect(store.snapshot()).toEqual(fresh.snapshot);
  });

  it("resumes a dropped connection from its seq and first message and ends equal to a fresh read", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const first = await connect(listener);

    await first.call("events.subscribe", { scopes: [`session/${session}`] });
    const store = openSessionStore(decodeOutput("head.read", await readWindow(first, session)));
    first.socket.terminate();
    await first.closed;

    await (await send(host, fake, session, "While away.")).settled();
    const second = await connect(listener);
    await second.call("events.subscribe", { scopes: [`session/${session}`] });
    const resumed = decodeOutput("head.read", await readWindow(second, session, store));
    const answered = second.frames.length;

    expect(resumed.complete).toBe(false);
    store.resume(resumed);
    const fresh = await freshSnapshot(second, session);
    applyChanges(store, second.frames.slice(answered, fresh.before));

    expect(store.snapshot()).toEqual(fresh.snapshot);
  });

  it("closes a connection that never reads its socket with backlog", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const raw = await rawConnect(listener);

    raw.write(JSON.stringify(hello()));
    raw.write(
      JSON.stringify({
        c: "e",
        type: "call",
        id: "1",
        op: "events.subscribe",
        input: { scopes: [`session/${session}`] },
      }),
    );
    await new Promise((settle) => setTimeout(settle, 50));

    for (let index = 0; index < 40; index += 1)
      await (await send(host, fake, session, `${index} ${"x".repeat(700_000)}`)).settled();

    expect(await raw.closing()).toEqual({ code: 1008, reason: "backlog" });
  }, 60_000);

  it("closes 1008 with a reason that names the side to update when the revisions don't overlap", async () => {
    const host = await compose(fakeModels());
    const listener = await serve(host);
    const client = await connect(listener, hello(API_REVISION + 1));
    const closed = await client.closed;

    expect(closed.code).toBe(1008);
    expect(closed.reason).toMatch(/^Update the host/);
  });

  it("answers a local operation only on the unix socket", async () => {
    const host = await compose(fakeModels());
    const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-socket-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));

    const routes = [
      { route: "http", listener: await serve(host), code: "denied" },
      { route: "unix", listener: await serve(host, join(home, "host.sock")), code: "unavailable" },
    ];

    const answers = await Promise.all(
      routes.map(async (entry) => {
        const client = await connect(entry.listener);

        const failure = await client.call("host.tailnet.status", {}).then(
          () => null,
          (error: Error) => error,
        );

        return {
          route: entry.route,
          code: failure !== null && "code" in failure ? failure.code : null,
        };
      }),
    );

    expect(answers).toEqual(routes.map((entry) => ({ route: entry.route, code: entry.code })));
  });
});

async function rawConnect(listener: Listener) {
  const address = new URL(listener.address ?? "");

  const upgraded = await new Promise<{ readonly socket: Duplex; readonly head: Buffer }>(
    (done, failed) => {
      const sent = request({
        host: address.hostname,
        port: address.port,
        path: "/.nyte/ws",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        },
      });

      sent.once("upgrade", (_response: IncomingMessage, socket: Duplex, head: Buffer) => {
        socket.pause();
        done({ socket, head });
      });
      sent.once("error", failed);
      sent.end();
    },
  );

  const socket = upgraded.socket;

  return {
    write(text: string): void {
      socket.write(maskedFrame(Buffer.from(text, "utf8")));
    },
    async closing(): Promise<{ readonly code: number; readonly reason: string }> {
      let buffered = upgraded.head;

      for await (const chunk of socket) {
        assert(Buffer.isBuffer(chunk));
        buffered = Buffer.concat([buffered, chunk]);

        for (;;) {
          const frame = readFrame(buffered);

          if (frame === null) break;
          buffered = buffered.subarray(frame.size);

          if (frame.opcode === 8)
            return {
              code: frame.payload.readUInt16BE(0),
              reason: frame.payload.subarray(2).toString("utf8"),
            };
        }
      }

      return { code: 0, reason: "ended" };
    },
  };
}

function readText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");

  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");

  return data.toString("utf8");
}

function maskedFrame(payload: Buffer): Buffer {
  const mask = randomBytes(4);

  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);

  const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));

  return Buffer.concat([header, mask, masked]);
}

function readFrame(
  buffered: Buffer,
): { readonly opcode: number; readonly payload: Buffer; readonly size: number } | null {
  if (buffered.length < 2) return null;
  const opcode = (buffered[0] ?? 0) & 0x0f;
  const short = (buffered[1] ?? 0) & 0x7f;
  const offset = short === 126 ? 4 : short === 127 ? 10 : 2;

  if (buffered.length < offset) return null;

  const length =
    short === 126
      ? buffered.readUInt16BE(2)
      : short === 127
        ? Number(buffered.readBigUInt64BE(2))
        : short;

  if (buffered.length < offset + length) return null;

  return {
    opcode,
    payload: buffered.subarray(offset, offset + length),
    size: offset + length,
  };
}
