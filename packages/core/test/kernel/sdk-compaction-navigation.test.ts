/** SDK checkpoint and summary navigation behavior over the real kernel store. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Usage } from "@nyte-ai/schema";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import {
  sessionId,
  type ModelCatalog,
  type Nyte,
  type NyteOptions,
  type SessionEvent,
  type SessionId,
} from "../../src/kernel/sdk/types.ts";
import type { StreamFn, ThinkingLevel } from "../../src/types.ts";
import { assistant, message, openStore, seedHead, usage, user, within } from "./helpers.ts";

function testModel(id: string, reasoning = false): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10_000,
    maxTokens: 1_000,
  };
}

const fallbackModel = testModel("fallback-model");
const declaredModel = testModel("declared-model");
const reasoningModel = testModel("reasoning-model", true);
const heavyUsage: Usage = { ...usage, input: 5_000, totalTokens: 5_005 };
const branchSummaryText = `The user explored a different conversation branch before returning here.
Summary of that exploration:

BRANCH WORK`;

function catalog(models: readonly Model<Api>[]): ModelCatalog {
  return {
    getModels: (provider) =>
      provider === undefined
        ? models
        : models.filter((candidate) => candidate.provider === provider),
    getModel: (provider, id) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === id),
  };
}

interface ScriptOptions {
  readonly summary: string;
  readonly summaryFailure?: string;
  readonly gate?: Promise<void>;
}

interface ScriptCall {
  readonly model: string;
  readonly prompt: string;
  readonly summarizing: boolean;
  readonly reasoning: string | undefined;
}

function script(options: ScriptOptions) {
  const calls: ScriptCall[] = [];
  const streamFn: StreamFn = (model, context, streamOptions) => {
    const summarizing = context.systemPrompt?.includes("summarization assistant") === true;
    calls.push({
      model: model.id,
      prompt: JSON.stringify(context.messages),
      summarizing,
      reasoning: streamOptions?.reasoning,
    });
    const stream = createAssistantMessageEventStream();
    const answer: AssistantMessage =
      summarizing && options.summaryFailure !== undefined
        ? assistant("", { stop: "error", error: options.summaryFailure })
        : assistant(summarizing ? options.summary : "regular answer", { usage: heavyUsage });
    void (async () => {
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "regular", partial: answer });
      if (!summarizing) await options.gate;
      if (answer.stopReason === "error") {
        stream.push({ type: "error", reason: "error", error: answer });
      } else {
        stream.push({ type: "done", reason: "stop", message: answer });
      }
    })();
    return stream;
  };
  return { streamFn, calls };
}

async function openNyte(input: {
  readonly store: ReturnType<typeof openStore>;
  readonly streamFn: StreamFn;
  readonly models?: readonly Model<Api>[];
  readonly model?: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
}): Promise<Nyte> {
  const models = input.models ?? [fallbackModel];
  const base: NyteOptions = {
    store: input.store,
    streamFn: input.streamFn,
    models: catalog(models),
    model: input.model ?? fallbackModel,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
  };
  return createNyte(
    input.thinkingLevel === undefined ? base : { ...base, thinkingLevel: input.thinkingLevel },
  );
}

/** Read events after `afterSeq` until the head's run reaches a terminal phase. */
async function untilRunEnds(nyte: Nyte, id: SessionId, afterSeq: number): Promise<void> {
  const iterator = nyte.watch({ sessionId: id, afterSeq })[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await within(iterator.next());
      if (next.done) assert.fail("event stream ended before the run finished");
      if (next.value.kind !== "run") continue;
      const phase = next.value.run.phase.kind;
      if (phase === "done" || phase === "failed" || phase === "aborted") return;
    }
  } finally {
    await iterator.return?.();
  }
}

async function eventsUntilCommit(
  nyte: Nyte,
  id: SessionId,
  afterSeq: number,
  commit: string,
): Promise<SessionEvent[]> {
  const iterator = nyte.watch({ sessionId: id, afterSeq })[Symbol.asyncIterator]();
  const events: SessionEvent[] = [];
  try {
    for (;;) {
      const next = await within(iterator.next());
      if (next.done) assert.fail("event stream ended before the checkpoint commit");
      events.push(next.value);
      if (next.value.kind === "commit" && next.value.item.oid === commit) return events;
    }
  } finally {
    await iterator.return?.();
  }
}

