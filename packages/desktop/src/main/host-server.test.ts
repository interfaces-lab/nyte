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
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type { Nyte } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import { createNyteServer } from "@nyte-ai/server";
import type { NyteServer } from "@nyte-ai/server";
import type { Api, Model } from "@nyte-ai/schema";
import { cloudSessions } from "../shared/ipc.ts";
import type { HostEvent, WatchEnvelope } from "../shared/ipc.ts";
import { DesktopHost } from "./host.ts";

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

/** The desktop's own catalog: one offline model, never streamed, so Home can compose. */
function localModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  const stream = () => {
    throw new Error("Local models are not streamed by server tests");
  };
  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
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

/** Bridge one Node request to the Web handler, streaming the response so SSE frames arrive as sent. */
async function serve(server: NyteServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = new Request(url, {
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
  const response = await server.fetch(request);
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

/** A server whose sessions never reach a model: the run fails and that failure is what streams back. */
async function remoteHost(): Promise<{ baseUrl: string; sdk: Nyte }> {
  const store = new SqliteStore(":memory:", { watchPollIntervalMs: 5 });
  const sdk = await createNyte({
    store,
    streamFn: () => {
      throw new Error("No provider on this server");
    },
    models: {
      getModels: () => [model],
      getModel: (_provider: string, id: string) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [],
    env: { cwd: "/" },
  });
  sdk.attach();
  const server = createNyteServer({ sdk, version: "test", auth: { kind: "token", token: TOKEN } });
  const listener = createServer((req, res) => void serve(server, req, res));
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("No address");
  cleanups.push(
    () => new Promise<void>((resolve) => listener.close(() => resolve())),
    () => server.close(),
    () => sdk.close(),
    () => store.close(),
  );
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, sdk };
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
      setBounds: () => undefined,
      warm: async () => undefined,
      dispose: () => undefined,
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
  assert.deepEqual(await host.call("host.server.state", undefined), { kind: "none" });

  const refused = await host.call("host.server.connect", { baseUrl, token: "wrong-token-000000" });
  assert.equal(refused.kind, "failed");
  assert.deepEqual(await host.call("host.server.state", undefined), { kind: "none" });
  assert.equal(events.length, 0);

  const outcome = await host.call("host.server.connect", { baseUrl, token: TOKEN });
  assert.deepEqual(outcome, { kind: "connected", baseUrl, version: "test" });
  assert.deepEqual(await host.call("host.server.state", undefined), {
    kind: "configured",
    baseUrl,
  });
  assert.deepEqual(events, [{ kind: "server_changed" }]);
});

test("a server session is created, listed, driven, and watched through the server", async () => {
  const { baseUrl, sdk } = await remoteHost();
  const { host, watchEvents } = await desktop();
  await host.call("host.server.connect", { baseUrl, token: TOKEN });

  const created = await host.call("host.server.createSession", undefined);
  const directory = await host.call("host.sessionDirectory", undefined);
  assert.deepEqual(
    cloudSessions(directory)?.map((session) => session.sessionId),
    [created.sessionId],
  );
  // The server owns it: the desktop's own stores never see it.
  assert.equal(
    (await sdk.sessions.get({ sessionId: created.sessionId }))?.sessionId,
    created.sessionId,
  );
  assert.equal(
    directory.some(
      (entry) =>
        entry.environment === "local" &&
        entry.sessions.some((session) => session.sessionId === created.sessionId),
    ),
    false,
  );

  host.watchStart({ watchId: "cloud", sessionId: created.sessionId, live: true });
  const receipt = await host.call("messages.send", {
    sessionId: created.sessionId,
    content: "hello",
  });
  assert.equal(receipt.kind, "queued");
  await vi.waitFor(() => {
    const failed = watchEvents.some(
      (envelope) =>
        envelope.kind === "event" &&
        envelope.event.kind === "run" &&
        envelope.event.run.phase.kind === "failed",
    );
    assert.ok(failed, "the server's runner drove the run to its provider failure");
  });
  host.watchStop("cloud");

  await host.call("host.server.disconnect", undefined);
  assert.equal(cloudSessions(await host.call("host.sessionDirectory", undefined)), undefined);
});
