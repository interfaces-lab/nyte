import { API_MIN_REVISION, API_REVISION, asId } from "@nyte-ai/schema";
import type { HeadName, SessionId } from "@nyte-ai/schema";
import { openDirectoryStore, openSessionStore } from "@nyte-ai/protocol";
import type { Listener } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { listen } from "@nyte-ai/host";
import { chatOnly, fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openHost } from "../src/host-connection.ts";
import type { Health, HostConnection, OpenSocket, SocketRequest } from "../src/host-connection.ts";
import type { HeadStore } from "../src/live-head.ts";

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
  const opened: WebSocket[] = [];

  const socket: OpenSocket = (request) => {
    const made = open(request);
    opened.push(made);

    return made;
  };

  return { socket, opened };
}

function global(request: SocketRequest): WebSocket {
  return new WebSocket(request.url, { headers: request.headers });
}

function attach(
  listener: Listener,
  socket: OpenSocket = global,
  input: { readonly name?: string; readonly address?: string; readonly token?: string } = {},
): HostConnection {
  const connection = openHost(input.address ?? listener.address ?? "", {
    credentials: { kind: "token", token: input.token ?? TOKEN },
    client: { ...CLIENT, name: input.name ?? CLIENT.name },
    socket,
  });

  cleanups.push(async () => connection.release());

  return connection;
}

async function until(connection: HostConnection, kind: Health["kind"]): Promise<Health> {
  await vi.waitFor(() => expect(connection.health.snapshot().kind).toBe(kind), { timeout: 5_000 });

  return connection.health.snapshot();
}

describe("openHost", () => {
  it("returns one connection over one socket to every holder of the address, and closes it with the last", async () => {
    const served = await serve();
    const transport = counting();
    const first = attach(served.listener, transport.socket);
    const second = attach(served.listener, transport.socket);

    expect(second).toBe(first);
    await until(first, "open");
    expect(first.hostId).toBe(served.host.server.hostId);
    expect(attach(served.listener, transport.socket)).toBe(first);
    expect(transport.opened).toHaveLength(1);

    first.release();
    first.release();
    first.release();
    await vi.waitFor(() => expect(transport.opened[0]?.readyState).toBe(WebSocket.CLOSED));
    expect(attach(served.listener, transport.socket)).not.toBe(first);
  });

  it("blocks on a version the host does not serve and tries again only when asked", async () => {
    const served = await serve();

    const transport = counting(
      (request) => new NewerClient(request.url, { headers: request.headers }),
    );

    const connection = attach(served.listener, transport.socket);

    expect(await until(connection, "blocked")).toMatchObject({
      reason: "version",
      error: { message: expect.stringMatching(/^Update the host/) },
    });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(transport.opened).toHaveLength(1);

    connection.retry();
    await vi.waitFor(() => expect(transport.opened).toHaveLength(2));
    expect(await until(connection, "blocked")).toMatchObject({ reason: "version" });
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

function watched(connection: HostConnection, session: SessionId): HeadStore {
  const store = connection.head(session, MAIN, { tail: TAIL });
  cleanups.push(async () => store.close());

  return store;
}

async function matchesRead(connection: HostConnection, store: HeadStore, session: SessionId) {
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
    { timeout: 4_000 },
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
    const paired = attach(served.listener, global, { token });
    await until(paired, "open");

    const principal = (await served.host.principals.list())[0]?.id;
    expect(principal).toBeDefined();
    await served.host.principals.revoke(principal ?? asId("none"));
    await until(paired, "retrying");
    paired.retry();

    expect(await until(paired, "blocked")).toMatchObject({
      reason: "auth",
      error: { code: "unauthenticated" },
    });

    const unreachable = openHost("http://127.0.0.1:9", {
      credentials: { kind: "token", token: TOKEN },
      client: CLIENT,
    });

    cleanups.push(async () => unreachable.release());
    expect(await until(unreachable, "retrying")).toMatchObject({ attempt: 1 });
  });
});

describe("a head store", () => {
  it("ends equal to a fresh head.read after the head moves, and keeps unchanged rows", async () => {
    const served = await serve();
    const session = await startSession(served);
    const connection = attach(served.listener);
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
    const connection = attach(served.listener);
    const store = watched(connection, session);

    await matchesRead(connection, store, session);
    served.listener.disconnectClients();

    await vi.waitFor(() => {
      expect(connection.health.snapshot()).toMatchObject({ kind: "retrying", attempt: 1 });
      expect(store.freshness().kind).toBe("stale");
    });

    await send(served, session, "While away.");
    await until(connection, "open");
    await matchesRead(connection, store, session);
  });
});

describe("a sessions store", () => {
  it("resumes the host's session rows after a drop and ends equal to a fresh sessions.read", async () => {
    const served = await serve();
    const first = await startSession(served);
    const connection = attach(served.listener);
    const sessions = connection.directory();
    cleanups.push(async () => sessions.close());

    const matches = () =>
      vi.waitFor(
        async () => {
          const fresh = openDirectoryStore(await connection.call("sessions.read", {})).snapshot();

          expect(sessions.freshness()).toMatchObject({ kind: "fresh" });
          expect({ ids: sessions.snapshot()?.ids, rows: sessions.snapshot()?.rows }).toEqual(fresh);
        },
        { timeout: 4_000 },
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

describe("offer", () => {
  it("answers another connection's client.perform with what the handler returns", async () => {
    const served = await serve();

    const offerer = attach(served.listener, global, { name: "offerer" });
    offerer.offer({ name: "open", summary: "Opens a thing.", input: {} }, (input, requester) => ({
      opened: input,
      by: requester.client,
    }));

    const asker = attach(served.listener, global, {
      name: "asker",
      address: `${served.listener.address ?? ""}/`,
    });

    expect(asker).not.toBe(offerer);
    const clients = asker.clients();
    cleanups.push(async () => clients.close());

    await vi.waitFor(() =>
      expect(
        [...clients.snapshot().values()].find((row) => row.name === "offerer")?.actions,
      ).toEqual([{ name: "open", summary: "Opens a thing.", input: {} }]),
    );

    const target = [...clients.snapshot().values()].find((row) => row.name === "offerer");
    const self = [...clients.snapshot().values()].find((row) => row.name === "asker");

    expect(await asker.perform(target?.id ?? asId("none"), "open", { n: 1 })).toEqual({
      opened: { n: 1 },
      by: self?.id,
    });
  });
});