test("manual compact keeps transcript history, shrinks context, and uses the branch model", async () => {
  const store = openStore();
  const session = await store.create({ id: "compact" });
  await seedHead(session, "main", [
    { kind: "config", model: { provider: "openai", id: declaredModel.id } },
    message(user("the first request has enough detail to preserve in a checkpoint")),
    message(assistant("the first answer has enough detail too", { usage: heavyUsage })),
    message(user("latest")),
  ]);
  const modelScript = script({ summary: "SHORT CHECKPOINT" });
  const nyte = await openNyte({
    store,
    streamFn: modelScript.streamFn,
    models: [fallbackModel, declaredModel],
  });
  const id = sessionId("compact");
  try {
    const beforeTurns = (await nyte.messages.list({ sessionId: id })).filter(
      (turn) => turn.kind === "turn",
    );
    const beforeContext = await nyte.runs.context({ sessionId: id });
    const beforeSeq = await session.events.last();

    const outcome = await nyte.runs.compact({
      sessionId: id,
      customInstructions: "keep the exact decision",
    });
    assert.equal(outcome.kind, "compacted");
    if (outcome.kind !== "compacted") return;

    const turns = await nyte.messages.list({ sessionId: id });
    assert.deepEqual(
      turns.filter((turn) => turn.kind === "turn"),
      beforeTurns,
    );
    assert.equal(turns.filter((turn) => turn.kind === "checkpoint").length, 1);
    assert.ok(
      (await nyte.runs.context({ sessionId: id })).estimatedTokens < beforeContext.estimatedTokens,
    );
    assert.equal(
      modelScript.calls
        .filter((call) => call.summarizing)
        .every((call) => call.model === declaredModel.id),
      true,
    );
    assert.ok(
      modelScript.calls.some(
        (call) => call.summarizing && call.prompt.includes("keep the exact decision"),
      ),
    );

    const events = await eventsUntilCommit(nyte, id, beforeSeq, outcome.commit);
    assert.ok(
      events.some(
        (event) =>
          event.kind === "head_moved" && event.reason === "manual" && event.to === outcome.commit,
      ),
    );
    assert.equal(events.filter((event) => event.kind === "commit").length, 1);
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, outcome.commit);

    // The context is already cut at the checkpoint, so there is nothing more to summarize.
    const summaryCalls = modelScript.calls.filter((call) => call.summarizing).length;
    assert.deepEqual(await nyte.runs.compact({ sessionId: id }), { kind: "nothing_to_compact" });
    assert.equal(modelScript.calls.filter((call) => call.summarizing).length, summaryCalls);
    assert.equal(
      (await nyte.messages.list({ sessionId: id })).filter((turn) => turn.kind === "checkpoint")
        .length,
      1,
    );
  } finally {
    await nyte.close();
  }
});

test("manual compact summarizes at the branch's thinking level, or the host's when none is declared", async () => {
  const store = openStore();
  const declaredSession = await store.create({ id: "declared-thinking" });
  await seedHead(declaredSession, "main", [
    { kind: "config", thinkingLevel: "high" },
    message(user("the first request has enough detail to preserve in a checkpoint")),
    message(assistant("the first answer has enough detail too", { usage: heavyUsage })),
    message(user("latest")),
  ]);
  const hostSession = await store.create({ id: "host-thinking" });
  await seedHead(hostSession, "main", [
    message(user("the first request has enough detail to preserve in a checkpoint")),
    message(assistant("the first answer has enough detail too", { usage: heavyUsage })),
    message(user("latest")),
  ]);
  const modelScript = script({ summary: "SHORT CHECKPOINT" });
  const nyte = await openNyte({
    store,
    streamFn: modelScript.streamFn,
    models: [reasoningModel],
    model: reasoningModel,
    thinkingLevel: "low",
  });
  try {
    const declared = await nyte.runs.compact({ sessionId: sessionId("declared-thinking") });
    assert.equal(declared.kind, "compacted");
    assert.deepEqual(
      modelScript.calls.filter((call) => call.summarizing).map((call) => call.reasoning),
      ["high"],
    );

    modelScript.calls.length = 0;
    const host = await nyte.runs.compact({ sessionId: sessionId("host-thinking") });
    assert.equal(host.kind, "compacted");
    assert.deepEqual(
      modelScript.calls.filter((call) => call.summarizing).map((call) => call.reasoning),
      ["low"],
    );
  } finally {
    await nyte.close();
  }
});

