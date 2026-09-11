import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { definePlugin, inlinePlugin } from "@nyte-ai/plugin";
import type { Api, Context, Model } from "@nyte-ai/schema";
import { openaiAstraContextPlugin } from "../src/openai-astra-context.ts";
import {
  eventsSoFar,
  lastAssistantText,
  prompt,
  respond,
  testModel,
  TestWorkspace,
} from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const world of workspaces.splice(0)) await world.close();
});

function workspace() {
  const world = TestWorkspace.create("nyte-astra-context-");
  workspaces.push(world);
  return world;
}

function modelFor(provider: string, id = "gpt-6-astra"): Model<Api> {
  return {
    ...testModel,
    provider,
    id,
    api: provider === "openai-codex" ? "openai-codex-responses" : "openai-responses",
  };
}

const astra = inlinePlugin(openaiAstraContextPlugin());
const nativeCompaction = inlinePlugin(
  definePlugin({
    id: "native-checkpoint-fixture",
    session(api) {
      api.hook("before_compaction", (event) => ({
        material: {
          type: "provider",
          provider: event.model.provider,
          api:
            event.model.provider === "openai-codex" ? "openai-codex-responses" : "openai-responses",
          model: event.model.modelId,
          data: [{ type: "compaction", encrypted_content: "fixture-checkpoint" }],
        },
      }));
    },
  }),
);

// Provider usage makes the boundary exact without allocating a million-token conversation.
function scriptedProvider(...tokens: number[]) {
  const requests: { model: Model<Api>; context: Context }[] = [];
  const summaries: {
    model: Model<Api>;
    context: Context;
    maxTokens: number | undefined;
  }[] = [];
  const streamFn: StreamFn = async (model, context, options) => {
    if (context.systemPrompt?.includes("summarization assistant")) {
      summaries.push({ model: { ...model }, context, maxTokens: options?.maxTokens });
      return respond(model, [{ type: "text", text: "Portable project summary." }]);
    }
    requests.push({ model: { ...model }, context });
    const totalTokens = tokens.shift();
    assert.ok(totalTokens !== undefined, "unexpected assistant request");
    const message = await respond(model, [
      { type: "text", text: `Answer ${requests.length}` },
    ]).result();
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "stop",
      message: {
        ...message,
        usage: { ...message.usage, input: totalTokens - 1, output: 1, totalTokens },
      },
    });
    return stream;
  };
  return { streamFn, requests, summaries };
}

async function checkpoints(sdk: Nyte, sessionId: SessionId) {
  return (await sdk.messages.list({ sessionId })).filter((item) => item.kind === "checkpoint");
}

async function assertContextWindow(sdk: Nyte, sessionId: SessionId, contextWindow: number) {
  const context = await sdk.runs.context({ sessionId });
  assert.equal(context.contextWindow, contextWindow);
  const snapshot = await sdk.sessions.snapshot({ sessionId });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.context, context);
  return context;
}

