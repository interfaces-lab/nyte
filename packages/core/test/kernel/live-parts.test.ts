import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema";
import type { SessionEvent } from "@nyte-ai/protocol";
import { projectEvent } from "../../src/kernel/sdk/events.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import {
  appendTranscriptCommit,
  EMPTY_LIVE_PARTS,
  foldLiveParts,
  livePartKey,
} from "@nyte-ai/client";
import {
  assistant,
  chain,
  message,
  openSession,
  openStore,
  toolResult,
  within,
} from "./helpers.ts";

const text: SessionEvent = {
  seq: 1,
  kind: "text_delta",
  runId: "r1",
  attempt: 1,
  index: 0,
  delta: "hello",
};

test("parts accumulate by kind, run, attempt and index, regardless of shared seq", () => {
  const first = foldLiveParts(EMPTY_LIVE_PARTS, text);
  const events: SessionEvent[] = [
    { ...text, delta: " world" },
    { ...text, kind: "reasoning_delta", delta: "thinking" },
    { ...text, runId: "r2", delta: "other run" },
    { ...text, attempt: 2, delta: "other attempt" },
    { ...text, index: 1, delta: "other index" },
  ];
  const parts = events.reduce(foldLiveParts, first);
  assert.deepEqual(
    parts.map((part) => [livePartKey(part), part.kind === "tool" ? "" : part.text]),
    [
      ["text:r1:1:0", "hello world"],
      ["thinking:r1:1:0", "thinking"],
      ["text:r2:1:0", "other run"],
      ["text:r1:2:0", "other attempt"],
      ["text:r1:1:1", "other index"],
    ],
  );
  assert.deepEqual(first, [{ kind: "text", runId: "r1", attempt: 1, index: 0, text: "hello" }]);
});

test("tool updates replace progress and move only that call to its latest arrival", () => {
  const progress = {
    seq: 2,
    kind: "tool_progress",
    runId: "r1",
    callId: "c1",
    progress: { text: "first", title: "title" },
  } satisfies SessionEvent;
  const before = [progress, text, { ...progress, callId: "c2" }].reduce(
    foldLiveParts,
    EMPTY_LIVE_PARTS,
  );
  const after = foldLiveParts(before, { ...progress, progress: { text: "new" } });
  assert.deepEqual(after.map(livePartKey), ["text:r1:1:0", "tool:c2", "tool:c1"]);
  assert.deepEqual(after.at(-1), {
    kind: "tool",
    runId: "r1",
    callId: "c1",
    progress: { text: "new" },
  });
  assert.deepEqual(before.map(livePartKey), ["tool:c1", "text:r1:1:0", "tool:c2"]);
});

test("retry and terminal phases clear only their run", () => {
  const events: SessionEvent[] = [
    text,
    { ...text, runId: "r2" },
    { seq: 2, kind: "tool_progress", runId: "r1", callId: "c1", progress: { text: "x" } },
  ];
  const parts = events.reduce(foldLiveParts, EMPTY_LIVE_PARTS);
  for (const phase of [
    {
      kind: "retry",
      at: 99,
      retries: 1,
      failure: { class: "provider", message: "retry" },
    },
    { kind: "done" },
    { kind: "aborted" },
    { kind: "failed", failure: { class: "provider", message: "failed" } },
  ] as const) {
    const after = foldLiveParts(parts, {
      seq: 3,
      kind: "run",
      head: "main",
      run: {
        runId: "r1",
        head: "main",
        origin: { kind: "user" },
        root: "r1",
        startedAt: 0,
        attempts: 1,
        config: {},
        phase,
      },
    });
    assert.deepEqual(after.map(livePartKey), ["text:r2:1:0"]);
  }
});

