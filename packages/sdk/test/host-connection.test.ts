import { API_MIN_REVISION, API_REVISION, asId } from "@nyte-ai/schema";
import type { HeadName, SessionId } from "@nyte-ai/schema";
import { linkLost, openDirectoryStore, openSessionStore } from "@nyte-ai/protocol";
import type { Listener } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { listen } from "@nyte-ai/host";
import { chatOnly, fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "../src/connect.ts";
import type { ClientConnection } from "../src/connect.ts";
import type { OpenSocket, SocketRequest } from "../src/live/host-connection.ts";
import type { LinkState } from "../src/live/link.ts";
import type { ChatSnapshot } from "../src/live/chat.ts";
import type { HeadStore } from "../src/live/head.ts";
import { createSendJournal } from "../src/send/journal.ts";

const TOKEN = "a-token-of-at-least-16";

const CLIENT = { kind: "other", name: "sdk-test", version: "1" } as const;

const MAIN: HeadName = asId("main");

const TAIL = 50;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

class NewerClient extends WebSocket {
  override send(data: string): void {
    super.send(
      data.replace(
        `"api_min_revision":${API_MIN_REVISION}`,
        `"api_min_revision":${API_REVISION + 1}`,
      ),
    );
  }
}

async function serve(fake: FakeModels = fakeModels()) {
  const host = await composeHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });

  cleanups.push(() => host.close());

  const listener = await listen(host, {
    transport: { kind: "http" },
    auth: { kind: "token", token: TOKEN },
  });

  cleanups.push(() => listener.close());

  return { host, listener, fake };
}

function counting(open: (request: SocketRequest) => WebSocket = global) {
  const opened = recorder<WebSocket>();

  const socket: OpenSocket = (request) => {
    const made = open(request);
    opened.record(made);

    return made;
  };

  return { socket, opened: opened.entries, dialed: opened.reached };
}

function recorder<T>() {
  const entries: T[] = [];
  const waiting = new Set<{ readonly count: number; readonly resolve: () => void }>();

  return {
    entries,
    record(entry: T) {
      entries.push(entry);

      for (const waiter of waiting) {
        if (entries.length < waiter.count) continue;
        waiting.delete(waiter);
        waiter.resolve();
      }
    },
    reached: (count: number): Promise<void> => {
      if (entries.length >= count) return Promise.resolve();

      return new Promise((resolve) => waiting.add({ count, resolve }));
    },
  };
}

function global(request: SocketRequest): WebSocket {
  return new WebSocket(request.url, { headers: request.headers });
}

async function attach(
  listener: Listener,
  socket: OpenSocket = global,
  input: {
    readonly name?: string;
    readonly address?: string;
    readonly token?: string;
    readonly fetch?: typeof fetch;
  } = {},
): Promise<ClientConnection> {
  const connection = await connect({
    url: input.address ?? listener.address ?? "",
    credentials: { kind: "token", token: input.token ?? TOKEN },
    client: { ...CLIENT, name: input.name ?? CLIENT.name },
    journal: createSendJournal(),
    transport: { socket, fetch: input.fetch },
  });

  cleanups.push(() => connection.close());

  return connection;
}

async function until(connection: ClientConnection, kind: LinkState["kind"]): Promise<LinkState> {
  await vi.waitFor(() => expect(connection.link.snapshot().kind).toBe(kind), { timeout: 5000 });

  return connection.link.snapshot();
}

