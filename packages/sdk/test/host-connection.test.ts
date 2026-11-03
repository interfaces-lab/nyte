import { API_MIN_REVISION, API_REVISION } from "@nyte-ai/schema";
import type { Listener } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { listen } from "@nyte-ai/host";
import { chatOnly, fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openHost } from "../src/host-connection.ts";
import type { Health, HostConnection, OpenSocket, SocketRequest } from "../src/host-connection.ts";

const TOKEN = "a-token-of-at-least-16";

const CLIENT = { kind: "other", name: "sdk-test", version: "1" } as const;

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

function attach(listener: Listener, socket: OpenSocket): HostConnection {
  const connection = openHost(listener.address ?? "", {
    credentials: { kind: "token", token: TOKEN },
    client: CLIENT,
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