test("manual compact reports an empty session and a live run by value", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const modelScript = script({ summary: "unused", gate });
  const nyte = await openNyte({ store: openStore(), streamFn: modelScript.streamFn });
  try {
    const empty = await nyte.sessions.create({ sessionId: sessionId("empty") });
    assert.deepEqual(await nyte.runs.compact({ sessionId: empty.sessionId }), {
      kind: "nothing_to_compact",
    });

    const active = await nyte.sessions.create({ sessionId: sessionId("active") });
    nyte.attach({ sessions: [active.sessionId] });
    await nyte.messages.send({ sessionId: active.sessionId, content: "hold" });
    const events = nyte.watch({ sessionId: active.sessionId, afterSeq: 0 })[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await within(events.next());
        if (next.done) assert.fail("event stream ended before the live run streamed");
        if (next.value.kind === "text_delta") break;
      }
    } finally {
      await events.return?.();
    }

    const current = await nyte.runs.current({ sessionId: active.sessionId });
    const compacted = await nyte.runs.compact({ sessionId: active.sessionId });
    assert.equal(compacted.kind, "busy");
    if (compacted.kind === "busy") assert.equal(compacted.run.runId, current?.runId);
    release?.();
    assert.deepEqual(await nyte.runs.wait({ sessionId: active.sessionId }), { kind: "idle" });
  } finally {
    release?.();
    await nyte.close();
  }
});