describe("a connection's socket", () => {
  it("dials no socket until something live is used, and closes it with the connection", async () => {
    const served = await serve();
    const transport = counting();
    const connection = await attach(served.listener, transport.socket);

    await connection.sessions.list();
    expect(transport.opened).toHaveLength(0);

    await until(connection, "open");
    expect(transport.opened).toHaveLength(1);

    await connection.close();
    await vi.waitFor(() => expect(transport.opened[0]?.readyState).toBe(WebSocket.CLOSED));
    await expect(connection.call("clients.read", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("blocks on a version the host does not serve and tries again only when asked", async () => {
    const served = await serve();

    const transport = counting(
      (request) => new NewerClient(request.url, { headers: request.headers }),
    );

    const connection = await attach(served.listener, transport.socket);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cleanups.push(async () => {
      vi.useRealTimers();
    });

    expect(await until(connection, "refused")).toMatchObject({
      reason: "update-host",
      error: { message: expect.stringMatching(/^Update the host/) },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.opened).toHaveLength(1);

    connection.retry();
    await transport.dialed(2);
    expect(transport.opened).toHaveLength(2);
    expect(await until(connection, "refused")).toMatchObject({ reason: "update-host" });
  });

  it("closes for good a socket another host answers at the same address", async () => {
    const first = await serve();
    const other = await serve();
    const away = new URL(other.listener.address ?? "").host;

    const transport = counting((request) => {
      const url = new URL(request.url);
      url.host = away;

      return new WebSocket(url.href, { headers: request.headers });
    });

    const connection = await attach(first.listener, transport.socket);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cleanups.push(async () => {
      vi.useRealTimers();
    });

    expect(await until(connection, "refused")).toMatchObject({
      reason: "other-host",
      error: { code: "stale" },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.opened).toHaveLength(1);
  });
});

type Served = Awaited<ReturnType<typeof serve>>;

async function startSession(served: Served): Promise<SessionId> {
  served.fake.reply({ content: [{ type: "text", text: "Hello." }] });
  const started = await served.host.sessions.start({ content: "Hi." });
  await started.receipt.settled();

  return started.session.id;
}

async function send(served: Served, session: SessionId, text: string): Promise<void> {
  served.fake.reply({ content: [{ type: "text", text: `Re: ${text}` }] });
  await (await served.host.session(session).head(MAIN).send(text)).settled();
}

function watched(connection: ClientConnection, session: SessionId): HeadStore {
  const store = connection.head(session, MAIN, { tail: TAIL });
  cleanups.push(async () => store.close());

  return store;
}

async function matchesRead(connection: ClientConnection, store: HeadStore, session: SessionId) {
  await vi.waitFor(
    async () => {
      const window = await connection.call("head.read", {
        session,
        head: MAIN,
        window: { tail: TAIL },
      });

      const snapshot = store.snapshot();

      expect(store.freshness()).toMatchObject({ kind: "fresh" });
      expect({
        order: snapshot?.order,
        leadingPrompt: snapshot?.leadingPrompt,
        rows: snapshot?.rows,
        activation: snapshot?.activation,
      }).toEqual({ ...openSessionStore(window).snapshot(), activation: window.live.activation });
    },
    { timeout: 4000 },
  );
}

describe("a refused login", () => {
  it("blocks on auth once the host revokes the credential, and keeps retrying a network failure", async () => {
    const served = await serve();
    const address = served.listener.address ?? "";
    const code = (await served.host.principals.pair({ authority: new Set(["participant"]) })).code;

    const exchanged = await fetch(`${address}/clients.read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Pairing ${code}` },
      body: "{}",
    });

    const token = exchanged.headers.get("X-Nyte-Credential") ?? "";
    const paired = await attach(served.listener, global, { token });
    await until(paired, "open");

    const principal = (await served.host.principals.list())[0]?.id;
    expect(principal).toBeDefined();
    await served.host.principals.revoke(principal ?? asId("none"));
    await until(paired, "away");
    paired.retry();

    expect(await until(paired, "refused")).toMatchObject({
      reason: "auth",
      error: { code: "unauthenticated" },
    });

    const unreachable = await attach(served.listener, () => new WebSocket("ws://127.0.0.1:9"));
    expect(await until(unreachable, "away")).toMatchObject({ reason: "lost" });
  });
});

describe("a head store", () => {
  it("ends equal to a fresh head.read after the head moves, and keeps unchanged rows", async () => {
    const served = await serve();
    const session = await startSession(served);
    const connection = await attach(served.listener);
    const store = watched(connection, session);
    const notified: number[] = [];
    store.subscribe(() => notified.push(notified.length));

    await matchesRead(connection, store, session);
    const before = store.snapshot();
    await send(served, session, "More.");
    await matchesRead(connection, store, session);

    const after = store.snapshot();
    const first = before?.order[0];

    expect(after?.order.length).toBeGreaterThan(before?.order.length ?? 0);
    expect(first === undefined ? undefined : after?.rows.messages.get(first)).toBe(
      first === undefined ? undefined : before?.rows.messages.get(first),
    );
    expect(notified.length).toBeGreaterThan(1);
  });

  it("goes stale when the host drops the socket and fresh again once it resumes on the next one", async () => {
    const served = await serve();
    const session = await startSession(served);
    const connection = await attach(served.listener);
    const store = watched(connection, session);

    await matchesRead(connection, store, session);
    served.listener.disconnectClients();

    await vi.waitFor(() => {
      expect(connection.link.snapshot()).toMatchObject({ kind: "away", reason: "lost" });
      expect(store.freshness().kind).toBe("stale");
    });

    await send(served, session, "While away.");
    await until(connection, "open");
    await matchesRead(connection, store, session);
  });

  it("goes stale with unknown when its session is removed while the connection holds a session list, and keeps its rows", async () => {
    const served = await serve();
    const session = await startSession(served);
    const connection = await attach(served.listener);
    const sessions = connection.sessions.open();
    cleanups.push(async () => sessions.close());
    const store = watched(connection, session);

    await matchesRead(connection, store, session);
    const shown = store.snapshot()?.order;
    expect(await served.host.session(session).remove()).toEqual({ kind: "removed" });

    await vi.waitFor(() =>
      expect(store.freshness()).toMatchObject({ kind: "stale", error: { code: "unknown" } }),
    );
    expect(store.snapshot()?.order).toBe(shown);
  });

  it("opens a head whose window passes maxFrameBytes with its whole message, and the connection stays open", async () => {
    const served = await serve();
    const session = await startSession(served);
    const text = "x".repeat(1_200_000);
    await send(served, session, text);
    const connection = await attach(served.listener);
    await until(connection, "open");
    const kinds: LinkState["kind"][] = [];
    connection.link.subscribe(() => kinds.push(connection.link.snapshot().kind));
    const store = watched(connection, session);

    await vi.waitFor(() => expect(store.freshness().kind).toBe("fresh"), { timeout: 10_000 });
    const messages = Array.from(store.snapshot()?.rows.messages.values() ?? []);

    expect(messages.some((row) => row.kind === "user" && row.content === text)).toBe(true);
    expect(kinds.filter((kind) => kind !== "open")).toEqual([]);
  }, 30_000);
});

describe("a reconnect", () => {
  it("retries a host that welcomed it again on the first delay after every drop", async () => {
    const served = await serve();
    const connection = await attach(served.listener);
    await until(connection, "open");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cleanups.push(async () => {
      vi.useRealTimers();
    });

    for (const drop of [1, 2, 3]) {
      served.listener.disconnectClients();
      const retrying = await until(connection, "away");

      expect({ drop, retrying }).toMatchObject({ drop, retrying: { reason: "lost" } });
      expect(retrying.kind === "away" && retrying.retryAt - Date.now()).toBeLessThanOrEqual(1000);
      vi.advanceTimersByTime(1000);
      await until(connection, "open");
    }
  });

  it("keeps one socket when a link listener wakes the connection as it goes away", async () => {
    const served = await serve();
    const transport = counting();
    const connection = await attach(served.listener, transport.socket);
    await until(connection, "open");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cleanups.push(async () => {
      vi.useRealTimers();
    });

    connection.link.subscribe(() => {
      if (connection.link.snapshot().kind === "away") connection.retry();
    });
    served.listener.disconnectClients();
    await transport.dialed(2);
    expect(transport.opened).toHaveLength(2);
    await until(connection, "open");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(transport.opened.map((socket) => socket.readyState)).toEqual([
      WebSocket.CLOSED,
      WebSocket.OPEN,
    ]);
  });
});

function deafening() {
  const transport = counting();
  const dead = new Set<WebSocket>();
  const owed = new Set<string>();

  const socket: OpenSocket = (request) => {
    const made = transport.socket(request);

    if (!(made instanceof WebSocket)) return made;
    made.addEventListener("message", (event) => {
      if (dead.has(made)) event.stopImmediatePropagation();
      else owed.delete(frameId(String(event.data)));
    });
    const send = made.send.bind(made);

    return Object.assign(made, {
      send(data: string) {
        if (dead.has(made)) return;
        owed.add(frameId(data));
        send(data);
      },
    });
  };

  return {
    socket,
    opened: transport.opened,
    owed: () => [...owed].filter((id) => id !== ""),
    cut() {
      for (const made of transport.opened) dead.add(made);
    },
  };
}

function frameId(data: string): string {
  return /"id":"([^"]+)"/.exec(data)?.[1] ?? "";
}

describe("a silent link", () => {
  it.each([
    { case: "while idle", call: false, retry: false, alive: 29_999, lost: 40_000 },
    { case: "with a call pending", call: true, retry: false, alive: 14_999, lost: 15_000 },
    { case: "when asked to retry", call: false, retry: true, alive: 1999, lost: 2000 },
  ] as const)(
    "is found $case, fails the pending call as a lost link, and resumes on a new socket",
    async (row) => {
      const served = await serve();
      const session = await startSession(served);
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "Date"],
        shouldClearNativeTimers: true,
      });
      cleanups.push(async () => {
        vi.useRealTimers();
      });
      const transport = deafening();
      const connection = await attach(served.listener, transport.socket);
      const store = watched(connection, session);
      await matchesRead(connection, store, session);

      if (row.retry) connection.retry();
      await vi.waitFor(() => expect(transport.owed()).toEqual([]));
      await vi.advanceTimersByTimeAsync(5000);
      expect(connection.link.snapshot().kind).toBe("open");
      expect(transport.opened).toHaveLength(1);

      transport.cut();
      await send(served, session, "While away.");

      const pending = row.call
        ? connection.call("clients.read", {}).catch((error: unknown) => error)
        : null;

      if (row.retry) connection.retry();
      await vi.advanceTimersByTimeAsync(row.alive);
      expect(connection.link.snapshot().kind).toBe("open");
      await vi.advanceTimersByTimeAsync(row.lost - row.alive);
      expect(connection.link.snapshot().kind).not.toBe("open");
      expect(store.freshness().kind).toBe("stale");

      if (pending !== null) expect(linkLost(await pending)).toBe(true);
      await until(connection, "open");
      await matchesRead(connection, store, session);
      expect(transport.opened).toHaveLength(2);
    },
    30_000,
  );
});

