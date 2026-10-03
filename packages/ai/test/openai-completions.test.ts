import { normalizeContext } from "@nyte-ai/schema";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { stream } from "../src/api/openai-completions.ts";
import type { Context, JsonValue, Model, Tool } from "../src/types.ts";

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
const ping: Tool = {
  name: "ping",
  description: "Ping tool",
  parameters: Type.Object({
    required: Type.String(),
    optional: Type.Optional(Type.String()),
  }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

async function exchange(input: {
  messages?: Context["messages"];
  tools?: Tool[];
  chunks: readonly JsonValue[];
  compat?: Model<"openai-completions">["compat"];
}) {
  let body = "";
  const result = await stream(
    { ...model, compat: input.compat },
    normalizeContext({ messages: input.messages ?? [], tools: input.tools }),
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

test("consecutive text and summary reasoning details deltas merge before replay", async () => {
  const encrypted = { type: "reasoning.encrypted", id: "call_1", data: "encrypted-signature" };
  const laterSummary = {
    type: "reasoning.summary",
    summary: "After encrypted block.",
    format: "openai-responses-v1",
    index: 0,
  };
  const deltas = [
    { type: "reasoning.text", text: "The", index: 0 },
    {
      type: "reasoning.text",
      text: " user wants the time.",
      signature: "sha256:text-signature",
      format: "openai-responses-v1",
      index: 0,
    },
    { type: "reasoning.summary", summary: "Looked", index: 0 },
    { type: "reasoning.summary", summary: " up time.", format: "openai-responses-v1", index: 0 },
    encrypted,
    laterSummary,
  ] as const satisfies readonly JsonValue[];
  const expected = [
    {
      type: "reasoning.text",
      text: "The user wants the time.",
      index: 0,
      signature: "sha256:text-signature",
      format: "openai-responses-v1",
    },
    {
      type: "reasoning.summary",
      summary: "Looked up time.",
      index: 0,
      format: "openai-responses-v1",
    },
    encrypted,
    laterSummary,
  ];
  const { result } = await exchange({
    chunks: [
      ...deltas.map((detail) => ({ choices: [{ delta: { reasoning_details: [detail] } }] })),
      stopped,
    ],
  });
  const thinking = result.content.find((block) => block.type === "thinking");
  assert.deepEqual(thinking, {
    type: "thinking",
    thinking: "",
    thinkingSignature: JSON.stringify(expected),
  });
  const replay = await exchange({ messages: [result], chunks: [stopped] });
  expect(JSON.parse(replay.body)).toMatchObject({
    messages: [{ role: "assistant", content: "answer", reasoning_details: expected }],
  });
});

test("user messages with images omit empty text parts", async () => {
  const { body } = await exchange({
    chunks: [stopped],
    messages: [
      {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "" },
          { type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
        ],
      },
    ],
  });
  expect(JSON.parse(body).messages).toEqual([
    {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }],
    },
  ]);
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

test("unknown OpenAI-compatible endpoints default to non-strict tools", async () => {
  const { body } = await exchange({ tools: [ping], chunks: [stopped] });
  const request = JSON.parse(body);
  expect(request).not.toHaveProperty("tools.0.function.strict");
  expect(request).toMatchObject({
    tools: [{ function: { parameters: { required: ["required"] } } }],
  });
});

test("catalog strict-mode metadata keeps strict tools", async () => {
  const { body } = await exchange({
    tools: [ping],
    chunks: [stopped],
    compat: { supportsStrictMode: true },
  });
  expect(JSON.parse(body)).toMatchObject({
    tools: [{ function: { strict: true, parameters: { required: ["required", "optional"] } } }],
  });
});