test.each(["openai", "openai-codex"])(
  "%s Astra waits below 400k and compacts at 400k on the next response boundary",
  async (provider) => {
    const world = workspace();
    const model = modelFor(provider);
    const remote = scriptedProvider(399_999, 400_000, 20);
    const sdk = await world.open({
      model,
      plugins: [astra, nativeCompaction],
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
      streamFn: remote.streamFn,
    });
    const sessionId = world.sessionId;

    assert.equal((await prompt(sdk, sessionId, "Remember the migration plan.")).kind, "idle");
    assert.equal((await assertContextWindow(sdk, sessionId, 1_000_000)).usageTokens, 399_999);
    assert.deepEqual(await checkpoints(sdk, sessionId), []);

    // The next user message must not turn 399,999 reported tokens into an early checkpoint.
    assert.equal((await prompt(sdk, sessionId, "Review the plan.")).kind, "idle");
    const full = await assertContextWindow(sdk, sessionId, 1_000_000);
    assert.equal(full.usageTokens, 400_000);
    assert.equal(full.percent, 40);
    assert.equal(await lastAssistantText(sdk, sessionId), "Answer 2");
    assert.deepEqual(await checkpoints(sdk, sessionId), []);
    assert.deepEqual(
      (await eventsSoFar(sdk, sessionId)).filter((event) => event.kind === "compaction"),
      [],
    );

    assert.equal((await prompt(sdk, sessionId, "Continue.")).kind, "idle");
    const saved = await checkpoints(sdk, sessionId);
    assert.equal(saved.length, 1);
    const checkpoint = saved[0];
    assert.ok(checkpoint);
    assert.equal(checkpoint.body.summary, "");
    assert.equal(checkpoint.body.material?.provider, provider);
    assert.equal(checkpoint.body.material?.model, "gpt-6-astra");
    assert.ok(checkpoint.body.tokensBefore >= 400_000);
    assert.match(JSON.stringify(checkpoint.body.retainedTail), /Remember the migration plan/);
    assert.deepEqual(remote.requests.at(-1)?.context.checkpoint, checkpoint.body.material);
    assert.deepEqual(remote.summaries, []);
    assert.deepEqual(
      remote.requests.map((request) => request.model.contextWindow),
      [1_000_000, 1_000_000, 1_000_000],
    );
    assert.equal(await lastAssistantText(sdk, sessionId), "Answer 3");
    assert.equal((await assertContextWindow(sdk, sessionId, 1_000_000)).usageTokens, 20);

    const events = await eventsSoFar(sdk, sessionId);
    assert.deepEqual(
      events
        .filter((event) => event.kind === "compaction")
        .map((event) => event.compaction?.reason ?? null),
      ["threshold", null],
    );
    const published = events.find(
      (event) => event.kind === "commit" && event.item.commit.body.kind === "checkpoint",
    );
    const answered = events.find(
      (event) =>
        event.kind === "commit" &&
        event.item.commit.body.kind === "message" &&
        event.item.commit.body.message.role === "assistant" &&
        event.item.commit.body.message.usage.totalTokens === 20,
    );
    assert.ok(published && answered);
    assert.ok(published.seq < answered.seq, "checkpoint is durable before the next answer");
  },
);

test.each([
  ["openai", "gpt-6-astra-preview"],
  ["openai-codex", "gpt-6"],
  ["other", "gpt-6-astra"],
])("%s/%s keeps its catalog window and reserve-based threshold", async (provider, id) => {
  const world = workspace();
  const model = modelFor(provider, id);
  const remote = scriptedProvider(99_900, 99_901, 20);
  const sdk = await world.open({
    model,
    plugins: [astra, nativeCompaction],
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
    streamFn: remote.streamFn,
  });
  const sessionId = world.sessionId;

  await prompt(sdk, sessionId, "Remember this.");
  await prompt(sdk, sessionId, "Reach the catalog limit.");
  assert.deepEqual(await checkpoints(sdk, sessionId), []);
  assert.equal((await assertContextWindow(sdk, sessionId, 100_000)).usageTokens, 99_901);
  await prompt(sdk, sessionId, "Continue.");
  assert.equal((await checkpoints(sdk, sessionId)).length, 1);
  assert.equal(await lastAssistantText(sdk, sessionId), "Answer 3");
  assert.deepEqual(
    remote.requests.map((request) => request.model.contextWindow),
    [100_000, 100_000, 100_000],
  );
  await assertContextWindow(sdk, sessionId, 100_000);
});