describe("a failed read", () => {
  it("leaves the store stale with the read's error and retries it while the socket stays open", async () => {
    const served = await serve();
    const session = await startSession(served);
    let failed = false;

    const connection = await attach(served.listener, (request) => {
      const socket = global(request);
      const send = socket.send.bind(socket);

      return Object.assign(socket, {
        send(data: string) {
          const breaks = !failed && data.includes('"op":"head.read"');
          failed ||= breaks;
          send(breaks ? data.replace(`"tail":${TAIL}`, '"tail":"many"') : data);
        },
      });
    });

    const store = watched(connection, session);

    await vi.waitFor(() =>
      expect(store.freshness()).toMatchObject({ kind: "stale", error: { code: "invalid" } }),
    );
    expect(connection.link.snapshot().kind).toBe("open");
    await matchesRead(connection, store, session);
  });
});

describe("a sessions store", () => {
  it("resumes the host's session rows after a drop and ends equal to a fresh sessions.read", async () => {
    const served = await serve();
    const first = await startSession(served);
    const connection = await attach(served.listener);
    const sessions = connection.sessions.open();
    cleanups.push(async () => sessions.close());

    const matches = () =>
      vi.waitFor(
        async () => {
          const fresh = openDirectoryStore(await connection.call("sessions.read", {})).snapshot();

          expect(sessions.freshness()).toMatchObject({ kind: "fresh" });
          expect({ ids: sessions.snapshot()?.ids, rows: sessions.snapshot()?.rows }).toEqual(fresh);
        },
        { timeout: 4000 },
      );

    await matches();
    expect(sessions.snapshot()?.ids).toEqual([first]);
    served.listener.disconnectClients();
    await vi.waitFor(() => expect(sessions.freshness().kind).toBe("stale"));

    const second = await startSession(served);
    await until(connection, "open");
    await matches();
    expect(sessions.snapshot()?.ids).toEqual([second, first]);
  });
});

