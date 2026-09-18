import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { afterEach, test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte, NyteOptions } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { headRef } from "../../src/kernel/names.ts";
import { ToolWait, type StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, storePath, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "advance-test",
  name: "Advance test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const models: NyteOptions["models"] = {
  getModels: () => [model],
  getModel: (provider, id) => (provider === model.provider && id === model.id ? model : undefined),
  getAvailable: async () => [model],
};

const sdks: Nyte[] = [];
afterEach(async () => {
  for (const sdk of sdks.splice(0).reverse()) await sdk.close();
});

function scripted(
  respond: (...args: Parameters<StreamFn>) => AssistantMessage | Promise<AssistantMessage>,
): StreamFn {
  return (...args) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message = await respond(...args);
      if (message.stopReason === "pending")
        throw new Error("Script must finish its provider response");
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        stream.push({ type: "error", reason: message.stopReason, error: message });
      } else {
        stream.push({ type: "done", reason: message.stopReason, message });
      }
    })().catch((error: unknown) => {
      stream.push({
        type: "error",
        reason: "error",
        error: assistant("", {
          stop: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    });
    return stream;
  };
}

async function open(
  streamFn: StreamFn,
  options: Partial<Pick<NyteOptions, "store" | "plugins">> = {},
): Promise<Nyte> {
  const sdk = await createNyte({
    store: openStore(),
    streamFn,
    model,
    models,
    plugins: [],
    env: { cwd: "/tmp/nyte-advance" },
    ...options,
  });
  sdks.push(sdk);
  return sdk;
}

test("an unattached host lands one step, responds in the next, and preserves the result on reopen", async () => {
  const path = storePath();
  let calls = 0;
  const streamFn = scripted(() => {
    calls += 1;
    return assistant("A durable answer");
  });
  const sdk = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "Please answer" });
  assert.equal(await sdk.runs.current({ sessionId }), undefined);
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "continue" });
  assert.equal(calls, 0);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "respond");
  assert.equal((await sdk.messages.pending({ sessionId })).length, 0);
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "finished" });
  assert.equal(calls, 1);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "done");
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
  await sdk.close();

  const reopened = await open(streamFn, { store: openStore(path) });
  const transcript = await reopened.messages.list({ sessionId });
  assert.ok(
    transcript.some(
      (turn) =>
        turn.kind === "turn" &&
        turn.parts.some((part) => part.kind === "assistant" && part.text === "A durable answer"),
    ),
  );
  assert.deepEqual(await reopened.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
});

test("configuration without user input does not authorize a model call", async () => {
  let calls = 0;
  const sdk = await open(
    scripted(() => {
      calls += 1;
      return assistant("must not run");
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.sessions.configure({ sessionId, thinkingLevel: "off" });
  await sdk.advance({ sessionId });
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 0);
  assert.equal((await sdk.messages.pending({ sessionId })).length, 0);
});

test("advance returns the durable tool deadline immediately and leaves the wait parked", async () => {
  const until = Date.now() + 60_000;
  let tools = 0;
  const waiting = inlinePlugin(
    definePlugin({
      id: "wait",
      session(api) {
        api.tools.add((draft) =>
          draft.set("wait", {
            name: "wait",
            description: "Wait for a reply",
            parameters: Type.Object({}),
            execute: async () => {
              tools += 1;
              throw new ToolWait({ until });
            },
            wake: async () => ({
              kind: "settle",
              result: { content: [{ type: "text", text: "done" }], details: {} },
            }),
          }),
        );
      },
    }),
  );
  const sdk = await open(
    scripted(() => assistant("", { calls: [call("wait-1", "wait")] })),
    { plugins: [waiting] },
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "Wait" });
  await sdk.advance({ sessionId });
  await sdk.advance({ sessionId });
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "waiting", until });
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "waiting");
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "waiting", until });
  assert.equal(tools, 1);
});

