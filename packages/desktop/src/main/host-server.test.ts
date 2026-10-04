/**
 * The desktop reaching a server: `@nyte-ai/server` over a real `createNyte`
 * on a loopback listener, the desktop host connecting to it, and every
 * session operation routed by ownership rather than by the selected folder.
 * The server runs its own sessions, so the desktop attaches nothing.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type { Nyte } from "@nyte-ai/core";
import { localEnvironmentPlugin } from "@nyte-ai/core/plugins";
import { SqliteStore } from "@nyte-ai/core/store";
import { createNyteServer } from "@nyte-ai/server";
import type { NyteServer } from "@nyte-ai/server";
import type { ServerDescription, SessionInfo } from "@nyte-ai/protocol";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { cloudSessions } from "@nyte-ai/app/bridge.ts";
import type { WatchEnvelope } from "../shared/ipc.ts";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";

const TOKEN = "desktop-server-test-token";

const model: Model<Api> = {
  id: "echo",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const description: ServerDescription = {
  capabilities: { workspace: false },
  persistence: "ephemeral",
};

const alternate = {
  ...model,
  id: "remote-choice",
  name: "Remote choice",
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: null, xhigh: null, max: null },
  cost: { input: 3, output: 9, cacheRead: 0.3, cacheWrite: 1 },
} satisfies Model<Api>;

const unavailable = { ...model, id: "unavailable", name: "Unavailable" };

/** The desktop's own catalog: one offline model, never streamed, so Home can compose. */
function localModels(): MutableModels {
  const localModel = { ...model, provider: "desktop", id: "local-only", name: "Desktop only" };

  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });

  const stream = () => {
    throw new Error("Local models are not streamed by server tests");
  };

  models.setProvider({
    id: localModel.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [localModel],
    stream,
    streamSimple: stream,
  });

  return models;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(Buffer.from(chunk));

  return new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([name, value]) =>
      value === undefined
        ? []
        : Array.isArray(value)
          ? value.map((v) => [name, v])
          : [[name, value]],
    ),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
}

/** Answer now but deliver later: the reply is what the server said when asked, however stale by then. */
async function capture(
  server: NyteServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<() => void> {
  const response = await server.fetch(await toRequest(req));
  const body = await response.text();

  return () => {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);
  };
}

/** Bridge one Node request to the Web handler, streaming the response so SSE frames arrive as sent. */
async function serve(server: NyteServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const response = await server.fetch(await toRequest(req));
  res.writeHead(response.status, Object.fromEntries(response.headers));

  if (response.body === null) {
    res.end();

    return;
  }

  const reader = response.body.getReader();
  // The request's own `close` fires once its body is read; only the response's means the client left.
  res.on("close", () => void reader.cancel().catch(() => undefined));

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    res.write(value);
  }

  res.end();
}

/** Script only the provider; the server, runner, store, HTTP, and desktop routing are real. */
async function remoteHost(phase: "done" | "failed" = "done"): Promise<{
  baseUrl: string;
  sdk: Nyte;
  server: NyteServer;
}> {
  const store = new SqliteStore(":memory:", { watchPollIntervalMs: 5 });

  const sdk = await createNyte({
    store,
    streamFn: () => {
      if (phase === "failed") throw new Error("No provider on this server");

      const answer: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "Hello from the server" }],
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };

      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello from the server",
        partial: answer,
      });
      stream.push({ type: "done", reason: "stop", message: answer });

      return stream;
    },
    models: {
      getModels: () => [model, alternate, unavailable],
      getModel: (provider, id) =>
        [model, alternate, unavailable].find(
          (item) => item.provider === provider && item.id === id,
        ),
      getAvailable: async () => [model, alternate],
    },
    model,
    plugins: [localEnvironmentPlugin({ id: "test" })],
    defaultWorkspace: { kind: "local", id: "test", cwd: "/" },
  });

  sdk.attach();

  const server = createNyteServer({
    sdk,
    version: "test",
    auth: { kind: "token", token: TOKEN },
    describe: () => description,
  });

  const listener = createServer((req, res) => void serve(server, req, res));
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();

  if (!Value.Check(Type.Object({ port: Type.Number() }), address)) throw new Error("No address");
  cleanups.push(
    () => new Promise<void>((resolve) => listener.close(() => resolve())),
    () => server.close(),
    () => sdk.close(),
    () => store.close(),
  );

  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, sdk, server };
}

