import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { Context, ProviderCheckpointMaterial } from "@nyte-ai/schema";
import { activate, turnFor } from "../../src/kernel/sdk/activation.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { modelContext } from "../../src/kernel/context.ts";
import { writeCheckpoint } from "../../src/kernel/compaction.ts";
import { contextCommits } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import type { Commit, Run } from "../../src/kernel/model.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/types.ts";
import type { HookInvocation } from "../../src/plugins/hooks.ts";
import type { StreamFn } from "../../src/types.ts";
import { assistant, lease, message, openStore, seedHead, user, usage } from "./helpers.ts";

const model: Model<Api> = {
  id: "native-model",
  name: "Native",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 2_000,
  maxTokens: 50,
};
const settings = { enabled: true, reserveTokens: 20, keepRecentTokens: 1 };
const heavyUsage = { ...usage, input: 2_000, totalTokens: 2_000 };
const material: ProviderCheckpointMaterial = {
  type: "provider",
  provider: model.provider,
  api: model.api,
  model: model.id,
  data: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "original" }] },
    { type: "compaction", encrypted_content: "opaque-provider-state" },
  ],
};

test.each(["native", "fallback", "cancelled", "cancelled-during-fallback"] as const)(
  "automatic compaction handles %s without mixing assistant and summarizer prompts",
  async (mode) => {
    const controller = new AbortController();
    const requests: Context[] = [];
    const steps: string[] = [];
    const providerRequests: HookInvocation<"before_compaction">[] = [];
    const plugin = inlinePlugin(
      definePlugin({
        id: "compaction-test",
        session(api) {
          api.prompt.add((draft) => draft.set("persona", { text: "NORMAL AGENT PERSONA" }));
          api.hook("before_request", (event) => {
            steps.push(event.step);
            if (mode === "cancelled-during-fallback") controller.abort();
            return undefined;
          });
          api.hook("before_compaction", (event) => {
            providerRequests.push(event);
            if (mode === "fallback") throw new Error("provider compaction unavailable");
            if (mode === "cancelled") controller.abort();
            if (mode === "cancelled-during-fallback") return undefined;
            return { material, usage };
          });
        },
      }),
    );
    const active = await activate({
      target: { kind: "new-session" },
      plugins: [plugin],
      env: { cwd: "/tmp" },
    });
    const store = openStore();
    const session = await store.create();
    await seedHead(session, "main", [
      message(user("original")),
      message({ ...assistant("answer", { usage: heavyUsage }), model: model.id }),
      message(user("latest")),
    ]);
    const held = await lease(session, "main");
    const run: Run = {
      kind: "run",
      id: "run",
      head: "main",
      phase: { kind: "respond" },
      startedAt: 0,
      attempts: 1,
      config: {},
    };
    const streamFn: StreamFn = (_model, context) => {
      requests.push(context);
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("portable summary") });
      return stream;
    };
    const bound = turnFor(active, { model, streamFn, compaction: settings });
    const signal = controller.signal;
    try {
      const commits = await contextCommits(
        session.objects,
        await session.refs.read(headRef("main")),
      );
      const outcome = await bound.turn.respond({
        session,
        lease: held,
        run,
        attempt: 2,
        commits,
        signal,
        emit: () => undefined,
      });
      if (mode === "cancelled" || mode === "cancelled-during-fallback") {
        assert.equal(outcome.kind, "aborted");
        assert.equal(requests.length, 0);
        return;
      }
      assert.equal(outcome.kind, "checkpoint");
      if (outcome.kind !== "checkpoint") assert.fail("expected checkpoint");
      assert.equal(providerRequests[0]?.reason, "threshold");
      assert.equal(providerRequests[0]?.context.systemPrompt, "NORMAL AGENT PERSONA");
      if (mode === "fallback") {
        assert.equal(outcome.body.material, undefined);
        assert.match(outcome.body.summary, /portable summary/);
        assert.ok(requests.length > 0);
        assert.ok(
          requests.every((request) => request.systemPrompt?.includes("summarization assistant")),
        );
        assert.ok(steps.every((step) => step === "compaction"));
        return;
      }
      assert.equal(requests.length, 0);
      assert.deepEqual(outcome.body.material, material);
      assert.deepEqual(outcome.body.usage, usage);
      const checkpoint: Commit = { kind: "commit", parent: null, body: outcome.body, at: 1 };
      const target = { provider: model.provider, api: model.api, model: model.id };
      assert.deepEqual(modelContext([checkpoint], target), { checkpoint: material, messages: [] });
      const portable = modelContext([checkpoint], { ...target, model: "different-model" });
      assert.equal(portable.checkpoint, undefined);
      assert.deepEqual(
        portable.messages.map((item) => item.content),
        ["original", assistant("answer").content, "latest"],
      );

      // Another native checkpoint receives opaque state plus only the new messages.
      const next: Commit = {
        kind: "commit",
        parent: null,
        body: message({ ...assistant("new answer", { usage: heavyUsage }), model: model.id }),
        at: 2,
      };
      const second = await bound.turn.respond({
        session,
        lease: held,
        run,
        attempt: 3,
        commits: [
          { oid: "checkpoint", commit: checkpoint },
          { oid: "next", commit: next },
        ],
        signal,
        emit: () => undefined,
      });
      assert.equal(second.kind, "checkpoint");
      assert.deepEqual(providerRequests[1]?.context.checkpoint, material);
      assert.deepEqual(
        providerRequests[1]?.context.messages.map((item) => item.content),
        [next.body.kind === "message" ? next.body.message.content : []],
      );
      assert.equal(requests.length, 0);
    } finally {
      await active.close();
    }
  },
);