test.each(["openai", "openai-codex"])(
  "%s Astra leaves automatic compaction disabled",
  async (provider) => {
    const world = workspace();
    const remote = scriptedProvider(400_000, 999_999, 20);
    const sdk = await world.open({
      model: modelFor(provider),
      plugins: [astra, nativeCompaction],
      compaction: { enabled: false, reserveTokens: 100, keepRecentTokens: 1 },
      streamFn: remote.streamFn,
    });
    const sessionId = world.sessionId;

    await prompt(sdk, sessionId, "Reach 400k.");
    await prompt(sdk, sessionId, "Keep going without compaction.");
    assert.equal((await assertContextWindow(sdk, sessionId, 1_000_000)).usageTokens, 999_999);
    await prompt(sdk, sessionId, "Continue beyond the ordinary reserve.");
    assert.deepEqual(await checkpoints(sdk, sessionId), []);
    assert.deepEqual(
      (await eventsSoFar(sdk, sessionId)).filter((event) => event.kind === "compaction"),
      [],
    );
    assert.deepEqual(remote.summaries, []);
    assert.deepEqual(
      remote.requests.map((request) => request.model.contextWindow),
      [1_000_000, 1_000_000, 1_000_000],
    );
    assert.equal(await lastAssistantText(sdk, sessionId), "Answer 3");
  },
);

test.each(["openai", "openai-codex"])(
  "removing the plugin restores %s Astra's catalog window and compaction threshold",
  async (provider) => {
    const world = workspace();
    const model = { ...modelFor(provider), contextWindow: 800_000 };
    const remote = scriptedProvider(400_000, 799_901, 20, 400_000, 20);
    const sdk = await world.open({
      model,
      plugins: [astra, nativeCompaction],
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
      streamFn: remote.streamFn,
    });
    const sessionId = world.sessionId;

    await prompt(sdk, sessionId, "Remember this.");
    await assertContextWindow(sdk, sessionId, 1_000_000);
    await sdk.setPlugins([nativeCompaction]);
    await assertContextWindow(sdk, sessionId, 800_000);
    await prompt(sdk, sessionId, "Use the catalog threshold now.");
    assert.deepEqual(await checkpoints(sdk, sessionId), []);
    await prompt(sdk, sessionId, "Compact at the catalog limit.");
    assert.equal((await checkpoints(sdk, sessionId)).length, 1);

    await sdk.setPlugins([astra, nativeCompaction]);
    await assertContextWindow(sdk, sessionId, 1_000_000);
    await prompt(sdk, sessionId, "Restore Astra's threshold.");
    await prompt(sdk, sessionId, "Continue with the restored policy.");
    assert.equal((await checkpoints(sdk, sessionId)).length, 2);
    assert.deepEqual(
      remote.requests.map((request) => request.model.contextWindow),
      [1_000_000, 800_000, 800_000, 1_000_000, 1_000_000],
    );
    assert.equal(await lastAssistantText(sdk, sessionId), "Answer 5");
  },
);

test.each([
  { provider: "openai", contextWindow: 600_000 },
  { provider: "openai-codex", contextWindow: 600_000 },
  { provider: "openai", contextWindow: 1_000_000 },
  { provider: "openai-codex", contextWindow: 1_000_000 },
])(
  "$provider Astra respects and removes a later $contextWindow-token policy",
  async ({ provider, contextWindow }) => {
    const world = workspace();
    const remote = scriptedProvider(420_000, 450_000, 420_000, 20);
    const override = inlinePlugin(
      definePlugin({
        id: "workspace-context-policy",
        session(api) {
          api.modelContext.add((draft) => {
            draft.set(`${provider}/gpt-6-astra`, {
              contextWindow,
              compactAt: 450_000,
            });
          });
        },
      }),
    );
    const sdk = await world.open({
      model: modelFor(provider),
      plugins: [astra, nativeCompaction],
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
      streamFn: remote.streamFn,
    });
    const sessionId = world.sessionId;

    await prompt(sdk, sessionId, "Reach 420k.");
    await sdk.setPlugins([astra, nativeCompaction, override]);
    await assertContextWindow(sdk, sessionId, contextWindow);
    await prompt(sdk, sessionId, "Wait until the workspace threshold.");
    assert.deepEqual(await checkpoints(sdk, sessionId), []);
    await prompt(sdk, sessionId, "Compact at 450k.");
    assert.equal((await checkpoints(sdk, sessionId)).length, 1);

    await sdk.setPlugins([astra, nativeCompaction]);
    await assertContextWindow(sdk, sessionId, 1_000_000);
    await prompt(sdk, sessionId, "Use Astra's threshold again.");
    assert.equal((await checkpoints(sdk, sessionId)).length, 2);
    assert.deepEqual(
      remote.requests.map((request) => request.model.contextWindow),
      [1_000_000, contextWindow, contextWindow, 1_000_000],
    );
    assert.equal(await lastAssistantText(sdk, sessionId), "Answer 4");
  },
);

