import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { Context, ProviderCheckpointMaterial } from "@nyte-ai/schema";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId, type SessionEvent } from "../../src/kernel/sdk/types.ts";
import { modelContext } from "@nyte-ai/client";
import { writeCheckpoint } from "../../src/kernel/compaction.ts";
import { headRef } from "../../src/kernel/names.ts";
import type { Commit } from "../../src/kernel/model.ts";
import type { Session } from "../../src/kernel/store.ts";
import { projectUsage } from "@nyte-ai/client";
import { definePlugin, inlinePlugin } from "../../src/plugins/types.ts";
import type { HookInvocation } from "../../src/plugins/hooks.ts";
import {
  assistant,
  lease,
  message,
  openStore,
  seedHead,
  storePath,
  user,
  usage,
  within,
} from "./helpers.ts";

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
const models = {
  getModels: () => [model],
  getModel: () => model,
  getAvailable: async () => [model],
};
const settings = { enabled: true, reserveTokens: 20, keepRecentTokens: 1 };
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

async function nextCompactionEvent(
  iterator: AsyncIterator<SessionEvent>,
): Promise<Extract<SessionEvent, { readonly kind: "compaction" }>> {
  for (;;) {
    const result = await within(iterator.next());
    if (result.done) assert.fail("event stream ended early");
    if (result.value.kind === "compaction") return result.value;
  }
}

async function storedCommits(session: Session): Promise<Commit[]> {
  const commits: Commit[] = [];
  for (const entry of await session.objects.list()) {
    const object = await session.objects.get(entry.oid);
    if (object?.kind === "commit") commits.push(object);
  }
  return commits;
}

/** Compaction usage as the usage view reads it back from every stored commit. */
async function storedCompactionTokens(session: Session): Promise<number> {
  return projectUsage(await storedCommits(session)).compaction.totalTokens;
}

test("native compaction serves manual and automatic checkpoints without a local summary, and other models read the portable history", async () => {
  const store = openStore();
  const session = await store.create({ id: "native-lifecycle" });
  await seedHead(session, "main", [
    message(user("original")),
    message(assistant("answer")),
    message(user("latest")),
  ]);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const hookCalls: HookInvocation<"before_compaction">[] = [];
  const requests: Context[] = [];
  const nyte = await createNyte({
    store,
    model,
    env: { cwd: "/tmp" },
    models,
    compaction: settings,
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "native-lifecycle",
          session(api) {
            api.prompt.add((draft) => draft.set("persona", { text: "NORMAL AGENT PERSONA" }));
            api.hook("before_compaction", async (event) => {
              hookCalls.push(event);
              if (hookCalls.length === 1) {
                started.resolve();
                await finish.promise;
              }
              return { material, usage };
            });
          },
        }),
      ),
    ],
    streamFn: (_model, context) => {
      requests.push(context);
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: { ...assistant("answer after checkpoint"), model: model.id },
      });
      return stream;
    },
  });
  const id = sessionId(session.id);
  const iterator = nyte.watch({ sessionId: id, afterSeq: 0 })[Symbol.asyncIterator]();
  const detach = nyte.attach({ sessions: [id] });
  try {
    const compacting = nyte.runs.compact({
      sessionId: id,
      customInstructions: "Preserve the constraints",
    });
    const start = await nextCompactionEvent(iterator);
    assert.equal(start.compaction?.reason, "manual");
    await started.promise;
    assert.deepEqual(
      (await nyte.sessions.snapshot({ sessionId: id }))?.compaction,
      start.compaction,
    );
    finish.resolve();
    assert.equal((await compacting).kind, "compacted");
    assert.equal((await nextCompactionEvent(iterator)).compaction, null);
    assert.equal((await nyte.sessions.snapshot({ sessionId: id }))?.compaction, undefined);
    assert.equal(hookCalls[0]?.reason, "manual");
    assert.equal(hookCalls[0]?.customInstructions, "Preserve the constraints");
    assert.equal(hookCalls[0]?.context.systemPrompt, "NORMAL AGENT PERSONA");
    assert.equal(requests.length, 0);

    const tip = await session.refs.read(headRef("main"));
    const checkpoint = tip === null ? undefined : await session.objects.get(tip);
    assert.ok(checkpoint?.kind === "commit" && checkpoint.body.kind === "checkpoint");
    assert.deepEqual(checkpoint.body.material, material);
    const target = { provider: model.provider, api: model.api, model: model.id };
    assert.deepEqual(modelContext([checkpoint], target), { checkpoint: material, messages: [] });
    const portable = modelContext([checkpoint], { ...target, model: "different-model" });
    assert.equal(portable.checkpoint, undefined);
    assert.deepEqual(
      portable.messages.map((item) => item.content),
      ["original", assistant("answer").content, "latest"],
    );

    // Context after a native checkpoint is sized from the provider's output plus
    // the new messages; an oversized follow-up compacts again before the answer,
    // handing the provider its opaque state plus only the messages after it.
    const oversized = `constraint ${"detail ".repeat(3_000)}`;
    await nyte.messages.send({ sessionId: id, content: oversized });
    assert.equal((await nyte.runs.wait({ sessionId: id })).kind, "idle");
    assert.equal(hookCalls.length, 2);
    assert.equal(hookCalls[1]?.reason, "threshold");
    assert.deepEqual(hookCalls[1]?.context.checkpoint, material);
    assert.deepEqual(
      hookCalls[1]?.context.messages.map((item) => item.content),
      [oversized],
    );
    assert.equal(requests.length, 1);
    assert.ok(requests.every((request) => request.systemPrompt === "NORMAL AGENT PERSONA"));
    const commits = await storedCommits(session);
    assert.equal(commits.filter((commit) => commit.body.kind === "checkpoint").length, 2);
    assert.equal(projectUsage(commits).compaction.totalTokens, usage.totalTokens * 2);
  } finally {
    finish.resolve();
    detach();
    await iterator.return?.();
    await nyte.close();
  }
});

