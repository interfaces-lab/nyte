import assert from "node:assert/strict";
import { test } from "vitest";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { Message, ProviderCheckpointMaterial } from "@nyte-ai/schema";
import {
  generateSummaryWithUsage,
  serializeConversation,
  summarizeCheckpoint,
  summarizeBranch,
} from "../../src/kernel/compaction.ts";
import { hashObject } from "../../src/kernel/hash.ts";
import type { Commit, CommitBody, Oid } from "../../src/kernel/model.ts";
import { contextMessages } from "@nyte-ai/client";
import { estimateTokens, projectContextStatus } from "@nyte-ai/client";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import type { StreamFn } from "../../src/types.ts";
import { assistant, call, commit, message, openStore, seedHead, usage, user } from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 2_000,
  maxTokens: 100,
};
const target = { provider: model.provider, api: model.api, model: model.id };
const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 1 };
const material: ProviderCheckpointMaterial = {
  type: "provider",
  ...target,
  data: [{ type: "compaction", encrypted_content: "opaque" }],
};

function items(bodies: readonly CommitBody[]): { readonly oid: Oid; readonly commit: Commit }[] {
  let parent: Oid | null = null;
  return bodies.map((body) => {
    const value = commit(parent, body);
    const oid = hashObject(value);
    parent = oid;
    return { oid, commit: value };
  });
}

/** This provider rejects oversized requests and preserves facts in its summary. */
function boundedProvider(options: { readonly abort?: AbortController } = {}) {
  const requests: string[] = [];
  const streamFn: StreamFn = (selectedModel, context, streamOptions) => {
    const prompt = context.messages.map((entry) => contentText(entry.content)).join("\n");
    const inputTokens = Math.ceil(((context.systemPrompt?.length ?? 0) + prompt.length) / 4);
    assert.ok(inputTokens + (streamOptions?.maxTokens ?? 0) <= selectedModel.contextWindow);
    requests.push(prompt);
    const facts = [...new Set(prompt.match(/FACT\d+/g) ?? [])].sort();
    const answer = assistant(facts.join(", "));
    options.abort?.abort();
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: answer });
    return stream;
  };
  return { streamFn, requests };
}

const history = (): Message[] =>
  Array.from({ length: 8 }, (_, index) =>
    user(`FACT${String(index)} ${"conversation content ".repeat(220)}`),
  );

test("a portable summary that fits uses one request; a model too small for the instructions sends none", async () => {
  const provider = boundedProvider();
  const result = await generateSummaryWithUsage({
    currentMessages: [user("FACT1")],
    streamFn: provider.streamFn,
    model,
    reserveTokens: 100,
  });
  assert.ok(result.ok);
  assert.equal(result.value.text, "FACT1");
  assert.equal(provider.requests.length, 1);

  const tiny = await generateSummaryWithUsage({
    currentMessages: [user("FACT1")],
    streamFn: provider.streamFn,
    model: { ...model, contextWindow: 100 },
    reserveTokens: 10,
  });
  assert.ok(!tiny.ok);
  assert.equal(tiny.error.code, "summarization_failed");
  assert.equal(provider.requests.length, 1);
});

test("repeated native checkpoints fall back through bounded portable requests", async () => {
  const provider = boundedProvider();
  let commits = items(history().map(message));
  for (let round = 0; round < 2; round += 1) {
    const native = await summarizeCheckpoint({
      commits,
      streamFn: provider.streamFn,
      model,
      settings,
      reason: "manual",
      providerCompaction: async () => ({ material, usage }),
    });
    assert.ok(native.ok);
    assert.equal(provider.requests.length, 0);
    commits = items([native.value, message(user(`FACT${String(8 + round)}`))]);
  }
  commits = items([
    ...commits.map((entry) => entry.commit.body),
    message(user("retained recent request")),
  ]);
  const result = await summarizeCheckpoint({
    commits,
    streamFn: provider.streamFn,
    model,
    settings,
    reason: "overflow",
    providerCompaction: async () => undefined,
  });
  assert.ok(result.ok);
  assert.ok(provider.requests.length > 1);
  for (let fact = 0; fact < 10; fact += 1) {
    assert.ok(result.value.summary.includes(`FACT${String(fact)}`));
  }
  assert.equal(result.value.usage?.totalTokens, usage.totalTokens * provider.requests.length);
  assert.equal(result.value.material, undefined);
});