test("one stored head advance settles every tool result even when all commits share seq", async () => {
  const session = await openSession();
  const oids = await chain(
    session,
    null,
    [message(toolResult("c1", "read", "one")), message(toolResult("c2", "read", "two"))],
    { run: "r1" },
  );
  const events = await projectEvent(
    {
      seq: 7,
      at: 1,
      kind: "ref",
      name: "refs/heads/main",
      from: null,
      to: oids.at(-1) ?? null,
      reason: "tools",
    },
    session.objects,
  );
  assert.deepEqual(
    events.map((event) => [event.kind, event.seq]),
    [
      ["head_moved", 7],
      ["commit", 7],
      ["commit", 7],
    ],
  );
  const before = [
    text,
    ...["c1", "c2", "c3"].map((callId): SessionEvent => ({
      seq: 6,
      kind: "tool_progress",
      runId: "r1",
      callId,
      progress: { text: callId },
    })),
  ].reduce(foldLiveParts, EMPTY_LIVE_PARTS);
  const after = events.reduce(foldLiveParts, before);
  assert.deepEqual(after.map(livePartKey), ["text:r1:1:0", "tool:c3"]);
});

test("assistant settlement preserves other runs and config preserves active streams", async () => {
  const session = await openSession();
  const oids = await chain(
    session,
    null,
    [{ kind: "config", thinkingLevel: "high" }, message(assistant("hello"))],
    { run: "r1" },
  );
  const events = await projectEvent(
    {
      seq: 7,
      at: 1,
      kind: "ref",
      name: "refs/heads/main",
      from: null,
      to: oids.at(-1) ?? null,
      reason: "respond",
    },
    session.objects,
  );
  let parts = [text, { ...text, runId: "r2" }].reduce(foldLiveParts, EMPTY_LIVE_PARTS);
  for (const event of events) {
    parts = foldLiveParts(parts, event);
    if (event.kind === "commit" && event.item.commit.body.kind === "config") {
      assert.deepEqual(parts.map(livePartKey), ["text:r1:1:0", "text:r2:1:0"]);
    }
  }
  assert.deepEqual(parts.map(livePartKey), ["text:r2:1:0"]);
});

test("an ordinary scripted run folds to the authoritative snapshot", async () => {
  const model: Model<Api> = {
    id: "test-model",
    name: "Test",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1000,
  };
  const nyte = await createNyte({
    store: openStore(),
    model,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    streamFn: () => {
      const stream = createAssistantMessageEventStream();
      const answer = assistant("hello world");
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "hello", partial: answer });
      stream.push({ type: "text_delta", contentIndex: 0, delta: " world", partial: answer });
      stream.push({ type: "done", reason: "stop", message: answer });
      return stream;
    },
  });
  const controller = new AbortController();
  try {
    const { sessionId } = await nyte.sessions.create();
    const before = await nyte.sessions.snapshot({ sessionId });
    assert.ok(before);
    let transcript = { items: before.transcript, tip: before.tip };
    let parts = EMPTY_LIVE_PARTS;
    const streamed: string[] = [];
    await nyte.messages.send({ sessionId, content: "question" });
    nyte.attach();
    await within(
      (async () => {
        for await (const event of nyte.watch({
          sessionId,
          afterSeq: before.seq,
          signal: controller.signal,
        })) {
          parts = foldLiveParts(parts, event);
          if (event.kind === "text_delta") {
            streamed.push(parts.map((part) => (part.kind === "tool" ? "" : part.text)).join(""));
          }
          if (event.kind === "commit") {
            const next = appendTranscriptCommit(transcript, event.item);
            assert.ok(next);
            transcript = next;
          }
          if (event.kind === "run" && event.run.phase.kind === "done") break;
        }
      })(),
    );
    await nyte.runs.wait({ sessionId });
    const after = await nyte.sessions.snapshot({ sessionId });
    assert.ok(after);
    assert.deepEqual(streamed, ["hello", "hello world"]);
    assert.deepEqual(parts, []);
    assert.deepEqual(transcript, { items: after.transcript, tip: after.tip });
  } finally {
    controller.abort();
    await nyte.close();
  }
});
