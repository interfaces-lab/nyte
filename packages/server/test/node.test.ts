import assert from "node:assert/strict";
import { once } from "node:events";
import { Agent, createServer, request } from "node:http";
import { afterEach, test } from "vitest";
import { createNyteClient } from "@nyte-ai/client";
import { createNyte } from "@nyte-ai/core";
import type { Nyte } from "@nyte-ai/core";
import { localEnvironmentPlugin } from "@nyte-ai/core/plugins";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Api, Model } from "@nyte-ai/schema";
import { requestListener, serve } from "../src/node.ts";

const TOKEN = "node-listener-token-0123456789";

const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 2, output: 7, cacheRead: 0.2, cacheWrite: 1 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(wrap: (nyte: Nyte) => Nyte = (nyte) => nyte) {
  const store = new SqliteStore(":memory:");
  const nyte = await createNyte({
    store,
    streamFn: () => {
      throw new Error("No model is called");
    },
    models: {
      getModels: () => [model],
      getModel: (_provider: string, id: string) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [localEnvironmentPlugin({ id: "node-test" })],
    defaultWorkspace: { kind: "local", id: "node-test", cwd: "/tmp/nowhere" },
  });
  cleanups.push(() => store.close());
  cleanups.push(() => nyte.close());
  const serving = await serve({
    sdk: wrap(nyte),
    version: "test",
    auth: { kind: "token", token: TOKEN },
  });
  cleanups.push(() => serving.close());

  return { serving, client: createNyteClient({ baseUrl: serving.address, token: TOKEN }) };
}

test("requestListener mounts a fetch on a listener you own, resolving URLs against the Host header", async () => {
  const seen: string[] = [];
  const failures: unknown[] = [];
  const listener = createServer(
    requestListener(
      (request) => {
        seen.push(request.url);

        if (request.url.endsWith("/boom")) throw new Error("boom");

        return Response.json({ origin: request.headers.get("origin") });
      },
      { onError: (cause) => failures.push(cause) },
    ),
  );
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  const bound = listener.address();
  const base = `http://127.0.0.1:${String(bound === null || typeof bound === "string" ? 0 : bound.port)}`;

  const ok = await fetch(`${base}/v1/info?x=1`, { headers: { origin: "http://app.test" } });
  assert.deepEqual(await ok.json(), { origin: "http://app.test" });
  assert.deepEqual(seen, [`${base}/v1/info?x=1`]);

  const failed = await fetch(`${base}/boom`);
  assert.equal(failed.status, 500);
  assert.equal(failures.length, 1);
});

test("binds loopback on a system port and answers calls over the wire", async () => {
  const { serving, client } = await listen();
  assert.match(serving.address, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await client.info()).version, "test");

  const { sessionId } = await client.sessions.create();
  await client.messages.send({ sessionId, content: "hello", delivery: "next" });
  const snapshot = await client.sessions.snapshot({ sessionId });
  assert.equal(snapshot?.pending.length, 1);
});

test("refuses without a credential and from an unlisted browser origin", async () => {
  const { serving } = await listen();
  const anonymous = await fetch(`${serving.address}/v1/info`);
  assert.equal(anonymous.status, 401);

  const crossOrigin = await fetch(`${serving.address}/v1/info`, {
    headers: { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" },
  });
  assert.equal(crossOrigin.status, 403);
});

test("an upload the server stops reading is answered without waiting for the rest", async () => {
  const { serving } = await listen();

  for (const input of [
    { headers: { "content-type": "application/json" }, body: "{", status: 401 },
    {
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: "x".repeat(8_388_608 + 1),
      status: 413,
    },
  ]) {
    const status = Promise.withResolvers<number | undefined>();
    const upload = request(
      `${serving.address}/v1/call/sessions.create`,
      { method: "POST", headers: input.headers },
      (incoming) => {
        incoming.resume();
        status.resolve(incoming.statusCode);
      },
    );
    upload.on("error", status.reject);

    try {
      upload.write(input.body);
      assert.equal(await status.promise, input.status);
    } finally {
      upload.destroy();
    }
  }
});

test("a kept-alive connection serves the next request after a refused upload", async () => {
  const { serving } = await listen();
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  cleanups.push(() => agent.destroy());

  const statuses: (number | undefined)[] = [];

  for (const input of [
    { method: "POST", body: '{"input":{}}', expected: 401 },
    { method: "GET", body: undefined, expected: 401 },
  ]) {
    const status = Promise.withResolvers<number | undefined>();
    const sent = request(
      `${serving.address}/v1/${input.method === "GET" ? "info" : "call/sessions.create"}`,
      { method: input.method, agent, headers: { "content-type": "application/json" } },
      (incoming) => {
        incoming.resume();
        status.resolve(incoming.statusCode);
      },
    );
    sent.on("error", status.reject);
    sent.end(input.body);
    statuses.push(await status.promise);
    assert.equal(statuses.at(-1), input.expected);
  }
});

test("streams a watch and ends it with a closed frame when serving stops", async () => {
  const { serving, client } = await listen();
  const { sessionId } = await client.sessions.create();
  const response = await fetch(`${serving.address}/v1/watch?sessionId=${sessionId}&live=1`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.notEqual(response.body, null);

  const text = response.text();
  await serving.close();
  assert.match(await text, /event: error\ndata: {"code":"closed"/);
});

test("a client that disconnects mid-watch aborts the SDK watch it was reading", async () => {
  const watches: AbortSignal[] = [];
  const { serving, client } = await listen((nyte) => ({
    ...nyte,
    watch(input) {
      if (input.signal !== undefined) watches.push(input.signal);

      return nyte.watch(input);
    },
  }));
  const { sessionId } = await client.sessions.create();
  const controller = new AbortController();
  const response = await fetch(`${serving.address}/v1/watch?sessionId=${sessionId}&live=1`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const [watch] = watches;

  if (watch === undefined) throw new Error("The server opened no SDK watch");
  assert.equal(watch.aborted, false);

  controller.abort();

  if (!watch.aborted) await once(watch, "abort");
  assert.equal(watch.aborted, true);
});
