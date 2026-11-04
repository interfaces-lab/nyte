import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_REVISION,
  asId,
  backgroundRowKey,
  compile,
  SessionChangeType,
  SessionsChangeType,
  TextFrameType,
  withJson,
} from "@nyte-ai/schema";
import type {
  BackgroundItem,
  BackgroundRow,
  HeadName,
  Json,
  JsonSchema,
  SessionId,
  TextFrame,
} from "@nyte-ai/schema";
import type { Listener } from "@nyte-ai/core";
import { completed, createServerHost, livePart, publishPatch, setup } from "@nyte-ai/core/testing";
import { decodeOutput, openDirectoryStore, openSessionStore } from "@nyte-ai/protocol";
import type { DirectoryStore, SessionStore } from "@nyte-ai/protocol";
import { WebSocket } from "ws";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { sqliteStore } from "../src/sqlite.ts";
import { fakeModels } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";
import { rawConnect } from "./fixtures/raw-socket.ts";
import {
  cleanups,
  compose,
  connect,
  failureCode,
  hello,
  openSocket,
  performs,
  serve,
  socketUrl,
  target,
  TOKEN,
} from "./fixtures/socket-client.ts";
import type { Client, Composed } from "./fixtures/socket-client.ts";

const main: HeadName = asId("main");

const WINDOW = { tail: 50 } as const;

const changes = compile(withJson(SessionChangeType));

const sessionsChanges = compile(withJson(SessionsChangeType));

const textFrames = compile(withJson(TextFrameType));