test("a rejected native request falls back to a portable summary under the summarizer prompt", async () => {
  const store = openStore();
  const session = await store.create({ id: "manual-native" });
  await seedHead(session, "main", [
    message(user("original")),
    message(assistant("answer")),
    message(user("latest")),
  ]);
  const requests: Context[] = [];
  const steps: string[] = [];
  const nyte = await createNyte({
    store,
    model,
    models,
    env: { cwd: "/tmp" },
    compaction: settings,
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "manual-provider",
          session(api) {
            api.hook("before_compaction", () => {
              throw new Error("native endpoint rejected request");
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
    const result = await nyte.runs.compact({ sessionId: sessionId(session.id) });
    assert.equal(result.kind, "compacted");
    assert.ok(requests.length > 0);
    assert.ok(
      requests.every((request) => request.systemPrompt?.includes("summarization assistant")),
    );
    assert.ok(steps.every((step) => step === "compaction"));
    const tip = await session.refs.read(headRef("main"));
    const checkpoint = tip === null ? undefined : await session.objects.get(tip);
    assert.ok(checkpoint?.kind === "commit" && checkpoint.body.kind === "checkpoint");
    assert.equal(checkpoint.body.material, undefined);
    assert.match(checkpoint.body.summary, /portable summary/);
  } finally {
    await nyte.close();
  }
});

test("cancelling a native compaction preserves the head, releases its lease, skips fallback, and keeps reported usage", async () => {
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
  const nyte = await createNyte({
    store,
    model,
    env: { cwd: "/tmp" },
    models,
    compaction: settings,
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "cancel-provider",
          session(api) {
            api.hook("before_compaction", async (_event, signal) => {
              assert.ok(signal);
              const stopped = new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
              started.resolve();
              await stopped;
              // Even a provider finishing after cancellation cannot publish, but its usage is kept.
              return { material, usage };
            });
          },
        }),
      ),
    ],
    streamFn: () => assert.fail("a cancelled native request must not fall back"),
  });
  const id = sessionId(session.id);
  const iterator = nyte.watch({ sessionId: id, afterSeq: 0 })[Symbol.asyncIterator]();
  try {
    const compacting = nyte.runs.compact({ sessionId: id, signal: controller.signal });
    const start = await nextCompactionEvent(iterator);
    assert.equal(start.compaction?.reason, "manual");
    await started.promise;
    controller.abort();
    assert.deepEqual(await compacting, { kind: "aborted" });
    assert.equal((await nextCompactionEvent(iterator)).compaction, null);
    assert.equal((await nyte.sessions.snapshot({ sessionId: id }))?.compaction, undefined);
    assert.equal(await session.refs.read(headRef("main")), original);
    assert.equal(await session.leases.read(headRef("main")), undefined);
    assert.equal(await storedCompactionTokens(session), usage.totalTokens);
  } finally {
    controller.abort();
    await iterator.return?.();
    await nyte.close();
  }
});

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

test("losing a compaction lease aborts the provider, cannot publish stale context, and keeps reported usage", async () => {
  const path = storePath();
  const store = openStore(path);
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
      return { material, usage };
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
    assert.equal(await storedCompactionTokens(session), usage.totalTokens);
    assert.ok((await storedCommits(session)).every((commit) => commit.body.kind !== "checkpoint"));
    const reader = await createNyte({
      store: openStore(path),
      model,
      env: { cwd: "/tmp" },
      models,
      plugins: [],
      streamFn: () => assert.fail("snapshot recovery must not request a model"),
    });
    try {
      assert.equal(
        (await reader.sessions.snapshot({ sessionId: sessionId(session.id) }))?.compaction,
        undefined,
      );
    } finally {
      await reader.close();
    }
  } finally {
    await session.leases.release(successor.lease);
  }
});