test("model switching follows the selected provider and model rather than the host default", async () => {
  const world = workspace();
  const openai = modelFor("openai");
  const codex = modelFor("openai-codex");
  const nonAstra = { ...modelFor("openai", "gpt-6"), contextWindow: 800_000 };
  const otherAstra = { ...modelFor("other"), contextWindow: 700_000 };
  const remote = scriptedProvider(400_000, 400_000, 20, 20, 20);
  const sdk = await world.open({
    model: openai,
    models: [openai, codex, nonAstra, otherAstra],
    plugins: [astra, nativeCompaction],
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
    streamFn: remote.streamFn,
  });
  const sessionId = world.sessionId;

  await prompt(sdk, sessionId, "Start on OpenAI Astra.");
  for (const model of [nonAstra, codex, otherAstra, openai]) {
    assert.equal(
      (
        await sdk.sessions.configure({
          sessionId,
          model: { provider: model.provider, id: model.id },
        })
      ).kind,
      "queued",
    );
    await prompt(sdk, sessionId, `Continue on ${model.provider}/${model.id}.`);
    await assertContextWindow(
      sdk,
      sessionId,
      model === openai || model === codex ? 1_000_000 : model.contextWindow,
    );
    assert.equal((await checkpoints(sdk, sessionId)).length, model === nonAstra ? 0 : 1);
  }
  assert.deepEqual(
    remote.requests.map((request) => [
      request.model.provider,
      request.model.id,
      request.model.contextWindow,
    ]),
    [
      ["openai", "gpt-6-astra", 1_000_000],
      ["openai", "gpt-6", 800_000],
      ["openai-codex", "gpt-6-astra", 1_000_000],
      ["other", "gpt-6-astra", 700_000],
      ["openai", "gpt-6-astra", 1_000_000],
    ],
  );
  assert.equal((await checkpoints(sdk, sessionId))[0]?.body.material?.provider, "openai-codex");
  assert.equal(remote.requests[3]?.context.checkpoint, undefined);
  assert.match(JSON.stringify(remote.requests[3]?.context.messages), /Start on OpenAI Astra/);
  assert.equal(await lastAssistantText(sdk, sessionId), "Answer 5");
});

test("Astra preserves the host's portable-summary reserve and recent-message retention", async () => {
  const world = workspace();
  const remote = scriptedProvider(400_000, 20);
  const sdk = await world.open({
    model: modelFor("openai"),
    plugins: [astra],
    compaction: { enabled: true, reserveTokens: 250, keepRecentTokens: 1 },
    streamFn: remote.streamFn,
  });
  const sessionId = world.sessionId;

  await prompt(sdk, sessionId, "Remember the migration constraints.");
  await prompt(sdk, sessionId, "Keep this recent request verbatim.");
  const saved = await checkpoints(sdk, sessionId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.body.material, undefined);
  assert.equal(saved[0]?.body.summary, "Portable project summary.");
  assert.deepEqual(
    saved[0]?.body.retainedTail.map((message) => message.content),
    [[{ type: "text", text: "Keep this recent request verbatim." }]],
  );
  assert.ok(remote.summaries.length > 0);
  for (const summary of remote.summaries) {
    assert.equal(summary.model.contextWindow, 1_000_000);
    assert.ok(summary.maxTokens !== undefined && summary.maxTokens > 0 && summary.maxTokens <= 250);
  }
  assert.match(JSON.stringify(remote.summaries[0]?.context.messages), /migration constraints/);
  assert.match(
    JSON.stringify(remote.requests.at(-1)?.context.messages),
    /Portable project summary/,
  );
  assert.equal(await lastAssistantText(sdk, sessionId), "Answer 2");
  await assertContextWindow(sdk, sessionId, 1_000_000);
});