afterEach(async () => {
  vi.useRealTimers();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

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

async function watch(listener: Listener, session: SessionId): Promise<Client> {
  const client = await connect(listener);
  await client.call("events.subscribe", { scopes: [`session/${session}`] });

  return client;
}

async function readAndDrop(listener: Listener, session: SessionId): Promise<SessionStore> {
  const client = await watch(listener, session);
  const store = openSessionStore(decodeOutput("head.read", await readWindow(client, session)));
  client.socket.terminate();
  await client.closed;

  return store;
}

async function reconnect(listener: Listener, session: SessionId, store: SessionStore) {
  const client = await watch(listener, session);
  const resumed = decodeOutput("head.read", await readWindow(client, session, store));
  store.resume(resumed);

  return { complete: resumed.complete, fresh: (await freshSnapshot(client, session)).snapshot };
}

function childState(rows: Iterable<BackgroundRow> | undefined, child: SessionId) {
  return Array.from(rows ?? []).find((row) => row.item.id === child)?.item.state;
}

function childReaches(client: Client, child: SessionId, state: BackgroundItem["state"]) {
  return client.until(
    (frame) => changes.Check(frame) && childState(frame.tables.background?.upsert, child) === state,
  );
}

function hostChange(frame: JsonSchema): boolean {
  return frame.scope === "host" && frame.kind === "change";
}

function applySessions(store: DirectoryStore, frames: readonly JsonSchema[]): number {
  let applied = 0;

  for (const frame of frames)
    if (hostChange(frame) && sessionsChanges.Check(frame)) {
      store.apply(frame);
      applied += 1;
    }

  return applied;
}

async function readDirectory(client: Client, seq?: number) {
  const read = await client.call("sessions.read", seq === undefined ? {} : { resume: { seq } });
  const answered = client.frames.findIndex((frame) => frame.output === read);

  return { read: decodeOutput("sessions.read", read), answered };
}

const GREETER = [
  {
    id: "greeter",
    contribute: {
      commands: [{ name: "hello", title: "Hello", description: "Says hi.", run: () => "hi" }],
    },
  },
];

const HELLO = { commands: [{ name: "hello", owner: "greeter" }] };

async function fileStore() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-catalog-")));
  cleanups.push(() => rm(home, { recursive: true, force: true }));

  return sqliteStore({ path: join(home, "nyte.db") });
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

  it("misses no event above head.read's seq when the read follows the subscribe without waiting for it", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const session = await startSession(host, fake);
    const attaching = Promise.withResolvers<void>();
    const attach = Promise.withResolvers<void>();
    let held = false;

    const listener = await serve({
      ...host,
      server: {
        ...host.server,
        wire: {
          ...host.server.wire,
          attach(id, principal) {
            const attachment = host.server.wire.attach(id, principal);

            if (held) return attachment;
            held = true;

            return {
              ...attachment,
              async ready() {
                attaching.resolve();
                await attach.promise;
                await attachment.ready();
              },
            };
          },
        },
      },
    });

    const client = await connect(listener);
    const subscribing = client.start("events.subscribe", { scopes: [`session/${session}`] });
    const reading = client.start("head.read", { session, head: main, window: WINDOW });
    await attaching.promise;
    await (await send(host, fake, session, "While the subscribe attaches.")).settled();
    attach.resolve();
    await subscribing.settled;
    const store = openSessionStore(decodeOutput("head.read", await reading.settled));
    await (await send(host, fake, session, "After the read.")).settled();
    const fresh = await freshSnapshot(client, session);
    applyChanges(store, client.frames.slice(0, fresh.before));

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
    const read = await readWindow(first, session);
    const attached = first.frames.findIndex((frame) => frame.output === read);
    const store = openSessionStore(decodeOutput("head.read", read));
    const attachedSeq = store.seq;
    await (await send(host, fake, session, "Before the drop.")).settled();
    const before = await freshSnapshot(first, session);
    applyChanges(store, first.frames.slice(attached + 1, before.before));

    expect(store.seq).toBeGreaterThan(attachedSeq);
    expect(store.snapshot()).toEqual(before.snapshot);
    first.socket.terminate();
    await first.closed;

    await (await send(host, fake, session, "While away.")).settled();
    const second = await connect(listener);
    await second.call("events.subscribe", { scopes: [`session/${session}`] });
    const resumed = decodeOutput("head.read", await readWindow(second, session, store));
    const answered = second.frames.length;

    expect(resumed.complete).toBe(false);
    store.resume(resumed);
    await (await send(host, fake, session, "After the resume.")).settled();
    const fresh = await freshSnapshot(second, session);
    applyChanges(store, second.frames.slice(answered, fresh.before));

    expect(store.seq).toBeGreaterThan(resumed.seq);
    expect(store.snapshot()).toEqual(fresh.snapshot);
  });

  it("sends the background row a child changes alone, never a row the client already holds", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const client = await connect(listener);

    await client.call("events.subscribe", { scopes: [`session/${session}`] });
    const read = await readWindow(client, session);
    const answered = client.frames.findIndex((frame) => frame.output === read);
    const store = openSessionStore(decodeOutput("head.read", read));
    const gate = Promise.withResolvers<void>();
    const held = { content: [{ type: "text", text: "Done." }], until: gate.promise } as const;
    fake.reply(held, held);

    const children = [
      await host.sessions.start({ parent: session, content: "One." }),
      await host.sessions.start({ parent: session, content: "Two." }),
    ];

    for (const child of children)
      await client.until(
        (frame) =>
          frame.kind === "change" &&
          changes.Check(frame) &&
          frame.tables.background?.upsert.some((row) => row.item.id === child.session.id) === true,
      );

    const fresh = await freshSnapshot(client, session);
    let sent = 0;

    const resent = client.frames.slice(answered + 1, fresh.before).flatMap((frame) => {
      if (frame.kind !== "change" || !changes.Check(frame)) return [];
      const rows = store.snapshot().rows.background;
      const upserts = frame.tables.background?.upsert ?? [];
      sent += upserts.length;

      const same = upserts.filter(
        (row) => JSON.stringify(rows.get(backgroundRowKey(row))) === JSON.stringify(row),
      );

      store.apply(frame);

      return same;
    });

    expect(sent).toBe(2);
    expect(resent).toEqual([]);
    expect(store.snapshot()).toEqual(fresh.snapshot);
    gate.resolve();

    for (const child of children) await child.receipt.settled();
  });

  it("resumes with the state a child reached while the client was away, without a complete read", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const watcher = await watch(listener, session);
    const gate = Promise.withResolvers<void>();
    fake.reply({ content: [{ type: "text", text: "Done." }], until: gate.promise });
    const started = await host.sessions.start({ parent: session, content: "One." });
    const child = started.session.id;
    await childReaches(watcher, child, "working");
    const store = await readAndDrop(listener, session);

    expect(childState(store.snapshot().rows.background.values(), child)).toBe("working");
    gate.resolve();
    await started.receipt.settled();
    await childReaches(watcher, child, "done");
    const resumed = await reconnect(listener, session, store);

    expect(resumed.complete).toBe(false);
    expect(childState(store.snapshot().rows.background.values(), child)).toBe("done");
    expect(store.snapshot()).toEqual(resumed.fresh);
  });

  it("resumes without the child removed while the client was away", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const watcher = await watch(listener, session);
    fake.reply({ content: [{ type: "text", text: "Done." }] });
    const started = await host.sessions.start({ parent: session, content: "One." });
    const child = started.session.id;
    await started.receipt.settled();
    await childReaches(watcher, child, "done");
    const store = await readAndDrop(listener, session);

    expect(childState(store.snapshot().rows.background.values(), child)).toBe("done");
    await host.session(child).remove();

    await watcher.until(
      (frame) =>
        changes.Check(frame) &&
        frame.tables.background?.drop.some((key) => key.endsWith(`/${child}`)) === true,
    );

    const resumed = await reconnect(listener, session, store);

    expect(resumed.complete).toBe(false);
    expect(childState(store.snapshot().rows.background.values(), child)).toBe(undefined);
    expect(store.snapshot()).toEqual(resumed.fresh);
  });

  it("resumes across a restart with the catalog's new id and none of its content", async () => {
    const store = await fileStore();
    const fake = fakeModels();
    const before = await compose(fake, { store });
    const session = await startSession(before, fake);
    const first = await serve(before);
    const held = await readAndDrop(first, session);
    const old = Array.from(held.snapshot().rows.catalog.keys());
    await first.close();
    await before.close();

    const after = await compose(fake, { store, plugins: GREETER });
    await (await send(after, fake, session, "Again.")).settled();
    const client = await watch(await serve(after), session);
    const output = await readWindow(client, session, held);
    const resumed = decodeOutput("head.read", output);
    held.resume(resumed);
    const ids = Array.from(held.snapshot().rows.catalog.keys());

    expect(old).toHaveLength(1);
    expect(ids).toHaveLength(1);
    expect(ids).not.toEqual(old);
    expect(resumed.complete).toBe(false);
    expect(resumed.tables.catalog).toEqual({ upsert: ids.map((id) => ({ id })), drop: old });
    expect(JSON.stringify(output)).not.toContain('"commands"');
    expect(await client.call("catalogs.read", { id: ids[0] })).toMatchObject(HELLO);
    expect(held.snapshot()).toEqual((await freshSnapshot(client, session)).snapshot);
  });

  it("shows a client of a restarted host the catalog a chat had, with no run on the new host", async () => {
    const store = await fileStore();
    const fake = fakeModels();
    const before = await compose(fake, { store, plugins: GREETER });
    const session = await startSession(before, fake);

    await vi.waitFor(async () =>
      expect((await before.session(session).view()).catalog).toMatchObject(HELLO),
    );
    await before.close();

    const client = await watch(
      await serve(await compose(fake, { store, plugins: GREETER })),
      session,
    );
    const read = decodeOutput("head.read", await readWindow(client, session));
    const id = read.tables.catalog.upsert[0]?.id;
    assert(id !== undefined);

    expect(read.tables.catalog.upsert).toHaveLength(1);
    expect(await client.call("catalogs.read", { id })).toMatchObject(HELLO);
    expect(fake.requests).toHaveLength(1);
  });

  it("sends a streaming part's live text when the text channel opens, then its appends, adding up to the part's text", async () => {
    const harness = await setup();
    const listener = await serve({ ...harness.host, server: createServerHost(harness.kernel) });
    const started = await harness.host.sessions.start({ content: "Write it." });
    const session = started.session.id;
    const step = harness.host.execution.advance({ session, head: main });
    const turn = await harness.script.started(1);
    const run = turn.input.run.id;
    const part = asId<"part">(`${run}:1:0`);
    await livePart(harness.kernel, session, run, part, "Draft");
    publishPatch(harness.kernel, session, run, { kind: "patch", part, append: " one" });

    const client = await connect(listener);
    await client.call("events.subscribe", { scopes: [`session/${session}`] });
    await client.call("text.open", {});

    const texts = (): TextFrame[] =>
      client.frames.filter(
        (frame): frame is TextFrame & JsonSchema =>
          textFrames.Check(frame) && "part" in frame && frame.part === part,
      );

    const written = (): string =>
      texts()
        .map((frame) => ("text" in frame ? frame.text : "append" in frame ? frame.append : ""))
        .join("");

    await client.until(() => texts().length > 0);

    for (const piece of [" two", " three"])
      publishPatch(harness.kernel, session, run, { kind: "patch", part, append: piece });
    await client.until(() => written().endsWith(" three"));
    const view = await harness.host.session(session).view();

    expect(texts()[0]).toMatchObject({ run, text: "Draft one" });
    expect(
      texts()
        .slice(1)
        .every((frame) => "append" in frame),
    ).toBe(true);
    expect(
      view.messages.find((message) => message.kind === "part" && message.part === part),
    ).toMatchObject({ state: { markdown: written() } });
    turn.finish(completed);
    await step;
  });

  it("closes a connection that never reads its socket with backlog", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const raw = await rawConnect(listener, TOKEN);

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

  it.skipIf(process.platform === "win32")(
    "answers a local operation only on the unix socket",
    async () => {
      const host = await compose(fakeModels());
      const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-socket-")));
      cleanups.push(() => rm(home, { recursive: true, force: true }));

      const routes = [
        { route: "http", listener: await serve(host), code: "denied" },
        {
          route: "unix",
          listener: await serve(host, join(home, "host.sock")),
          code: "unavailable",
        },
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
    },
  );

  it("negotiates permessage-deflate only with a peer that addressed the host off loopback", async () => {
    const host = await compose(fakeModels());
    const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-socket-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const tcp = await serve(host);

    const unix =
      process.platform === "win32"
        ? []
        : [
            {
              route: "unix",
              listener: await serve(host, join(home, "host.sock")),
              headers: {},
              extensions: "",
            },
          ];

    const routes = [
      { route: "loopback", listener: tcp, headers: {}, extensions: "" },
      ...unix,
      {
        route: "named",
        listener: tcp,
        headers: { Host: "nyte.example.ts.net" },
        extensions: "permessage-deflate",
      },
    ];

    const negotiated = await Promise.all(
      routes.map(async (entry) => {
        const socket = new WebSocket(socketUrl(entry.listener), {
          headers: { Authorization: `Bearer ${TOKEN}`, ...entry.headers },
        });

        cleanups.push(async () => {
          socket.terminate();
        });
        await once(socket, "open");

        return { route: entry.route, extensions: socket.extensions };
      }),
    );

    expect(negotiated).toEqual(
      routes.map((entry) => ({ route: entry.route, extensions: entry.extensions })),
    );
  });
});