async function desktop(): Promise<{
  host: DesktopHost;
  events: HostEvent[];
  watchEvents: WatchEnvelope[];
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-server-")));
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  const events: HostEvent[] = [];
  const watchEvents: WatchEnvelope[] = [];

  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: localModels,
    emitHostEvent: (event) => events.push(event),
    emitWatchEvent: (event) => watchEvents.push(event),
    openExternal: () => undefined,
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    confirmExternal: () => Promise.resolve("cancel"),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser is not used by server tests");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      releaseWindow: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });

  cleanups.push(
    () => host.close(),
    () => rm(root, { recursive: true, force: true }),
  );

  return { host, events, watchEvents };
}

test("connecting proves the token before saving it", async () => {
  const { baseUrl } = await remoteHost();
  const { host, events } = await desktop();
  assert.deepEqual(await host.call(1, "host.server.state", undefined), { kind: "none" });

  const refused = await host.call(1, "host.server.connect", {
    baseUrl,
    token: "wrong-token-000000",
  });

  assert.equal(refused.kind, "failed");
  assert.deepEqual(await host.call(1, "host.server.state", undefined), { kind: "none" });
  assert.equal(events.length, 0);

  const outcome = await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  assert.deepEqual(outcome, { kind: "connected", baseUrl, version: "test" });
  const saved = await host.call(1, "host.server.state", undefined);
  assert.equal(saved.kind, "connected");

  if (saved.kind === "connected") {
    assert.equal(saved.baseUrl, baseUrl);
    assert.deepEqual(saved.provider, {
      model: { provider: "echo", id: "echo" },
      auth: { kind: "unverified", source: "echo" },
    });
  }

  assert.deepEqual(events, [{ kind: "server_changed" }]);
});

test("a stored server becomes unavailable without erasing its last loaded Cloud chats", async () => {
  const { baseUrl, server } = await remoteHost();
  const { host } = await desktop();
  await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  const session = await host.call(1, "host.server.createSession", undefined);

  const first = (await host.call(1, "host.sessionDirectory", undefined)).directories.find(
    (entry) => entry.environment === "cloud",
  );

  assert.equal(first?.availability.kind, "ready");
  server.close();

  const state = await host.call(1, "host.server.state", undefined);
  assert.equal(state.kind, "unavailable");

  // The snapshot answers from the model; the sweep it starts reports the failure when it lands.
  const directory = await vi.waitFor(async () => {
    const cloud = (await host.call(1, "host.sessionDirectory", undefined)).directories.find(
      (entry) => entry.environment === "cloud",
    );

    assert.equal(cloud?.availability.kind, "unavailable");

    return cloud;
  });

  assert.deepEqual(
    directory?.sessions.map((item) => item.sessionId),
    [session.sessionId],
  );
});

test("Cloud model choices come from the server while local model preferences stay local", async () => {
  const { baseUrl } = await remoteHost();
  const { host } = await desktop();
  await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  const session = await host.call(1, "host.server.createSession", undefined);
  const local = await host.call(1, "host.catalog", undefined);
  assert.equal(local.source, "local");
  assert.deepEqual(
    local.models.map((item) => item.key),
    ["desktop/local-only"],
  );
  const remote = await host.call(1, "host.catalog", { sessionId: session.sessionId });
  assert.equal(remote.source, "server");
  assert.deepEqual(
    remote.models.filter((item) => item.listed).map((item) => item.key),
    ["echo/echo", "echo/remote-choice"],
  );
  assert.ok(remote.defaults);
  assert.equal(remote.defaults.model.id, model.id);
  const choice = remote.models.find((item) => item.id === alternate.id);
  assert.ok(choice);
  assert.equal(choice.cost.input, 3);
  assert.ok(choice.thinkingLevels.includes("high"));
  assert.ok(!choice.thinkingLevels.includes("off"));
  await host.call(1, "sessions.configure", {
    sessionId: session.sessionId,
    model: { provider: choice.provider, id: choice.id },
    thinkingLevel: "high",
  });
  const configured = await host.call(1, "sessions.get", { sessionId: session.sessionId });
  assert.equal(configured?.config.model?.id, choice.id);
  assert.equal(configured?.config.thinkingLevel, "high");
});