test("provider backoff returns a persisted retry time without sleeping or making another request", async () => {
  let calls = 0;
  const sdk = await open(
    scripted(() => {
      calls += 1;
      return assistant("", {
        stop: "error",
        error: "rate limited; server requested 60s retry delay",
      });
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "Try this" });
  await sdk.advance({ sessionId });
  const retry = await within(sdk.advance({ sessionId }), 1000);
  assert.ok(retry.kind === "retry");
  assert.ok(retry.at > Date.now() + 50_000);
  const stored = await sdk.runs.current({ sessionId });
  assert.ok(stored?.phase.kind === "retry");
  assert.equal(stored.phase.at, retry.at);
  assert.deepEqual(await within(sdk.advance({ sessionId }), 1000), retry);
  assert.equal(calls, 1);
});

test("concurrent hosts return the held lease deadline and do not run a second model request", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const streamFn = scripted(async () => {
    calls += 1;
    started.resolve();
    await release.promise;
    return assistant("one response");
  });
  const first = await open(streamFn, { store: openStore(path) });
  const second = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "Start" });
  await first.advance({ sessionId });
  const response = first.advance({ sessionId });
  try {
    await within(started.promise);
    const busy = await second.advance({ sessionId });
    const session = await openStore(path).open(sessionId);
    const holder = await session.leases.read(headRef("main"));
    assert.ok(holder);
    assert.deepEqual(busy, { kind: "busy", until: holder.expiresAt });
    assert.equal(calls, 1);
  } finally {
    release.resolve();
    await response;
  }
  assert.deepEqual(await second.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
});

test("a remote stop cancels the in-flight step and cannot cancel the next user run", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  let calls = 0;
  const streamFn = scripted(async (_model, _context, options) => {
    calls += 1;
    if (calls !== 1) return assistant("the next answer");
    started.resolve();
    await assert.rejects(setTimeout(60_000, undefined, { signal: options?.signal }));
    return assistant("partial", { stop: "aborted" });
  });
  const first = await open(streamFn, { store: openStore(path) });
  const second = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "first" });
  await first.advance({ sessionId });
  const oldRun = await first.runs.current({ sessionId });
  const response = first.advance({ sessionId });
  await within(started.promise);
  assert.equal((await second.runs.abort({ sessionId }))?.kind, "requested");
  await second.messages.send({ sessionId, content: "second" });
  await within(response);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outcome = await first.advance({ sessionId });
    if (outcome.kind === "idle") break;
  }
  assert.equal(calls, 2);
  const current = await first.runs.current({ sessionId });
  assert.notEqual(current?.runId, oldRun?.runId);
  assert.equal(current?.phase.kind, "done");
  const turns = (await second.messages.list({ sessionId })).filter((turn) => turn.kind === "turn");
  assert.deepEqual(
    turns.map((turn) => turn.outcome),
    ["aborted", "completed"],
  );
  assert.ok(
    turns[1]?.parts.some((part) => part.kind === "assistant" && part.text === "the next answer"),
  );
});

test("closing an unattached SDK aborts and drains a step before closing its session", async () => {
  const started = Promise.withResolvers<void>();
  const sdk = await open(
    scripted(async (_model, _context, options) => {
      started.resolve();
      await assert.rejects(setTimeout(60_000, undefined, { signal: options?.signal }));
      return assistant("", { stop: "aborted" });
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "slow" });
  await sdk.advance({ sessionId });
  const response = sdk.advance({ sessionId });
  await within(started.promise);
  await within(sdk.close());
  await response;
  await assert.rejects(sdk.advance({ sessionId }), /nyte is closed/);
});

test("a host that cannot activate the session leaves queued input untouched", async () => {
  const sdk = await createNyte({
    store: openStore(),
    models,
    model,
    streamFn: scripted(() => assistant("must not run")),
    resolveActivation: () => ({
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/untrusted" },
    }),
  });
  sdks.push(sdk);
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "pending trust" });
  await assert.rejects(sdk.advance({ sessionId }), /not active/);
  assert.equal((await sdk.messages.pending({ sessionId })).length, 1);
  assert.equal(await sdk.runs.current({ sessionId }), undefined);
});