describe("the host scope", () => {
  it("applies the session rows that arrive before sessions.read's answer and ends equal to a fresh read", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const session = await startSession(host, fake);
    const client = await connect(listener);

    await client.call("events.subscribe", { scopes: ["host"] });
    const receipt = await send(host, fake, session, "More.");
    await client.until(hostChange);

    const first = await readDirectory(client);
    const store = openDirectoryStore(first.read);

    expect(applySessions(store, client.frames.slice(0, first.answered))).toBeGreaterThan(0);
    await receipt.settled();
    const added = await startSession(host, fake);
    const fresh = await readDirectory(client);
    await client.until((frame) => hostChange(frame) && Number(frame.seq) >= fresh.read.seq);
    applySessions(store, client.frames.slice(first.answered + 1));

    expect(store.seq).toBe(fresh.read.seq);
    expect(store.snapshot().rows.has(added)).toBe(true);
    expect(store.snapshot().rows).toEqual(openDirectoryStore(fresh.read).snapshot().rows);
  });

  it("resumes the sessions table from its seq, dropping a session removed while away, and ends equal to a fresh read", async () => {
    const fake = fakeModels();
    const host = await compose(fake);
    const listener = await serve(host);
    const kept = await startSession(host, fake);
    const removed = await startSession(host, fake);
    const first = await connect(listener);

    await first.call("events.subscribe", { scopes: ["host"] });
    const store = openDirectoryStore((await readDirectory(first)).read);
    first.socket.terminate();
    await first.closed;

    await (await send(host, fake, kept, "While away.")).settled();
    const added = await startSession(host, fake);
    await host.session(removed).remove();
    const second = await connect(listener);
    await second.call("events.subscribe", { scopes: ["host"] });
    const resumed = await readDirectory(second, store.seq);

    expect(resumed.read.rows.map((row) => row.id).toSorted()).toEqual([added, kept].toSorted());
    store.resume(resumed.read);
    const fresh = await readDirectory(second);
    applySessions(store, second.frames.slice(resumed.answered + 1, fresh.answered));

    expect(store.snapshot().rows.has(removed)).toBe(false);
    expect(store.snapshot()).toEqual(openDirectoryStore(fresh.read).snapshot());
  });

  it("sends host subscribers the host's status and the sessions' activations whole on subscribe", async () => {
    const listener = await serve(await compose(fakeModels()));
    const client = await connect(listener);
    await client.call("events.subscribe", { scopes: ["host"] });

    expect(client.frames.find((frame) => frame.kind === "status")).toEqual({
      c: "e",
      type: "event",
      scope: "host",
      seq: null,
      kind: "status",
      version: expect.any(String),
      startedAt: expect.any(Number),
      listeners: [listener.address],
      tailnet: null,
    });
    expect(client.frames.find((frame) => frame.activations !== undefined)).toMatchObject({
      scope: "host",
      seq: null,
      kind: "live",
    });
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