test.each(["done", "failed"] as const)(
  "a server session is created, listed, and watched until its run is %s",
  async (phase) => {
    const { baseUrl, sdk } = await remoteHost(phase);
    const { host, watchEvents } = await desktop();
    await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });

    const created = await host.call(1, "host.server.createSession", undefined);
    const { directories } = await host.call(1, "host.sessionDirectory", undefined);
    assert.deepEqual(
      cloudSessions(directories)?.map((session) => session.sessionId),
      [created.sessionId],
    );
    // The server owns it: the desktop's own stores never see it.
    assert.equal(
      (await sdk.sessions.get({ sessionId: created.sessionId }))?.sessionId,
      created.sessionId,
    );
    assert.equal(
      directories.some(
        (entry) =>
          entry.environment === "local" &&
          entry.sessions.some((session) => session.sessionId === created.sessionId),
      ),
      false,
    );

    host.watchStart(1, { watchId: "cloud", sessionId: created.sessionId, live: true });
    // Live watches omit earlier events. Wait for the subscription before the fast fixture replies.
    await vi.waitFor(() => {
      assert.ok(
        watchEvents.some(
          (envelope) => envelope.kind === "event" && envelope.event.kind === "synced",
        ),
      );
    });

    const receipt = await host.call(1, "messages.send", {
      sessionId: created.sessionId,
      content: "hello",
    });

    assert.equal(receipt.kind, "queued");
    await vi.waitFor(() => {
      const settled = watchEvents.some(
        (envelope) =>
          envelope.kind === "event" &&
          envelope.event.kind === "run" &&
          envelope.event.run.phase.kind === phase,
      );

      assert.ok(settled, `the server's runner reached ${phase}`);
    });
    host.watchStop("cloud");

    if (phase === "done") {
      assert.ok(
        watchEvents.some(
          (envelope) =>
            envelope.kind === "event" &&
            envelope.event.kind === "text_delta" &&
            envelope.event.delta === "Hello from the server",
        ),
      );
      const snapshot = await host.call(1, "sessions.snapshot", { sessionId: created.sessionId });
      assert.deepEqual(
        snapshot?.transcript.flatMap((turn) =>
          turn.kind === "turn"
            ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
            : [],
        ),
        ["Hello from the server"],
      );
    }

    await host.call(1, "host.server.disconnect", undefined);
    assert.equal(
      cloudSessions((await host.call(1, "host.sessionDirectory", undefined)).directories),
      undefined,
    );
  },
);

test("disconnecting ends a live cloud watch the renderer never stopped", async () => {
  const { baseUrl } = await remoteHost();
  const { host, watchEvents } = await desktop();
  await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  const created = await host.call(1, "host.server.createSession", undefined);

  host.watchStart(1, { watchId: "cloud", sessionId: created.sessionId, live: true });
  await vi.waitFor(() => {
    assert.ok(
      watchEvents.some((envelope) => envelope.kind === "event" && envelope.event.kind === "synced"),
    );
  });

  // The renderer keeps its subscription across a disconnect, so the host has to
  // end the stream itself rather than leave it reading the old server.
  await host.call(1, "host.server.disconnect", undefined);
  await vi.waitFor(() => {
    const ended = watchEvents.find((envelope) => envelope.kind === "ended");
    assert.ok(ended, "the watch reported that it ended");
    assert.equal(ended.error?.code, "closed");
  });

  const settled = watchEvents.length;
  await host.call(1, "host.server.createSession", undefined).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(watchEvents.length, settled, "no event arrives after the watch ended");
});