test("summary navigation carries abandoned work onto the destination; plain navigation does not", async () => {
  const store = openStore();
  const summarizedSession = await store.create({ id: "summarized" });
  const summarizedOids = await seedHead(summarizedSession, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const plainSession = await store.create({ id: "plain" });
  const plainOids = await seedHead(plainSession, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const modelScript = script({ summary: "BRANCH WORK" });
  const nyte = await openNyte({ store, streamFn: modelScript.streamFn });
  try {
    const summarizedId = sessionId("summarized");
    const selected = summarizedOids[0];
    const sourceTip = summarizedOids[3];
    assert.ok(selected !== undefined && sourceTip !== undefined);
    const moved = await nyte.heads.move({
      sessionId: summarizedId,
      to: selected,
      summary: { customInstructions: "focus on the second attempt" },
    });
    assert.equal(moved.kind, "moved");
    if (moved.kind !== "moved") return;
    assert.equal(moved.from, sourceTip);
    assert.equal(moved.restored?.commit, selected);
    assert.ok(moved.summary !== undefined);

    const summaryObject = await summarizedSession.objects.get(moved.summary);
    assert.equal(summaryObject?.kind, "commit");
    if (summaryObject?.kind !== "commit") return;
    assert.equal(summaryObject.parent, null);
    assert.deepEqual(summaryObject.imports, summarizedOids.slice(1));
    assert.equal(summaryObject.body.kind, "summary");
    if (summaryObject.body.kind === "summary") {
      assert.equal(summaryObject.body.text, branchSummaryText);
    }
    assert.deepEqual(
      (await nyte.messages.list({ sessionId: summarizedId })).map((turn) => turn.kind),
      ["summary"],
    );
    assert.ok(
      modelScript.calls.some(
        (call) => call.summarizing && call.prompt.includes("focus on the second attempt"),
      ),
    );

    const plainId = sessionId("plain");
    const plainSelected = plainOids[0];
    assert.ok(plainSelected !== undefined);
    const plain = await nyte.heads.move({ sessionId: plainId, to: plainSelected });
    assert.equal(plain.kind, "moved");
    if (plain.kind === "moved") assert.equal(plain.summary, undefined);
    assert.equal(
      (await nyte.messages.list({ sessionId: plainId })).some((turn) => turn.kind === "summary"),
      false,
    );
  } finally {
    await nyte.close();
  }
});

test("a failed branch summary leaves the head at its source tip", async () => {
  const store = openStore();
  const session = await store.create({ id: "failed-summary" });
  const oids = await seedHead(session, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const selected = oids[0];
  const sourceTip = oids[3];
  assert.ok(selected !== undefined && sourceTip !== undefined);
  const modelScript = script({ summary: "unused", summaryFailure: "provider down" });
  const nyte = await openNyte({ store, streamFn: modelScript.streamFn });
  try {
    const id = sessionId("failed-summary");
    assert.deepEqual(await nyte.heads.move({ sessionId: id, to: selected, summary: {} }), {
      kind: "failed",
      message: "Branch summarization failed: provider down",
    });
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, sourceTip);
  } finally {
    await nyte.close();
  }
});

test("summary navigation to a user message writes the summary under that message's parent and keeps the abandoned answer out of model context", async () => {
  const store = openStore();
  const session = await store.create({ id: "restore-summary" });
  const oids = await seedHead(session, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const [first, firstAnswer, second, secondAnswer] = oids;
  assert.ok(
    first !== undefined &&
      firstAnswer !== undefined &&
      second !== undefined &&
      secondAnswer !== undefined,
  );
  const modelScript = script({ summary: "BRANCH WORK" });
  const nyte = await openNyte({ store, streamFn: modelScript.streamFn });
  try {
    const id = sessionId("restore-summary");
    const moved = await nyte.heads.move({ sessionId: id, to: second, summary: {} });
    assert.equal(moved.kind, "moved");
    if (moved.kind !== "moved") return;
    assert.equal(moved.from, secondAnswer);
    assert.equal(moved.restored?.commit, second);
    assert.ok(moved.summary !== undefined);

    const summaryObject = await session.objects.get(moved.summary);
    assert.equal(summaryObject?.kind, "commit");
    if (summaryObject?.kind !== "commit") return;
    assert.equal(summaryObject.parent, firstAnswer);
    assert.deepEqual(summaryObject.imports, [secondAnswer]);
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, moved.summary);
    assert.deepEqual(
      (await nyte.messages.list({ sessionId: id })).map((turn) => turn.kind),
      ["turn", "summary"],
    );
    // Only the abandoned answer was summarized; the retained history was not.
    const summarized = modelScript.calls.filter((call) => call.summarizing);
    assert.equal(summarized.length, 1);
    assert.ok(summarized[0]?.prompt.includes("second answer"));
    assert.equal(summarized[0]?.prompt.includes("first answer"), false);

    // The next response sees the retained history and the summary, never the
    // abandoned answer: imports are provenance, not context.
    const beforeSeq = await session.events.last();
    nyte.attach({ sessions: [id] });
    await nyte.messages.send({ sessionId: id, content: "third" });
    await untilRunEnds(nyte, id, beforeSeq);
    const response = modelScript.calls.find((call) => !call.summarizing);
    assert.ok(response !== undefined);
    assert.ok(response.prompt.includes("first answer"));
    assert.ok(response.prompt.includes("BRANCH WORK"));
    assert.equal(response.prompt.includes("second answer"), false);
  } finally {
    await nyte.close();
  }
});

test("summary navigation is a plain move when nothing is abandoned", async () => {
  const store = openStore();
  const session = await store.create({ id: "forward" });
  const oids = await seedHead(session, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const firstAnswer = oids[1];
  const secondAnswer = oids[3];
  assert.ok(firstAnswer !== undefined && secondAnswer !== undefined);
  const modelScript = script({ summary: "unused" });
  const nyte = await openNyte({ store, streamFn: modelScript.streamFn });
  try {
    const id = sessionId("forward");
    const back = await nyte.heads.move({ sessionId: id, to: firstAnswer });
    assert.equal(back.kind, "moved");

    // Moving forward again abandons nothing on the way: no model call, no summary commit.
    const forward = await nyte.heads.move({ sessionId: id, to: secondAnswer, summary: {} });
    assert.deepEqual(forward, { kind: "moved", from: firstAnswer });
    assert.equal(modelScript.calls.length, 0);
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, secondAnswer);
    assert.equal(
      (await nyte.messages.list({ sessionId: id })).some((turn) => turn.kind === "summary"),
      false,
    );
  } finally {
    await nyte.close();
  }
});

test("summary navigation still honors expect and moves nothing on a stale view", async () => {
  const store = openStore();
  const session = await store.create({ id: "stale-view" });
  const oids = await seedHead(session, "main", [
    message(user("first")),
    message(assistant("first answer")),
    message(user("second")),
    message(assistant("second answer")),
  ]);
  const first = oids[0];
  const firstAnswer = oids[1];
  const secondAnswer = oids[3];
  assert.ok(first !== undefined && firstAnswer !== undefined && secondAnswer !== undefined);
  const modelScript = script({ summary: "BRANCH WORK" });
  const nyte = await openNyte({ store, streamFn: modelScript.streamFn });
  try {
    const id = sessionId("stale-view");
    const stale = await nyte.heads.move({
      sessionId: id,
      to: first,
      expect: firstAnswer,
      summary: {},
    });
    assert.deepEqual(stale, { kind: "moved_since", tip: secondAnswer });
    assert.equal(modelScript.calls.length, 0);
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, secondAnswer);

    const current = await nyte.heads.move({
      sessionId: id,
      to: first,
      expect: secondAnswer,
      summary: {},
    });
    assert.equal(current.kind, "moved");
    if (current.kind === "moved") assert.ok(current.summary !== undefined);
  } finally {
    await nyte.close();
  }
});