describe("a sessions store's order", () => {
  it("moves a session from outside the limit into its ids, adds a new one and drops a removed one, without a read", async () => {
    const served = await serve();
    const older = await startSession(served);
    const middle = await startSession(served);
    const newer = await startSession(served);
    const reads: string[] = [];

    const connection = await attach(served.listener, (request) => {
      const socket = global(request);
      const send = socket.send.bind(socket);

      return Object.assign(socket, {
        send(data: string) {
          if (data.includes('"op":"sessions.read"')) reads.push(data);
          send(data);
        },
      });
    });

    const sessions = connection.sessions.open({ limit: 2 });
    cleanups.push(async () => sessions.close());
    const ids = () => sessions.snapshot()?.ids;

    await vi.waitFor(() => expect(ids()).toEqual([newer, middle]));
    await send(served, older, "Back again.");
    await vi.waitFor(() => expect(ids()).toEqual([older, newer]));

    const added = await startSession(served);
    await vi.waitFor(() => expect(ids()).toEqual([added, older]));
    await served.host.session(added).remove();
    await vi.waitFor(() => expect(ids()).toEqual([older, newer]));
    expect(reads).toHaveLength(1);
  });
});

function recording(frames: string[]) {
  return class extends WebSocket {
    override send(data: string): void {
      frames.push(data);
      super.send(data);
    }

    override dispatchEvent(event: Event): boolean {
      if (event instanceof MessageEvent) frames.push(String(event.data));

      return super.dispatchEvent(event);
    }
  };
}