test("a stalled server list neither holds the snapshot nor undoes a row a watch already moved", async () => {
  const { server } = await remoteHost();
  // A proxy in front of the real server: session lists are answered at once but delivered on release.
  const held: Promise<() => void>[] = [];
  let stalled = false;

  const proxy = createServer((req, res) => {
    if (stalled && req.url?.endsWith("/sessions.list") === true) {
      held.push(capture(server, req, res));

      return;
    }

    void serve(server, req, res);
  });

  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();

  if (!Value.Check(Type.Object({ port: Type.Number() }), address)) throw new Error("No address");
  cleanups.push(async () => {
    for (const release of await Promise.all(held)) release();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  const { host, events } = await desktop();
  await host.call(1, "host.server.connect", {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    token: TOKEN,
  });
  const session = await host.call(1, "host.server.createSession", undefined);
  assert.deepEqual(
    cloudSessions((await host.call(1, "host.sessionDirectory", undefined)).directories)?.map(
      (item) => item.sessionId,
    ),
    [session.sessionId],
  );

  stalled = true;
  const startedAt = performance.now();
  const { directories } = await host.call(1, "host.sessionDirectory", undefined);
  assert.ok(performance.now() - startedAt < 1_000, "the snapshot answered from the model");
  assert.ok(directories.some((entry) => entry.environment === "local"));
  const cloud = directories.find((entry) => entry.environment === "cloud");
  assert.equal(cloud?.availability.kind, "ready");
  assert.deepEqual(
    cloud?.sessions.map((item) => item.sessionId),
    [session.sessionId],
  );
  await vi.waitFor(() => assert.equal(held.length, 1, "the stalled list stays in flight"));

  // The server's runner moves the session while its list is held; the desktop's
  // watch pushes the change, and the stale list must not put the old row back.
  const finished = (row: SessionInfo) => row.heads.some((head) => head.run?.phase.kind === "done");
  await host.call(1, "messages.send", { sessionId: session.sessionId, content: "hello" });
  await vi.waitFor(() => {
    const pushed = events.flatMap((event) =>
      event.kind === "session_directory"
        ? event.changes.flatMap((change) =>
            change.kind === "upsert" && change.session.sessionId === session.sessionId
              ? [change.session]
              : [],
          )
        : [],
    );

    assert.ok(pushed.some(finished), "the finished run was pushed");
  });
  stalled = false;

  for (const release of await Promise.all(held.splice(0))) release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const fresh = cloudSessions((await host.call(1, "host.sessionDirectory", undefined)).directories);
  assert.equal(fresh?.length, 1);
  assert.ok(fresh?.[0] !== undefined && finished(fresh[0]), "the stale list did not undo the row");
});

test("reconnecting removes a Cloud chat deleted while disconnected", async () => {
  const { baseUrl, sdk } = await remoteHost();
  const { host } = await desktop();
  await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  const kept = await host.call(1, "host.server.createSession", undefined);
  const doomed = await host.call(1, "host.server.createSession", undefined);
  assert.deepEqual(
    new Set(
      cloudSessions((await host.call(1, "host.sessionDirectory", undefined)).directories)?.map(
        (item) => item.sessionId,
      ),
    ),
    new Set([kept.sessionId, doomed.sessionId]),
  );

  await host.call(1, "host.server.disconnect", undefined);
  assert.equal(
    cloudSessions((await host.call(1, "host.sessionDirectory", undefined)).directories),
    undefined,
  );
  await sdk.sessions.delete({ sessionId: doomed.sessionId });

  await host.call(1, "host.server.connect", { baseUrl, token: TOKEN });
  await vi.waitFor(async () => {
    const cloud = cloudSessions(
      (await host.call(1, "host.sessionDirectory", undefined)).directories,
    );

    assert.deepEqual(
      cloud?.map((item) => item.sessionId),
      [kept.sessionId],
    );
  });
});