test.each(["native", "fallback"] as const)(
  "manual compaction invokes the provider hook before %s publication",
  async (mode) => {
    const store = openStore();
    const session = await store.create({ id: "manual-native" });
    await seedHead(session, "main", [
      message(user("original")),
      message(assistant("answer")),
      message(user("latest")),
    ]);
    const calls: HookInvocation<"before_compaction">[] = [];
    const requests: Context[] = [];
    const steps: string[] = [];
    const nyte = await createNyte({
      store,
      model,
      models: { getModels: () => [model], getModel: () => model },
      env: { cwd: "/tmp" },
      compaction: settings,
      plugins: [
        inlinePlugin(
          definePlugin({
            id: "manual-provider",
            session(api) {
              api.hook("before_compaction", (event) => {
                calls.push(event);
                if (mode === "fallback") throw new Error("native endpoint rejected request");
                return { material };
              });
              api.hook("before_request", (event) => {
                steps.push(event.step);
                return undefined;
              });
            },
          }),
        ),
      ],
      streamFn: (_model, context) => {
        requests.push(context);
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: assistant("portable summary") });
        return stream;
      },
    });
    try {
      const result = await nyte.runs.compact({
        sessionId: sessionId(session.id),
        customInstructions: "Preserve the constraints",
      });
      assert.equal(result.kind, "compacted");
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.reason, "manual");
      assert.equal(calls[0]?.customInstructions, "Preserve the constraints");
      if (mode === "native") assert.equal(requests.length, 0);
      else {
        assert.ok(requests.length > 0);
        assert.ok(
          requests.every((request) => request.systemPrompt?.includes("summarization assistant")),
        );
        assert.ok(steps.every((step) => step === "compaction"));
      }
    } finally {
      await nyte.close();
    }
  },
);

test.each(["native", "portable"] as const)(
  "cancelling manual %s compaction preserves the head and releases its lease",
  async (mode) => {
    const store = openStore();
    const session = await store.create({ id: "cancel-compaction" });
    await seedHead(session, "main", [
      message(user("original")),
      message(assistant("answer")),
      message(user("latest")),
    ]);
    const original = await session.refs.read(headRef("main"));
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    let requests = 0;
    const nyte = await createNyte({
      store,
      model,
      env: { cwd: "/tmp" },
      models: { getModels: () => [model], getModel: () => model },
      compaction: settings,
      plugins: [
        inlinePlugin(
          definePlugin({
            id: "cancel-provider",
            session(api) {
              api.hook("before_compaction", async (_event, signal) => {
                if (mode === "portable") return undefined;
                assert.ok(signal);
                const stopped = new Promise<void>((resolve) => {
                  signal.addEventListener("abort", () => resolve(), { once: true });
                });
                started.resolve();
                await stopped;
                // Even a provider finishing after cancellation cannot publish.
                return { material };
              });
            },
          }),
        ),
      ],
      streamFn: (_model, _context, options) => {
        requests += 1;
        const stream = createAssistantMessageEventStream();
        assert.ok(options?.signal);
        options.signal.addEventListener(
          "abort",
          () => {
            stream.push({
              type: "error",
              reason: "aborted",
              error: assistant("", { stop: "aborted" }),
            });
          },
          { once: true },
        );
        started.resolve();
        return stream;
      },
    });
    try {
      const compacting = nyte.runs.compact({
        sessionId: sessionId(session.id),
        signal: controller.signal,
      });
      await started.promise;
      controller.abort();
      assert.deepEqual(await compacting, { kind: "aborted" });
      assert.equal(await session.refs.read(headRef("main")), original);
      assert.equal(await session.leases.read(headRef("main")), undefined);
      assert.equal(requests, mode === "native" ? 0 : 1);
    } finally {
      controller.abort();
      await nyte.close();
    }
  },
);