test("an oversized turn prefix and previous summary are summarized within the model window", async () => {
  const provider = boundedProvider();
  const result = await summarizeCheckpoint({
    commits: items([
      { kind: "checkpoint", summary: "FACT20", retainedTail: [], tokensBefore: 10 },
      message(user(serializeConversation(history()))),
      message(assistant("retained suffix")),
    ]),
    streamFn: provider.streamFn,
    model,
    settings,
    reason: "manual",
  });
  assert.ok(result.ok);
  assert.ok(provider.requests.length > 1);
  assert.ok(result.value.summary.includes("FACT20"));
  assert.ok(result.value.summary.includes("FACT7"));
  const previous = await generateSummaryWithUsage({
    currentMessages: [user("FACT99")],
    previousSummary: serializeConversation(history()),
    streamFn: provider.streamFn,
    model,
    reserveTokens: 100,
  });
  assert.ok(previous.ok);
  assert.ok(previous.value.text.includes("FACT0"));
  assert.ok(previous.value.text.includes("FACT7"));
  assert.ok(previous.value.text.includes("FACT99"));
});

test("cancellation stops a multi-request summary before the next chunk", async () => {
  const controller = new AbortController();
  const provider = boundedProvider({ abort: controller });
  const result = await generateSummaryWithUsage({
    currentMessages: history(),
    streamFn: provider.streamFn,
    model,
    reserveTokens: 100,
    signal: controller.signal,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "aborted");
  assert.equal(provider.requests.length, 1);
});

test("native context status excludes backup history and uses compact output usage", () => {
  const backup = [
    ...history(),
    assistant("old reply", { usage: { ...usage, input: 9_000, totalTokens: 9_005 } }),
  ];
  const checkpoint: CommitBody = {
    kind: "checkpoint",
    summary: "",
    retainedTail: backup,
    tokensBefore: 9_005,
    material,
    usage: { ...usage, input: 9_005, output: 40, totalTokens: 9_045 },
  };
  const tail = user("next");
  const commits = items([checkpoint, message(tail)]).map((entry) => entry.commit);
  const status = projectContextStatus(commits, model.contextWindow, target);
  assert.equal(status.estimatedTokens, 40 + estimateTokens(tail));
  assert.equal(status.usageTokens, 40);
  assert.equal(status.lastTurnTokens, undefined);
  const switched = projectContextStatus(commits, model.contextWindow, {
    ...target,
    model: "other-model",
  });
  assert.equal(
    switched.estimatedTokens,
    [...backup, tail].reduce((sum, entry) => sum + estimateTokens(entry), 0),
  );
  assert.equal(switched.usageTokens, 0);
  const resumed = items([checkpoint, message(assistant("new reply", { usage }))]).map(
    (entry) => entry.commit,
  );
  assert.equal(
    projectContextStatus(resumed, model.contextWindow, target).estimatedTokens,
    usage.totalTokens,
  );
});

test("portable fallback caps a larger model's retention budget after switching to a smaller model", async () => {
  const provider = boundedProvider();
  const messages = Array.from({ length: 80 }, (_, index) =>
    user(`FACT${String(index % 8)} ${"words ".repeat(100)}`),
  );
  const result = await summarizeCheckpoint({
    commits: items([
      { kind: "checkpoint", summary: "", retainedTail: messages, tokensBefore: 20_000, material },
      message(user("continue")),
    ]),
    streamFn: provider.streamFn,
    model: { ...model, id: "smaller-model" },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    reason: "threshold",
  });
  assert.ok(result.ok);
  assert.ok(provider.requests.length > 1);
  const nextContext = contextMessages(items([result.value]).map((entry) => entry.commit));
  assert.ok(
    nextContext.reduce((sum, entry) => sum + estimateTokens(entry), 0) < model.contextWindow,
  );
  for (let index = 0; index < 8; index += 1)
    assert.ok(result.value.summary.includes(`FACT${String(index)}`));
});

test("a provider's denser tokenization retries the same history with smaller chunks", async () => {
  let rejected = 0;
  const streamFn: StreamFn = (_selectedModel, context) => {
    const prompt = context.messages.map((entry) => contentText(entry.content)).join("\n");
    const tooLarge = prompt.length + (context.systemPrompt?.length ?? 0) > model.contextWindow * 2;
    if (tooLarge) rejected += 1;
    const answer = tooLarge
      ? assistant("", {
          stop: "error",
          error: "Your input exceeds the context window of this model",
        })
      : assistant([...new Set(prompt.match(/FACT\d+/g) ?? [])].sort().join(", "));
    const stream = createAssistantMessageEventStream();
    if (answer.stopReason === "error")
      stream.push({ type: "error", reason: "error", error: answer });
    else stream.push({ type: "done", reason: "stop", message: answer });
    return stream;
  };
  const result = await generateSummaryWithUsage({
    currentMessages: history(),
    streamFn,
    model,
    reserveTokens: 100,
  });
  assert.ok(result.ok);
  assert.ok(rejected > 0);
  for (let index = 0; index < 8; index += 1)
    assert.ok(result.value.text.includes(`FACT${String(index)}`));
});

test("branch navigation summarizes the full native backup within the model window", async () => {
  const store = openStore();
  const session = await store.create({ id: "native-branch-history" });
  const written = await seedHead(session, "main", [
    message(user("return here")),
    {
      kind: "checkpoint",
      summary: "",
      tokensBefore: 30_000,
      material,
      retainedTail: [
        ...history(),
        assistant("FACT99", {
          calls: [call("write-branch", "write", { path: "/tmp/branch-result.ts" })],
        }),
      ],
    },
    message(user("latest branch message")),
  ]);
  const destination = written[0];
  assert.ok(destination !== undefined);
  const provider = boundedProvider();
  const nyte = await createNyte({
    store,
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    env: { cwd: "/tmp" },
    plugins: [],
    streamFn: provider.streamFn,
  });
  try {
    const moved = await nyte.heads.move({
      sessionId: sessionId(session.id),
      to: destination,
      summary: { customInstructions: "Preserve branch constraints" },
    });
    assert.equal(moved.kind, "moved");
    assert.ok(moved.kind === "moved" && moved.summary !== undefined);
    const stored = await session.objects.get(moved.summary);
    assert.ok(stored?.kind === "commit" && stored.body.kind === "summary");
    assert.ok(stored.body.text.includes("FACT0"));
    assert.ok(stored.body.text.includes("FACT7"));
    assert.ok(stored.body.text.includes("FACT99"));
    assert.ok(stored.body.text.includes("/tmp/branch-result.ts"));
    assert.ok(provider.requests.length > 1);
    assert.ok(provider.requests.every((prompt) => prompt.includes("Preserve branch constraints")));
    assert.equal(stored.body.usage?.totalTokens, provider.requests.length * usage.totalTokens);
  } finally {
    await nyte.close();
  }
});

test("branch summarization still rejects tool calls instead of saving them as a summary", async () => {
  const streamFn: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "toolUse",
      message: assistant("", { calls: [call("c", "read")] }),
    });
    return stream;
  };
  const result = await summarizeBranch({
    abandoned: items([message(user("branch work"))]),
    model,
    streamFn,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "summarization_failed");
});
