import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { InMemoryTelemetryContext, NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { HookRegistry } from "../../src/plugins/hooks.ts";
import { activeCompaction } from "../../src/kernel/compaction.ts";
import { headRef, runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { requestStream } from "../../src/kernel/sdk/requests.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import { startSpan } from "../../src/kernel/telemetry.ts";
import { bindTurn } from "../../src/kernel/turn.ts";
import { assistant, drain, message, openSession, seedHead, user } from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

test.each(["text", "reasoning", "aborted", "noop"])(
  "request timing measures first event and first visible text while forwarding every %s event",
  async (kind) => {
    const recording = kind !== "noop";
    const memory = new InMemoryTelemetryContext();
    const telemetry = recording ? memory : NOOP_TELEMETRY_CONTEXT;
    const inner = createAssistantMessageEventStream();
    let requests = 0;
    const stream = requestStream({
      hooks: new HookRegistry(() => undefined),
      invocation: () => ({ sessionId: "s", head: "main", runId: "r", attempt: 1 }),
      step: "assistant",
      streamFn: () => {
        requests += 1;
        return inner;
      },
    });
    const controller = new AbortController();
    const out = await stream(
      model,
      { messages: [] },
      {
        telemetryContext: telemetry,
        signal: controller.signal,
      },
    );
    const iterator = out[Symbol.asyncIterator]();
    const partial = assistant("");
    const start = { type: "start", partial } satisfies Parameters<typeof inner.push>[0];
    inner.push(start);
    assert.equal((await iterator.next()).value, start);
    const attributes = () => memory.spans()[0]?.attributes;
    if (recording) {
      const first = attributes()?.["nyte.ai.time_to_first_event_ms"];
      expect(first).toBeTypeOf("number");
      expect(first).toBeGreaterThanOrEqual(0);
      assert.equal(attributes()?.["nyte.ai.time_to_first_text_ms"], undefined);
    }
    const empty = {
      type: "text_delta",
      contentIndex: 0,
      delta: "",
      partial,
    } satisfies Parameters<typeof inner.push>[0];
    inner.push(empty);
    assert.equal((await iterator.next()).value, empty);
    assert.equal(attributes()?.["nyte.ai.time_to_first_text_ms"], undefined);
    let count = 2;
    if (kind === "text" || kind === "reasoning") {
      const delta = {
        type: kind === "text" ? "text_delta" : "thinking_delta",
        contentIndex: 0,
        delta: "visible only for text",
        partial,
      } satisfies Parameters<typeof inner.push>[0];
      inner.push(delta);
      assert.equal((await iterator.next()).value, delta);
      count += 1;
      if (recording && kind === "text") {
        const first = attributes()?.["nyte.ai.time_to_first_event_ms"];
        const text = attributes()?.["nyte.ai.time_to_first_text_ms"];
        expect(first).toBeTypeOf("number");
        expect(text).toBeTypeOf("number");
        expect(text).toBeGreaterThanOrEqual(Number(first));
        inner.push(delta);
        assert.equal((await iterator.next()).value, delta);
        count += 1;
        assert.equal(attributes()?.["nyte.ai.time_to_first_text_ms"], text);
      }
    }
    const final = assistant("", { stop: kind === "aborted" ? "aborted" : "stop" });
    if (kind === "aborted") controller.abort();
    const terminal =
      kind === "aborted"
        ? ({ type: "error", reason: "aborted", error: final } satisfies Parameters<
            typeof inner.push
          >[0])
        : ({ type: "done", reason: "stop", message: final } satisfies Parameters<
            typeof inner.push
          >[0]);
    inner.push(terminal);
    assert.equal((await iterator.next()).value, terminal);
    assert.equal((await iterator.next()).done, true);
    assert.equal(await out.result(), final);
    assert.equal(requests, 1);
    if (recording) {
      await expect.poll(() => memory.spans()[0]?.ended).toBe(true);
      assert.equal(attributes()?.["nyte.ai.event_count"], count + 1);
      if (kind !== "text") assert.equal(attributes()?.["nyte.ai.time_to_first_text_ms"], undefined);
    }
  },
);

test("a retried request starts fresh timing", async () => {
  const memory = new InMemoryTelemetryContext();
  const telemetry = memory;
  let attempt = 0;
  const stream = requestStream({
    hooks: new HookRegistry(() => undefined),
    invocation: () => ({ sessionId: "s", head: "main", runId: "r", attempt: attempt + 1 }),
    step: "assistant",
    streamFn: () => {
      attempt += 1;
      const inner = createAssistantMessageEventStream();
      const partial = assistant("");
      inner.push({ type: "start", partial });
      if (attempt === 1) {
        inner.push({
          type: "error",
          reason: "error",
          error: assistant("", { stop: "error", error: "429" }),
        });
      } else {
        inner.push({ type: "text_delta", contentIndex: 0, delta: "recovered", partial });
        inner.push({ type: "done", reason: "stop", message: assistant("recovered") });
      }
      return inner;
    },
  });
  for (const reason of ["error", "stop"]) {
    const out = await stream(model, { messages: [] }, { telemetryContext: telemetry });
    const types: string[] = [];
    for await (const event of out) types.push(event.type);
    assert.deepEqual(
      types,
      reason === "error" ? ["start", "error"] : ["start", "text_delta", "done"],
    );
    assert.equal((await out.result()).stopReason, reason);
  }
  assert.equal(attempt, 2);
  await expect.poll(() => memory.spans().every((span) => span.ended)).toBe(true);
  const [failed, recovered] = memory.spans();
  assert.equal(failed?.attributes["nyte.ai.time_to_first_text_ms"], undefined);
  assert.equal(failed?.attributes["nyte.ai.event_count"], 2);
  assert.equal(failed?.status.status, "error");
  assert.equal(recovered?.attributes["nyte.ai.event_count"], 3);
  const text = recovered?.attributes["nyte.ai.time_to_first_text_ms"];
  expect(text).toBeTypeOf("number");
  expect(text).toBeGreaterThanOrEqual(0);
});

test("the publish span reports the checkpoint CAS result, and durable state matches it", async () => {
  for (const result of ["published", "conflict", "fenced", "throw"]) {
    const telemetry = new InMemoryTelemetryContext();
    const session = await openSession();
    await seedHead(session, "main", [
      message(user("old work")),
      message(
        assistant("earlier answer", {
          usage: { ...assistant("").usage, input: 10_000, totalTokens: 10_000 },
        }),
      ),
    ]);
    const turn = bindTurn({
      model,
      systemPrompt: "test",
      tools: [],
      compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 0 },
      streamFn: () => {
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: assistant("summary") });
        return stream;
      },
    });
    await submit(session, {
      preparation: { kind: "none" },
      head: "main",
      delivery: "steer",
      kind: "user",
      body: message(user("continue")),
    });
    await step(session, turn, { head: "main", drain });
    const tip = await session.refs.read(headRef("main"));
    const run = await session.refs.read(runRef("main"));
    const failure = new Error("storage unavailable");
    const raced: Session = {
      id: session.id,
      objects: session.objects,
      leases: session.leases,
      events: session.events,
      close: () => session.close(),
      refs: {
        read: (name) => session.refs.read(name),
        list: (prefix) => session.refs.list(prefix),
        update: async (updates, options) => {
          if (options?.reason === "checkpoint") {
            if (result === "throw") throw failure;
            if (result === "fenced") {
              assert.ok(options.lease);
              await session.leases.release(options.lease);
            }
            if (result === "conflict") {
              assert.ok(
                (
                  await session.refs.update([{ name: headRef("main"), from: tip, to: null }], {
                    reason: "test race",
                  })
                ).ok,
              );
            }
          }
          return session.refs.update(updates, options);
        },
      },
    };
    if (result === "throw") {
      await assert.rejects(
        step(raced, turn, { head: "main", drain, telemetry }),
        (cause) => cause === failure,
      );
    } else {
      assert.equal(
        (await step(raced, turn, { head: "main", drain, telemetry })).kind,
        result === "fenced" ? "fenced" : "continue",
      );
    }
    assert.equal(await session.refs.read(runRef("main")), run);
    const after = await session.refs.read(headRef("main"));
    if (result === "published") {
      assert.ok(after !== null && after !== tip);
      const object = await session.objects.get(after);
      assert.ok(object?.kind === "commit" && object.body.kind === "checkpoint");
    } else {
      assert.equal(after, result === "conflict" ? null : tip);
    }
    assert.equal(await activeCompaction(session, "main"), undefined);
    const generated = telemetry.spans().find((span) => span.name === "nyte.compaction");
    const published = telemetry.spans().find((span) => span.name === "nyte.compaction.publish");
    assert.equal(generated?.attributes["nyte.compaction.outcome"], "summarized");
    assert.ok(generated?.ended && published?.ended);
    assert.equal(
      published.attributes["nyte.compaction.publication"],
      result === "throw" ? undefined : result,
    );
    assert.equal(published.status.status, result === "throw" ? "error" : "ok");
    await session.close();
  }
});

test("a span hands back its callback's value and rethrows its failure", async () => {
  const telemetry = new InMemoryTelemetryContext();
  const value = { result: "value" };
  const attributes = { "nyte.session.id": "s", "nyte.head": "main", "nyte.run.id": "r" };
  let calls = 0;
  assert.equal(
    await startSpan(telemetry, "nyte.compaction.publish", attributes, () => {
      calls += 1;
      return value;
    }),
    value,
  );
  await assert.rejects(
    startSpan(telemetry, "nyte.compaction.publish", attributes, () => {
      calls += 1;
      throw value;
    }),
    (cause) => cause === value,
  );
  assert.equal(calls, 2);
});
