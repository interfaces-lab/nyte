import assert from "node:assert/strict";
import { test } from "vitest";
import { lazyStream } from "../src/api/lazy.ts";
import { OPENAI_MODELS } from "../src/providers/openai.models.ts";
import type { AssistantMessage } from "../src/types.ts";
import { AssistantMessageEventStream, EventStream } from "../src/utils/event-stream.ts";

async function collect<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

const model = OPENAI_MODELS["gpt-5.4"];
const message: AssistantMessage = {
  role: "assistant",
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
  timestamp: 0,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

test("event queues retain order across consumers and expose their terminal result", async () => {
  const source = new EventStream<number>(
    (value) => value === 3,
    (value) => value,
  );
  source.push(1);
  source.push(2);
  source.push(3);
  source.end();
  const first = source[Symbol.asyncIterator]();
  const second = source[Symbol.asyncIterator]();
  assert.deepEqual(await first.next(), { done: false, value: 1 });
  assert.deepEqual(await second.next(), { done: false, value: 2 });
  assert.deepEqual(await first.next(), { done: false, value: 3 });
  assert.deepEqual(await second.next(), { done: true, value: undefined });
  assert.equal(await source.result(), 3);
});

test("ending a stream releases every waiting consumer", async () => {
  const source = new EventStream<number>(
    () => false,
    (value) => value,
  );
  const first = source[Symbol.asyncIterator]().next();
  const second = source[Symbol.asyncIterator]().next();
  source.end(42);
  assert.deepEqual(await first, { done: true, value: undefined });
  assert.deepEqual(await second, { done: true, value: undefined });
  assert.equal(await source.result(), 42);
});

test("undefined is a valid queued value rather than an empty queue", async () => {
  const source = new EventStream<undefined>(
    () => false,
    () => undefined,
  );
  source.push(undefined);
  source.end();
  assert.deepEqual(await collect(source), [undefined]);
});

test("lazy setup forwards both terminal events and explicit results without events", async () => {
  for (const emit of [false, true]) {
    const source = lazyStream(model, async () => {
      const inner = new AssistantMessageEventStream();
      if (emit) inner.push({ type: "done", reason: "stop", message });
      inner.end(message);
      return inner;
    });
    assert.deepEqual(
      await collect(source),
      emit ? [{ type: "done", reason: "stop", message }] : [],
    );
    assert.deepEqual(await source.result(), message);
  }
});

test("lazy setup failures become an error event and a terminal result", async () => {
  const source = lazyStream(model, async () => {
    throw new Error("offline");
  });
  const events = await collect(source);
  const result = await source.result();
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "offline");
  assert.deepEqual(events, [{ type: "error", reason: "error", error: result }]);
});
