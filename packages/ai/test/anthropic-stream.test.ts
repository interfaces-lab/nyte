import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { stream, type AnthropicOptions } from "../src/api/anthropic-messages.ts";
import type { AccountLimits, JsonValue, Model } from "../src/types.ts";

const model = {
  id: "claude-test",
  name: "Claude Test",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
} satisfies Model<"anthropic-messages">;

function frame(event: JsonValue & { type: string }) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const start = frame({
  type: "message_start",
  message: {
    id: "msg_test",
    model: model.id,
    usage: {
      input_tokens: 20,
      output_tokens: 0,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_creation: { ephemeral_1h_input_tokens: 1 },
    },
  },
});
const textStart = frame({
  type: "content_block_start",
  index: 0,
  content_block: { type: "text", text: "" },
});
const textDelta = frame({
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: "answer" },
});
const textStop = frame({ type: "content_block_stop", index: 0 });
const stop = frame({ type: "message_stop" });

function finish(reason = "end_turn") {
  return frame({ type: "message_delta", delta: { stop_reason: reason } }) + stop;
}

async function run(
  body: string,
  options?: {
    chunkBytes?: number;
    onAccountLimits?: AnthropicOptions["onAccountLimits"];
  },
) {
  const bytes = new TextEncoder().encode(body);
  const chunkBytes = options?.chunkBytes ?? Math.max(1, bytes.length);
  const source = stream(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
    {
      apiKey: "test",
      maxRetries: 0,
      onAccountLimits: options?.onAccountLimits,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
                controller.enqueue(bytes.subarray(offset, offset + chunkBytes));
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    },
  );
  const kinds: string[] = [];
  for await (const event of source) kinds.push(event.type);
  return { result: await source.result(), kinds };
}

test("interleaved tool calls retain initial arguments and never persist parser state", async () => {
  const { result, kinds } = await run(
    start +
      [
        frame({
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "a", name: "read", input: {} },
        }),
        frame({ type: "content_block_start", index: 7, content_block: { type: "text", text: "" } }),
        frame({
          type: "content_block_start",
          index: 5,
          content_block: { type: "tool_use", id: "b", name: "read", input: { path: "b" } },
        }),
        frame({
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"path":"a"' },
        }),
        frame({
          type: "content_block_delta",
          index: 7,
          delta: { type: "text_delta", text: "reading" },
        }),
        frame({ type: "content_block_stop", index: 2 }),
        frame({ type: "content_block_stop", index: 7 }),
        frame({ type: "content_block_stop", index: 5 }),
      ].join("") +
      finish("tool_use"),
  );
  assert.equal(result.stopReason, "toolUse");
  assert.equal(kinds.at(-1), "done");
  assert.deepEqual(result.content, [
    { type: "toolCall", id: "a", name: "read", arguments: { path: "a" } },
    { type: "text", text: "reading" },
    { type: "toolCall", id: "b", name: "read", arguments: { path: "b" } },
  ]);
});

test("thinking signatures and redacted reasoning survive decoding", async () => {
  const { result } = await run(
    start +
      [
        frame({
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "consider", signature: "sig" },
        }),
        frame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: " it" },
        }),
        frame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "nature" },
        }),
        frame({ type: "content_block_stop", index: 0 }),
        frame({
          type: "content_block_start",
          index: 1,
          content_block: { type: "redacted_thinking", data: "opaque" },
        }),
        frame({ type: "content_block_stop", index: 1 }),
      ].join("") +
      finish(),
  );
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(result.content, [
    { type: "thinking", thinking: "consider it", thinkingSignature: "signature" },
    {
      type: "thinking",
      thinking: "[Reasoning redacted]",
      thinkingSignature: "opaque",
      redacted: true,
    },
  ]);
});

test("nullable usage deltas preserve initial counts and decode reasoning-token extensions", async () => {
  const { result } = await run(
    start +
      textStart +
      textDelta +
      textStop +
      frame({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_details: null },
        usage: {
          input_tokens: null,
          output_tokens: 7,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
          output_tokens_details: { thinking_tokens: 4, future_field: "preserved" },
        },
      }) +
      stop,
  );
  assert.equal(result.stopReason, "stop");
  expect(result.usage).toMatchObject({
    input: 20,
    output: 7,
    cacheRead: 2,
    cacheWrite: 3,
    cacheWrite1h: 1,
    reasoning: 4,
    totalTokens: 32,
  });
});

test("unknown event and content variants do not interrupt known content", async () => {
  const limits: AccountLimits[] = [];
  const { result } = await run(
    start +
      [
        "event: ping\ndata: not json\n\n",
        frame({
          type: "rate_limit_event",
          rate_limit_info: { rateLimitType: "five_hour", utilization: 0.5 },
        }),
        frame({
          type: "content_block_start",
          index: 9,
          content_block: { type: "future_block", data: [] },
        }),
        frame({ type: "content_block_delta", index: 9, delta: { type: "future_delta", data: [] } }),
        frame({ type: "content_block_stop", index: 9 }),
        textStart,
        textDelta,
        textStop,
      ].join("") +
      finish(),
    {
      onAccountLimits: (value) => {
        limits.push(value);
      },
    },
  );
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(result.content, [{ type: "text", text: "answer" }]);
  assert.deepEqual(
    limits.map((value) => value.windows),
    [[{ id: "five_hour", usedPercent: 50 }]],
  );
});

