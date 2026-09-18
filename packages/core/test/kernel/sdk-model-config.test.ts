import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId, type NyteOptions } from "../../src/kernel/sdk/types.ts";
import { runRef } from "../../src/kernel/names.ts";
import type { Run } from "../../src/kernel/model.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  message,
  openStore,
  seedHead,
  setHead,
  storePath,
  user,
  within,
} from "./helpers.ts";

const sol: Model<Api> = {
  id: "gpt-5.6-sol",
  name: "Sol",
  provider: "openai-codex",
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};
const luna: Model<Api> = { ...sol, id: "gpt-5.6-luna", name: "Luna", contextWindow: 200_000 };
const models = {
  getModels: () => [sol, luna],
  getModel: (provider: string, id: string) =>
    [sol, luna].find((model) => model.provider === provider && model.id === id),
  getAvailable: async () => [sol, luna],
};

function host(options: Pick<NyteOptions, "store" | "model" | "thinkingLevel" | "streamFn">) {
  return createNyte({ ...options, models, plugins: [], env: { cwd: "/tmp/nowhere" } });
}

test.each(["new", "legacy"])(
  "a Luna reader sees the Sol executor's inputs for a %s run before its first token and after completion",
  async (mode) => {
    const path = storePath();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const streamFn: StreamFn = (model, _context, options) => {
      assert.equal(model.id, sol.id);
      assert.equal(options?.reasoning, "xhigh");
      const stream = createAssistantMessageEventStream();
      started.resolve();
      void release.promise.then(() => {
        const answer = { ...assistant("hello"), model: model.id, provider: model.provider };
        stream.push({ type: "done", reason: "stop", message: answer });
      });
      return stream;
    };
    const executorStore = openStore(path);
    const executor = await host({
      store: executorStore,
      model: sol,
      thinkingLevel: "xhigh",
      streamFn,
    });
    const reader = await host({
      store: openStore(path),
      model: luna,
      thinkingLevel: "medium",
      streamFn,
    });
    try {
      const { sessionId: id } = await executor.sessions.create();
      if (mode === "legacy") {
        const session = await executorStore.open(id);
        await seedHead(session, "main", [message(user("hello"))], { run: "resumed" });
        const run: Run = {
          kind: "run",
          id: "resumed",
          head: "main",
          phase: { kind: "respond" },
          startedAt: 0,
          attempts: 0,
          config: {},
        };
        const [oid] = await session.objects.put([run]);
        assert.ok(oid);
        await session.refs.update([{ name: runRef("main"), from: null, to: oid }], {
          reason: "test",
        });
      } else {
        await reader.messages.send({ sessionId: id, content: "hello" });
      }
      executor.attach();
      await within(started.promise, 5_000);
      const expected = { model: { provider: sol.provider, id: sol.id }, thinkingLevel: "xhigh" };
      const live = await reader.sessions.snapshot({ sessionId: id });
      assert.deepEqual(live?.session.config, {});
      assert.deepEqual(live?.config, expected);
      assert.deepEqual(live?.run?.config, expected);
      assert.equal(live?.context.contextWindow, sol.contextWindow);
      release.resolve();
      await within(executor.runs.wait({ sessionId: id }), 5_000);
      assert.deepEqual((await reader.sessions.snapshot({ sessionId: id }))?.config, expected);
    } finally {
      release.resolve();
      await reader.close();
      await executor.close();
    }
  },
);

test("model declarations survive more than 200 commits in get, list, and snapshot", async () => {
  const store = openStore();
  const session = await store.create({ id: "long-chat" });
  const declared = {
    model: { provider: sol.provider, id: sol.id },
    thinkingLevel: "high",
  } as const;
  await seedHead(session, "main", [
    { kind: "config", ...declared },
    ...Array.from({ length: 250 }, (_, index) => message(user(`message ${String(index)}`))),
  ]);
  const nyte = await host({
    store,
    model: luna,
    thinkingLevel: "medium",
    streamFn: () => {
      throw new Error("read-only host");
    },
  });
  try {
    const id = sessionId(session.id);
    assert.deepEqual((await nyte.sessions.get({ sessionId: id }))?.config, declared);
    assert.deepEqual((await nyte.sessions.list()).items[0]?.config, declared);
    const snapshot = await nyte.sessions.snapshot({ sessionId: id });
    assert.deepEqual(snapshot?.config, declared);
    assert.equal(snapshot?.context.contextWindow, sol.contextWindow);
  } finally {
    await nyte.close();
  }
});

test("legacy assistant metadata reveals the model without inventing reasoning or leaking across a rewind", async () => {
  const store = openStore();
  const session = await store.create({ id: "legacy" });
  const tips = await seedHead(
    session,
    "main",
    [
      message(user("hello")),
      message({ ...assistant("hello"), provider: sol.provider, model: sol.id }),
    ],
    { run: "legacy-run" },
  );
  const run: Run = {
    kind: "run",
    id: "legacy-run",
    head: "main",
    phase: { kind: "done" },
    startedAt: 0,
    attempts: 1,
    config: {},
  };
  const [oid] = await session.objects.put([run]);
  assert.ok(oid);
  await session.refs.update([{ name: runRef("main"), from: null, to: oid }], { reason: "test" });
  const nyte = await host({
    store,
    model: luna,
    thinkingLevel: "medium",
    streamFn: () => {
      throw new Error("read-only host");
    },
  });
  try {
    const id = sessionId(session.id);
    assert.deepEqual((await nyte.sessions.snapshot({ sessionId: id }))?.config, {
      model: { provider: sol.provider, id: sol.id },
    });
    await setHead(session, "main", tips[0] ?? null);
    assert.deepEqual((await nyte.sessions.snapshot({ sessionId: id }))?.config, {});
  } finally {
    await nyte.close();
  }
});
