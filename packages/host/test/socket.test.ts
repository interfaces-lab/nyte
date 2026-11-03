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
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { listen } from "../src/index.ts";
import { fakeModels, open } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";

const TOKEN = "a-token-of-at-least-16";

const main: HeadName = asId("main");

const WINDOW = { tail: 50 } as const;

const changes = compile(withJson(SessionChangeType));

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Composed = Awaited<ReturnType<typeof open>>;

type Client = Awaited<ReturnType<typeof connect>>;

function hello(apiMinRevision = 1, actions: readonly string[] = [], name = "socket-test"): Json {
  return {
    c: "e",
    type: "hello",
    api_min_revision: apiMinRevision,
    client: {
      kind: "other",
      name,
      version: "1",
      actions: actions.map((action) => ({ name: action, summary: `Does ${action}.`, input: {} })),
    },
  };
}

async function target(listener: Listener, actions: readonly string[] = ["open"]) {
  const client = await connect(listener, hello(1, actions, "target"));
  await client.call("events.subscribe", { scopes: [`client/${client.id}`] });

  return client;
}

function performs(client: Client): readonly JsonSchema[] {
  return client.frames.filter((frame) => frame.kind === "perform");
}

async function failureCode(pending: Promise<Json>): Promise<string | null> {
  return pending.then(
    () => null,
    (error: Error) => ("code" in error && typeof error.code === "string" ? error.code : null),
  );
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

async function openSocket(listener: Listener, greeting: Json) {
  const socket = new WebSocket(socketUrl(listener), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const frames: JsonSchema[] = [];
  const wakes = new Set<() => void>();

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

  return { socket, frames, until, closed };
}

async function connect(listener: Listener, greeting: Json = hello()) {
  const opened = await openSocket(listener, greeting);
  const until = opened.until;
  let calls = 0;

  const answered = (id: string): boolean =>
    opened.frames.some(
      (frame) => frame.id === id && (frame.type === "result" || frame.type === "error"),
    );

  const start = (op: string, input: Json) => {
    calls += 1;
    const id = String(calls);
    opened.socket.send(JSON.stringify({ c: "e", type: "call", id, op, input }));

    const settled = until(
      (frame) => frame.id === id && (frame.type === "result" || frame.type === "error"),
    ).then((answer) => {
      if (answer.type === "error") throw decodeError(answer.error ?? null);

      return answer.output ?? null;
    });

    settled.catch(() => undefined);

    return { id, settled };
  };

  const call = (op: string, input: Json): Promise<Json> => start(op, input).settled;

  const welcome = await until((frame) => frame.type === "welcome");

  const id = welcome.client_id;
  assert(typeof id === "string");

  return { ...opened, start, call, answered, id };
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
    const client = await openSocket(listener, hello(API_REVISION + 1));
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

describe("clients as principals", () => {
  it("lists connected clients and sends host subscribers the clients whole on each join and leave", async () => {
    const listener = await serve(await compose(fakeModels()));
    const observer = await connect(listener);
    await observer.call("events.subscribe", { scopes: ["host"] });

    const counts = (): number[] =>
      observer.frames.flatMap((frame) =>
        frame.kind === "live" && Array.isArray(frame.clients) ? [frame.clients.length] : [],
      );

    const joined = await connect(listener, hello(1, ["open"], "second"));
    await observer.until(() => counts().at(-1) === 2);

    const listed: unknown = await observer.call("clients.read", {});

    expect(listed).toEqual([
      expect.objectContaining({ id: observer.id, name: "socket-test" }),
      {
        id: joined.id,
        principal: "token",
        kind: "other",
        name: "second",
        version: "1",
        actions: [{ name: "open", summary: "Does open.", input: {} }],
        since: expect.any(Number),
      },
    ]);

    joined.socket.terminate();
    await observer.until(() => counts().at(-1) === 1);
    expect(counts()).toEqual([1, 2, 1]);
  });

  it("refuses an action the client never declared with not_supported", async () => {
    const listener = await serve(await compose(fakeModels()));
    const asked = await target(listener);
    const requester = await connect(listener);

    expect(
      await failureCode(
        requester.call("client.perform", { client: asked.id, action: "close", input: {} }),
      ),
    ).toBe("not_supported");
  });

  it("delivers one request at a time in order with the client's own seq, and refuses past 16 waiting", async () => {
    const listener = await serve(await compose(fakeModels()));
    const observer = await connect(listener);
    await observer.call("events.subscribe", { scopes: ["host"] });
    const asked = await target(listener);
    const requester = await connect(listener);

    const asks = Array.from({ length: 18 }, (_, index) =>
      requester.call("client.perform", { client: asked.id, action: "open", input: { index } }),
    );

    expect(await failureCode(asks[17] ?? Promise.resolve(null))).toBe("unavailable");
    await asked.until((frame) => frame.kind === "perform");
    await requester.call("clients.read", {});
    expect(performs(asked)).toHaveLength(1);

    for (const index of [0, 1]) {
      const delivered = performs(asked)[index];
      assert(delivered !== undefined);
      expect(delivered).toMatchObject({
        scope: `client/${asked.id}`,
        seq: index + 1,
        requester: { client: requester.id, principal: "token" },
        action: "open",
        input: { index },
      });
      await asked.call("client.reply", { call: delivered.call ?? null, result: { opened: index } });
      expect(await asks[index]).toEqual({ opened: index });
      await asked.until(() => performs(asked).length === index + 2);
    }

    await observer.until((frame) => frame.kind === "performed" && frame.outcome === "performed");
    expect(observer.frames.find((frame) => frame.kind === "performed")).toEqual({
      c: "e",
      type: "event",
      scope: "host",
      seq: null,
      kind: "performed",
      call: expect.any(String),
      target: asked.id,
      outcome: "refused",
    });
    expect(
      observer.frames.filter((frame) => frame.kind === "performed").map((frame) => frame.outcome),
    ).toEqual(["refused", "performed", "performed"]);
  });

  it.each([
    { timeoutMs: undefined, waits: 10_000 },
    { timeoutMs: 5_000, waits: 5_000 },
    { timeoutMs: 60_000, waits: 30_000 },
  ])(
    "times a request out after $waits ms when it asks for $timeoutMs, without telling the client",
    async (entry) => {
      const listener = await serve(await compose(fakeModels()));
      const observer = await connect(listener);
      await observer.call("events.subscribe", { scopes: ["host"] });
      const asked = await target(listener);
      const requester = await connect(listener);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const request: JsonSchema = { client: asked.id, action: "open", input: {} };
      const ask = requester.start(
        "client.perform",
        entry.timeoutMs === undefined ? request : { ...request, timeoutMs: entry.timeoutMs },
      );

      await asked.until((frame) => frame.kind === "perform");
      vi.advanceTimersByTime(entry.waits - 1);
      await requester.call("clients.read", {});
      expect(requester.answered(ask.id)).toBe(false);

      vi.advanceTimersByTime(1);
      expect(await failureCode(ask.settled)).toBe("timeout");
      await observer.until((frame) => frame.outcome === "timeout");

      const late = performs(asked)[0];
      assert(late !== undefined);
      expect(
        await failureCode(asked.call("client.reply", { call: late.call ?? null, result: null })),
      ).toBe("unknown");
      expect(asked.frames.filter((frame) => frame.type === "event")).toHaveLength(1);
    },
  );

  it("counts a request's timeout from when it reaches the front of the queue", async () => {
    const listener = await serve(await compose(fakeModels()));
    const asked = await target(listener);
    const requester = await connect(listener);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ask = { client: asked.id, action: "open", input: {}, timeoutMs: 1_000 };
    const first = requester.start("client.perform", ask);
    const second = requester.start("client.perform", ask);

    await asked.until((frame) => frame.kind === "perform");
    vi.advanceTimersByTime(1_000);
    expect(await failureCode(first.settled)).toBe("timeout");
    await asked.until(() => performs(asked).length === 2);

    vi.advanceTimersByTime(999);
    await requester.call("clients.read", {});
    expect(requester.answered(second.id)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await failureCode(second.settled)).toBe("timeout");
  });

  it("takes exactly one of result and error in a reply and answers unknown for a call it doesn't hold", async () => {
    const listener = await serve(await compose(fakeModels()));
    const observer = await connect(listener);
    await observer.call("events.subscribe", { scopes: ["host"] });
    const asked = await target(listener);
    const requester = await connect(listener);
    const ask = requester.call("client.perform", { client: asked.id, action: "open", input: {} });
    const delivered = await asked.until((frame) => frame.kind === "perform");
    const call = delivered.call ?? null;

    const replies: readonly { readonly input: Json; readonly code: string }[] = [
      {
        input: { call, result: 1, error: { code: "internal", message: "Both." } },
        code: "invalid",
      },
      { input: { call }, code: "invalid" },
      { input: { call: "not-a-call", result: 1 }, code: "unknown" },
    ];

    expect(
      await Promise.all(
        replies.map(async (reply) => ({
          input: reply.input,
          code: await failureCode(asked.call("client.reply", reply.input)),
        })),
      ),
    ).toEqual(replies);

    await asked.call("client.reply", { call, error: { code: "denied", message: "Not now." } });
    expect(await failureCode(ask)).toBe("denied");
    await observer.until((frame) => frame.outcome === "failed");
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
