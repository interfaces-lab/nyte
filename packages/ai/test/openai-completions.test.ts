import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { stream } from "../src/api/openai-completions.ts";
import type { Context, JsonValue, Model } from "../src/types.ts";

const model = {
  id: "test-model",
  name: "Test",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://example.invalid/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
} satisfies Model<"openai-completions">;

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const stopped = { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] };

async function exchange(input: {
  messages?: Context["messages"];
  chunks: readonly JsonValue[];
  compat?: Model<"openai-completions">["compat"];
}) {
  let body = "";
  const result = await stream(
    { ...model, compat: input.compat },
    { messages: input.messages ?? [] },
    {
      apiKey: "test",
      maxRetries: 0,
      fetch: async (url, init) => {
        body = await new Request(url, init).text();
        return new Response(
          input.chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    },
  ).result();
  return { result, body };
}

test("reasoning details retain order and provider extensions across stream and replay", async () => {
  const details = [
    { type: "reasoning.summary", summary: "inspect the file", index: 0 },
    { type: "reasoning.encrypted", data: "opaque", id: "r1", extra: { version: 2 } },
    { type: "reasoning.text", text: "read it", signature: null },
  ] as const satisfies readonly JsonValue[];
  const { result } = await exchange({
    chunks: [
      {
        choices: [
          { delta: { reasoning_details: [...details, { type: "reasoning.encrypted", data: 42 }] } },
        ],
      },
      stopped,
    ],
  });
  assert.equal(result.stopReason, "stop");
  const thinking = result.content.find((block) => block.type === "thinking");
  assert.ok(thinking?.thinkingSignature);
  assert.deepEqual(JSON.parse(thinking.thinkingSignature), details);
  const replay = await exchange({ messages: [result], chunks: [stopped] });
  expect(JSON.parse(replay.body)).toMatchObject({
    messages: [{ role: "assistant", content: "answer", reasoning_details: details }],
  });
});

test("incomplete tool arguments survive a failed stream without parser scratch fields", async () => {
  const { result } = await exchange({
    chunks: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"a"' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "Stream ended without finish_reason");
  assert.deepEqual(result.content, [
    { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
  ]);
});

test("message conversion keeps text, tool calls, grouped image results, and the following user message", async () => {
  const { body, result } = await exchange({
    chunks: [stopped],
    compat: { requiresToolResultName: true },
    messages: [
      {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage,
        stopReason: "toolUse",
        timestamp: 0,
        content: [
          { type: "text", text: "reading" },
          { type: "thinking", thinking: "inspect" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
          { type: "toolCall", id: "call_2", name: "read", arguments: { path: "b" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        timestamp: 1,
        isError: false,
        content: [
          { type: "text", text: "first" },
          { type: "image", mimeType: "image/png", data: "YQ==" },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "read",
        timestamp: 2,
        isError: false,
        content: [{ type: "text", text: "second" }],
      },
      { role: "user", content: "next", timestamp: 3 },
    ],
  });
  assert.equal(result.stopReason, "stop");
  expect(JSON.parse(body)).toMatchObject({
    messages: [
      {
        role: "assistant",
        content: "reading",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
          { id: "call_2", type: "function", function: { name: "read", arguments: '{"path":"b"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", name: "read", content: "first" },
      { role: "tool", tool_call_id: "call_2", name: "read", content: "second" },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached image(s) from tool result:" },
          { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } },
        ],
      },
      { role: "user", content: "next" },
    ],
  });
});