test.each([
  { name: "missing message", body: frame({ type: "message_start" }) },
  {
    name: "string token count",
    body: frame({
      type: "message_start",
      message: { id: "bad", model: model.id, usage: { input_tokens: "20" } },
    }),
  },
  {
    name: "negative token count",
    body: frame({ type: "message_delta", delta: {}, usage: { output_tokens: -1 } }),
  },
  {
    name: "non-finite token count",
    body: 'event: message_delta\ndata: {"type":"message_delta","delta":{},"usage":{"output_tokens":1e999}}\n\n',
  },
  {
    name: "array tool arguments",
    body: frame({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "bad", name: "read", input: [] },
    }),
  },
  {
    name: "invalid text",
    body: frame({
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: 42 },
    }),
  },
  {
    name: "missing delta text",
    body: frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta" } }),
  },
  {
    name: "non-string partial JSON",
    body: frame({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: {} },
    }),
  },
  { name: "negative block index", body: frame({ type: "content_block_stop", index: -1 }) },
  { name: "null body", body: "event: message_delta\ndata: null\n\n" },
  {
    name: "mismatched event name",
    body: 'event: content_block_stop\ndata: {"type":"message_stop"}\n\n',
  },
])("rejects $name without losing content already received", async ({ body }) => {
  const { result, kinds } = await run(start + textStart + textDelta + body + finish());
  assert.equal(result.stopReason, "error");
  assert.equal(kinds.at(-1), "error");
  assert.match(result.errorMessage ?? "", /Could not parse Anthropic SSE event/);
  assert.deepEqual(result.content, [{ type: "text", text: "answer" }]);
});

test("repairs malformed string literals after joining SSE data lines", async () => {
  const raw =
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a\ndata: b\t\\q"}}\n\n';
  const { result } = await run(start + textStart + raw + textStop + finish());
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(result.content, [{ type: "text", text: "a\nb\t\\q" }]);
});

test("decodes UTF-8 and CRLF split across byte-sized chunks and flushes the final event at EOF", async () => {
  const delta = frame({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "café 🌙" },
  });
  const body = (start + textStart + delta + textStop + finish()).trimEnd().replaceAll("\n", "\r\n");
  const { result } = await run(body, { chunkBytes: 1 });
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(result.content, [{ type: "text", text: "café 🌙" }]);
});

test("early EOF retains partial tool arguments without scratch fields", async () => {
  const { result } = await run(
    start +
      frame({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "a", name: "read", input: {} },
      }) +
      frame({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":"a"' },
      }),
  );
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "Anthropic stream ended before message_stop");
  assert.deepEqual(result.content, [
    { type: "toolCall", id: "a", name: "read", arguments: { path: "a" } },
  ]);
});

test.each(["sensitive", "future_reason"])("preserves provider stop reason %s", async (reason) => {
  const { result } = await run(start + finish(reason));
  assert.equal(result.stopReason, "error");
  assert.equal(result.rawStopReason, reason);
  assert.ok(result.errorMessage?.includes(reason));
});

test("reports a refusal explanation without requiring unrelated SDK fields", async () => {
  const { result } = await run(
    start +
      frame({
        type: "message_delta",
        delta: { stop_reason: "refusal", stop_details: { explanation: "cannot comply" } },
      }) +
      stop,
  );
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "cannot comply");
});

test("malformed frames cancel the remaining response body", async () => {
  const cancelled = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          start +
            textStart +
            textDelta +
            frame({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: 42 },
            }),
        ),
      );
    },
    cancel() {
      cancelled.resolve();
    },
  });
  const result = await stream(
    model,
    { messages: [] },
    {
      apiKey: "test",
      maxRetries: 0,
      fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    },
  ).result();
  await cancelled.promise;
  assert.equal(result.stopReason, "error");
  assert.deepEqual(result.content, [{ type: "text", text: "answer" }]);
});

test("abort interrupts a blocked response read and retains partial content", async () => {
  const blocked = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const chunks = [new TextEncoder().encode(start + textStart + textDelta)];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else blocked.resolve();
      },
      cancel() {
        cancelled.resolve();
      },
    },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const source = stream(
    model,
    { messages: [] },
    {
      apiKey: "test",
      maxRetries: 0,
      signal: controller.signal,
      fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    },
  );
  await blocked.promise;
  controller.abort();
  const result = await source.result();
  await cancelled.promise;
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(result.content, [{ type: "text", text: "answer" }]);
});