test("a slow native compaction keeps its lease until checkpoint publication", async () => {
  const store = openStore();
  const session = await store.create();
  await seedHead(session, "main", [message(user("original")), message(user("latest"))]);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const compacting = writeCheckpoint(session, {
    head: "main",
    ttlMs: 60,
    model,
    settings,
    reason: "manual",
    streamFn: () => assert.fail("native compaction must not invoke the local summarizer"),
    providerCompaction: async () => {
      started.resolve();
      await finish.promise;
      return { material };
    },
  });
  await started.promise;
  try {
    await sleep(150);
    const competitor = await session.leases.acquire(headRef("main"), 60);
    assert.equal(competitor.ok, false);
  } finally {
    finish.resolve();
  }
  assert.equal((await compacting).kind, "compacted");
  assert.equal(await session.leases.read(headRef("main")), undefined);
});

test("losing a compaction lease aborts the provider and cannot publish stale context", async () => {
  const store = openStore();
  const session = await store.create();
  await seedHead(session, "main", [message(user("original")), message(user("latest"))]);
  const original = await session.refs.read(headRef("main"));
  const held = await lease(session, "main");
  const started = Promise.withResolvers<void>();
  let aborted = false;
  const compacting = writeCheckpoint(session, {
    head: "main",
    lease: held,
    ttlMs: 30,
    model,
    settings,
    reason: "manual",
    streamFn: () => assert.fail("lease loss must not start a fallback request"),
    providerCompaction: async (_request, signal) => {
      assert.ok(signal);
      const stopped = new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      started.resolve();
      await stopped;
      aborted = signal.aborted;
      return { material };
    },
  });
  await started.promise;
  await session.leases.release(held);
  const successor = await session.leases.acquire(headRef("main"), 60);
  assert.ok(successor.ok);
  try {
    assert.equal((await compacting).kind, "failed");
    assert.equal(aborted, true);
    assert.equal(await session.refs.read(headRef("main")), original);
    assert.equal((await session.leases.read(headRef("main")))?.owner, successor.lease.owner);
  } finally {
    await session.leases.release(successor.lease);
  }
});

test("switching models compacts oversized portable history before the next assistant request", async () => {
  const active = await activate({
    target: { kind: "new-session" },
    plugins: [],
    env: { cwd: "/tmp" },
  });
  const store = openStore();
  const session = await store.create();
  await seedHead(session, "main", [
    {
      kind: "checkpoint",
      summary: "",
      retainedTail: [user("early project constraint ".repeat(1_000))],
      material: { ...material, model: "previous-model" },
      tokensBefore: 8_000,
      usage,
    },
    message(user("continue with the new model")),
  ]);
  const held = await lease(session, "main");
  const bound = turnFor(active, {
    model,
    compaction: settings,
    streamFn: (_model, context) => {
      assert.match(context.systemPrompt ?? "", /summarization assistant/);
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("recovered constraint") });
      return stream;
    },
  });
  try {
    const outcome = await bound.turn.respond({
      session,
      lease: held,
      run: {
        kind: "run",
        id: "new-model-run",
        head: "main",
        phase: { kind: "respond" },
        startedAt: 0,
        attempts: 0,
        config: {},
      },
      attempt: 1,
      commits: await contextCommits(session.objects, await session.refs.read(headRef("main"))),
      signal: new AbortController().signal,
      emit: () => undefined,
    });
    assert.equal(outcome.kind, "checkpoint");
    if (outcome.kind !== "checkpoint") assert.fail("expected portable checkpoint");
    assert.equal(outcome.body.material, undefined);
    assert.match(outcome.body.summary, /recovered constraint/);
    assert.equal(outcome.body.retainedTail.at(-1)?.content, "continue with the new model");
  } finally {
    await session.leases.release(held);
    await active.close();
  }
});