describe("a resume", () => {
  it("describes what it holds to the host, and ends equal to a fresh read", async () => {
    const served = await serve();
    const session = await startSession(served);
    const frames: string[] = [];
    const Socket = recording(frames);

    const connection = await attach(
      served.listener,
      (request) => new Socket(request.url, { headers: request.headers }),
    );

    const sessions = connection.sessions.open();
    cleanups.push(async () => sessions.close());
    const store = watched(connection, session);

    await matchesRead(connection, store, session);
    await vi.waitFor(() => expect(sessions.freshness().kind).toBe("fresh"));
    const first = frames.length;
    served.listener.disconnectClients();
    await vi.waitFor(() => expect(store.freshness().kind).toBe("stale"));
    await send(served, session, "While away.");
    await until(connection, "open");
    await matchesRead(connection, store, session);
    await vi.waitFor(() => expect(sessions.freshness().kind).toBe("fresh"));

    const resumes = frames
      .slice(first)
      .filter((frame) => /"op":"(head|sessions)\.read","input":\{.*"resume"/u.test(frame));

    const answers = frames.slice(first).filter((frame) => frame.includes('"kept":'));

    expect(resumes).toHaveLength(2);
    expect(resumes.filter((frame) => frame.includes('"held":'))).toHaveLength(2);
    expect(answers).toHaveLength(2);
  });
});

describe("offer", () => {
  it("answers another connection's client.perform with what the handler returns", async () => {
    const served = await serve();

    const offerer = await attach(served.listener, global, { name: "offerer" });
    offerer.offer({ name: "open", summary: "Opens a thing.", input: {} }, (input, requester) => ({
      opened: input,
      by: requester.client,
    }));

    const asker = await attach(served.listener, global, {
      name: "asker",
      address: `${served.listener.address ?? ""}/`,
    });

    const clients = asker.clients.open();
    cleanups.push(async () => clients.close());

    await vi.waitFor(() =>
      expect(
        [...clients.snapshot().values()].find((row) => row.name === "offerer")?.actions,
      ).toEqual([{ name: "open", summary: "Opens a thing.", input: {} }]),
    );

    const target = [...clients.snapshot().values()].find((row) => row.name === "offerer");
    const self = [...clients.snapshot().values()].find((row) => row.name === "asker");

    expect(await asker.client(target?.id ?? asId("none")).perform("open", { n: 1 })).toEqual({
      opened: { n: 1 },
      by: self?.id,
    });
  });

  it("declares every action offered as soon as connect resolves in its first hello", async () => {
    const served = await serve();
    let dialed = 0;

    const offerer = await attach(
      served.listener,
      (request) => {
        dialed += 1;

        return global(request);
      },
      { name: "offerer" },
    );

    for (const name of ["one", "two", "three"]) {
      offerer.offer({ name, summary: "", input: {} }, () => null);
    }

    const asker = await attach(served.listener, global, { name: "asker" });

    await vi.waitFor(async () =>
      expect(
        (await asker.clients.read())
          .find((row) => row.name === "offerer")
          ?.actions.map((action) => action.name),
      ).toEqual(["one", "two", "three"]),
    );
    expect(dialed).toBe(1);
  });
});

function operations() {
  const sent = new Map<string, number>();

  const socket: OpenSocket = (request) => {
    const made = global(request);
    const send = made.send.bind(made);

    return Object.assign(made, {
      send(data: string) {
        const op = /"op":"([^"]+)"/u.exec(data)?.[1];

        if (op !== undefined) sent.set(op, (sent.get(op) ?? 0) + 1);
        send(data);
      },
    });
  };

  return { socket, sent: (op: string) => sent.get(op) ?? 0 };
}

function slowStops() {
  const held = recorder<PromiseWithResolvers<"answer" | "fail">>();

  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);

    if (new URL(request.url).pathname.endsWith("/run.stop")) {
      const gate = Promise.withResolvers<"answer" | "fail">();
      held.record(gate);

      if ((await gate.promise) === "fail") throw new TypeError("fetch failed");
    }

    return fetch(request);
  };

  return { fetch: send, held: held.entries, reached: held.reached };
}

async function working(served: Served, session: SessionId): Promise<void> {
  served.fake.reply({ content: [{ type: "text", text: "Working." }], hold: true });
  await (await served.host.session(session).send("Go.")).landed();
}

describe("a chat", () => {
  it("holds nothing until its first listener, keeps its snapshot until something drawn changes, and closes everything when the last leaves", async () => {
    const served = await serve();
    const first = await startSession(served);
    const second = await startSession(served);
    const counted = operations();
    const connection = await attach(served.listener, counted.socket);
    const chat = connection.chat(first);
    const other = connection.chat(second);
    await until(connection, "open");

    expect(counted.sent("head.read")).toBe(0);

    const drawn: ChatSnapshot[] = [];
    const elsewhere: ChatSnapshot[] = [];
    const leave = [
      chat.subscribe(() => drawn.push(chat.snapshot())),
      chat.subscribe(() => undefined),
      other.subscribe(() => elsewhere.push(other.snapshot())),
    ];

    await vi.waitFor(() => {
      expect(chat.snapshot().freshness.kind).toBe("fresh");
      expect(other.snapshot().freshness.kind).toBe("fresh");
    });
    expect(counted.sent("head.read")).toBe(2);
    expect(chat.snapshot()).toBe(chat.snapshot());

    const answer = "A streamed answer in many pieces. ".repeat(12);
    const streamedFrom = drawn.length;
    const quiet = elsewhere.length;
    served.fake.reply({
      content: [{ type: "text", text: answer }],
      tokens: 60,
      timing: { deltaMs: 2 },
    });
    await (await served.host.session(first).send("Stream.")).settled();

    await vi.waitFor(() =>
      expect(
        chat
          .snapshot()
          .view?.messages.some(
            (message) =>
              message.kind === "part" && JSON.stringify(message.state).includes(answer.trim()),
          ),
      ).toBe(true),
    );

    const streamed = drawn.slice(streamedFrom);

    expect(streamed.length).toBeGreaterThan(2);
    expect(
      streamed.every((shown, index) => shown !== (streamed[index - 1] ?? drawn[streamedFrom - 1])),
    ).toBe(true);
    expect(elsewhere.length).toBe(quiet);

    for (const stop of leave) stop();
    await vi.waitFor(() => expect(counted.sent("events.unsubscribe")).toBe(2));
    expect(chat.snapshot().view).toBeNull();
  });

  it("shows a stop as asked at once, sends it once, and hands over to the host's row without claiming the run stopped", async () => {
    const served = await serve();
    const session = await startSession(served);
    const stops = slowStops();
    const connection = await attach(served.listener, global, { fetch: stops.fetch });
    const chat = connection.chat(session);
    const seen: ChatSnapshot[] = [];
    chat.subscribe(() => seen.push(chat.snapshot()));
    await working(served, session);
    await vi.waitFor(() => expect(chat.snapshot().view?.execution.kind).toBe("live"));

    const asked = seen.length;
    const stopping = chat.stop();
    expect(chat.snapshot().stopping).toBe("asked");
    await chat.stop();
    await stops.reached(1);
    expect(stops.held).toHaveLength(1);
    stops.held[0]?.resolve("answer");
    await stopping;

    await vi.waitFor(() => expect(chat.snapshot().view?.execution.kind).toBe("idle"));

    const kinds = seen
      .slice(asked)
      .map((shown) => shown.stopping)
      .filter((kind, index, all) => kind !== all[index - 1]);

    expect(stops.held).toHaveLength(1);
    expect(kinds[0]).toBe("asked");
    expect(kinds.at(-1)).toBe("no");
    expect(kinds.filter((kind) => kind === "asked")).toHaveLength(1);
    expect(
      seen.filter((shown) => shown.stopping === "asked").map((shown) => shown.view?.execution.kind),
    ).not.toContain("idle");
  });

  it("clears an asked stop when the link's health changes, and reports only the latest stop's failure", async () => {
    const served = await serve();
    const session = await startSession(served);
    const stops = slowStops();
    const connection = await attach(served.listener, global, { fetch: stops.fetch });
    const chat = connection.chat(session);
    chat.subscribe(() => undefined);
    await working(served, session);
    await vi.waitFor(() => expect(chat.snapshot().view?.execution.kind).toBe("live"));

    const first = chat.stop();
    expect(chat.snapshot().stopping).toBe("asked");
    served.listener.disconnectClients();
    await vi.waitFor(() => expect(chat.snapshot().stopping).toBe("no"));
    await until(connection, "open");

    const second = chat.stop();
    expect(chat.snapshot().stopping).toBe("asked");
    await stops.reached(2);
    expect(stops.held).toHaveLength(2);

    stops.held[0]?.resolve("fail");
    await expect(first).resolves.toBeUndefined();
    expect(chat.snapshot().stopping).toBe("asked");

    stops.held[1]?.resolve("fail");
    await expect(second).rejects.toMatchObject({ code: "unavailable" });
    expect(chat.snapshot().stopping).toBe("no");
  });
});
