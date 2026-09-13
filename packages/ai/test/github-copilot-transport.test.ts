import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { openAICompletionsApi } from "../src/api/openai-completions.lazy.ts";
import { hasApi } from "../src/models.ts";
import { githubCopilotProvider } from "../src/providers/github-copilot.ts";
import type { Context, JsonValue, Model } from "../src/types.ts";
import {
  MODELS,
  ORIGIN,
  SESSION_TOKEN,
  anthropicSse,
  copilotModels,
  fakeFetch,
  json,
  signIn,
  sse,
} from "./github-copilot-fixture.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestBody(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);
  assert.ok(isObject(parsed), `Expected a JSON object: ${body}`);
  return parsed;
}

function messageWithRole(body: Record<string, unknown>, role: string): Record<string, unknown> {
  assert.ok(Array.isArray(body.messages));
  const message = body.messages.find((entry) => isObject(entry) && entry.role === role);
  assert.ok(isObject(message), `Expected a ${role} message`);
  return message;
}

function responseItem(body: Record<string, unknown>, type: string): Record<string, unknown> {
  assert.ok(Array.isArray(body.input));
  const item = body.input.find((entry) => isObject(entry) && entry.type === type);
  assert.ok(isObject(item), `Expected a ${type} response item`);
  return item;
}

const tools: Context["tools"] = [
  { name: "read", description: "read", parameters: { type: "object", properties: {} } },
];

const user = (content: string, timestamp: number): Context["messages"][number] => ({
  role: "user",
  content,
  timestamp,
});

const copilot = githubCopilotProvider();
const completions = openAICompletionsApi();

function generatedModel(id: string) {
  const model = copilot.getModels().find((entry) => entry.id === id);
  assert.ok(model, `Missing generated Copilot model: ${id}`);
  return model;
}

const toolResult = (id: string): Context["messages"][number] => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: "contents" }],
  isError: false,
  timestamp: 1,
});

describe("GitHub Copilot transport", () => {
  test("login exchanges the GitHub token and uses the session token for generated chat inference", async () => {
    let turn = 0;
    const setup = copilotModels({
      [MODELS]: () => json({ data: [{ id: "gemini-3.8-flash", model_picker_enabled: true }] }),
      [`POST ${ORIGIN}/chat/completions`]: () => {
        turn += 1;
        return turn === 1
          ? sse([
              { choices: [{ delta: { reasoning_opaque: "state-1" } }] },
              { choices: [{ delta: { reasoning_text: "need " } }] },
              { choices: [{ delta: { reasoning_text: "the file" } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          type: "function",
                          function: { name: "read", arguments: '{"path":"a"}' },
                        },
                      ],
                    },
                  },
                ],
              },
              { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            ])
          : sse([{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }]);
      },
    });
    await signIn(setup.models);
    const model = setup.models.getModel("github-copilot", "gemini-3.8-flash");
    assert.ok(model);

    const first = await setup.models
      .streamSimple(
        model,
        { messages: [user("read it", 0)], tools },
        { sessionId: "s-1", cacheRetention: "none", fetch: setup.fetch },
      )
      .result();
    assert.equal(first.stopReason, "toolUse");
    const thinking = first.content.find((block) => block.type === "thinking");
    assert.ok(thinking && thinking.type === "thinking");
    assert.equal(thinking.thinking, "need the file");
    assert.equal(thinking.thinkingSignature, JSON.stringify({ reasoning_opaque: "state-1" }));

    const second = await setup.models
      .streamSimple(
        model,
        { messages: [user("read it", 0), first, toolResult("call_1")], tools },
        { sessionId: "s-1", fetch: setup.fetch },
      )
      .result();
    assert.equal(second.stopReason, "stop");

    const chat = setup.requests.filter((request) => request.url === `${ORIGIN}/chat/completions`);
    assert.equal(chat.length, 2);
    const initial = chat[0];
    const followUp = chat[1];
    assert.ok(initial && followUp);
    const exchange = setup.requests.find((request) => request.url.endsWith("/v2/token"));
    assert.equal(exchange?.headers.get("authorization"), "Bearer gh-token");
    assert.equal(initial.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
    assert.equal(initial.headers.get("x-api-key"), null);
    assert.equal(initial.headers.get("x-github-api-version"), "2026-06-01");
    assert.equal(initial.headers.get("x-initiator"), "user");
    assert.equal(initial.headers.get("x-interaction-type"), "conversation-agent");
    assert.equal(initial.headers.get("x-interaction-id"), "s-1");
    assert.equal(initial.headers.get("x-client-request-id"), null);
    assert.equal(initial.headers.get("x-session-affinity"), null);
    assert.equal(initial.headers.get("openai-intent"), "conversation-edits");
    assert.equal(initial.headers.get("user-agent"), "GitHubCopilotChat/0.35.0");
    assert.equal(followUp.headers.get("x-initiator"), "agent");
    const body = requestBody(followUp.body);
    assert.equal(body.model, "gemini-3.8-flash");
    assert.ok(Array.isArray(body.messages));
    const assistant = messageWithRole(body, "assistant");
    assert.partialDeepStrictEqual(assistant, {
      reasoning_opaque: "state-1",
      reasoning_text: "need the file",
      tool_calls: [{ id: "call_1" }],
    });
    const last = body.messages.at(-1);
    assert.ok(isObject(last));
    assert.equal(last.role, "tool");
    assert.equal(last.tool_call_id, "call_1");
  });

  test("an explicit budget chat definition sends thinking_budget and clamps unavailable effort", async () => {
    const transport = fakeFetch({
      [`POST ${ORIGIN}/chat/completions`]: () =>
        sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
    });
    const model: Model<"openai-completions"> = {
      ...chatModel,
      id: "claude-chat",
      maxTokens: 16000,
      thinkingLevelMap: { high: null, xhigh: null, max: null },
      compat: {
        supportsReasoningEffort: false,
        thinkingTokenBudgetField: "thinking_budget",
        maxTokensField: "max_tokens",
      },
    };
    // `high` (16384 tokens) exceeds the range and clamps to the highest offered level.
    await completions
      .streamSimple(
        model,
        { messages: [user("hi", 0)] },
        { apiKey: SESSION_TOKEN, reasoning: "high", fetch: transport.fetch },
      )
      .result();
    await completions
      .streamSimple(
        model,
        { messages: [user("hi", 0)] },
        { apiKey: SESSION_TOKEN, fetch: transport.fetch },
      )
      .result();
    const requests = transport.requests.filter(
      (request) => request.url === `${ORIGIN}/chat/completions`,
    );
    const highRequest = requests[0];
    const offRequest = requests[1];
    assert.ok(highRequest && offRequest);
    const high = requestBody(highRequest.body);
    const off = requestBody(offRequest.body);
    assert.equal(high.thinking_budget, 8192);
    assert.equal(high.reasoning_effort, undefined);
    assert.equal(high.max_tokens, 16000);
    assert.equal(off.thinking_budget, undefined);
  });

  test("a generated Responses model: encrypted reasoning, tool call, and replay across rotating ids", async () => {
    let turn = 0;
    const transport = fakeFetch({
      [`POST ${ORIGIN}/responses`]: () => {
        turn += 1;
        return turn === 1
          ? sse([
              { type: "response.created", sequence_number: 0, response: { id: "resp_1" } },
              {
                type: "response.output_item.added",
                sequence_number: 1,
                output_index: 0,
                item: { type: "reasoning", id: "rs_a", summary: [] },
              },
              {
                type: "response.reasoning_summary_text.delta",
                sequence_number: 2,
                output_index: 0,
                summary_index: 0,
                item_id: "rs_b",
                delta: "thinking",
              },
              {
                type: "response.output_item.done",
                sequence_number: 3,
                output_index: 0,
                item: {
                  type: "reasoning",
                  id: "rs_c",
                  summary: [{ type: "summary_text", text: "thinking" }],
                  encrypted_content: "enc-1",
                },
              },
              {
                type: "response.output_item.added",
                sequence_number: 4,
                output_index: 1,
                item: {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "read",
                  arguments: "",
                },
              },
              {
                type: "response.function_call_arguments.delta",
                sequence_number: 5,
                output_index: 1,
                item_id: "fc_1",
                delta: '{"path":"a"}',
              },
              {
                type: "response.output_item.done",
                sequence_number: 6,
                output_index: 1,
                item: {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "read",
                  arguments: '{"path":"a"}',
                },
              },
              {
                type: "response.completed",
                sequence_number: 7,
                response: { id: "resp_1", status: "completed" },
              },
            ])
          : sse([
              { type: "response.created", sequence_number: 0, response: { id: "resp_2" } },
              {
                type: "response.completed",
                sequence_number: 1,
                response: { id: "resp_2", status: "completed" },
              },
            ]);
      },
    });
    const model = generatedModel("gpt-5.5");
    assert.ok(hasApi(model, "openai-responses"));

    const first = await copilot
      .streamSimple(
        model,
        { messages: [user("read it", 0)], tools },
        {
          apiKey: SESSION_TOKEN,
          sessionId: "s-2",
          reasoning: "medium",
          cacheRetention: "none",
          fetch: transport.fetch,
        },
      )
      .result();
    assert.equal(first.stopReason, "toolUse");
    const call = first.content.find((block) => block.type === "toolCall");
    assert.ok(call && call.type === "toolCall");
    assert.deepEqual(call.arguments, { path: "a" });

    await copilot
      .streamSimple(
        model,
        { messages: [user("read it", 0), first, toolResult("call_1")], tools },
        {
          apiKey: SESSION_TOKEN,
          sessionId: "s-2",
          reasoning: "medium",
          fetch: transport.fetch,
        },
      )
      .result();

    const responses = transport.requests.filter((request) => request.url === `${ORIGIN}/responses`);
    assert.equal(responses.length, 2);
    const initial = responses[0];
    const followUp = responses[1];
    assert.ok(initial && followUp);
    assert.equal(initial.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
    assert.equal(initial.headers.get("x-github-api-version"), "2026-06-01");
    assert.equal(initial.headers.get("x-interaction-id"), "s-2");
    assert.equal(initial.headers.get("x-client-request-id"), null);
    assert.equal(initial.headers.get("x-session-affinity"), null);
    assert.equal(initial.headers.get("x-initiator"), "user");
    assert.equal(followUp.headers.get("x-initiator"), "agent");
    const firstBody = requestBody(initial.body);
    assert.equal(firstBody.store, false);
    assert.deepEqual(firstBody.include, ["reasoning.encrypted_content"]);
    assert.ok(isObject(firstBody.reasoning));
    assert.equal(firstBody.reasoning.effort, "medium");
    const secondBody = requestBody(followUp.body);
    const replayed = responseItem(secondBody, "reasoning");
    assert.equal(replayed.encrypted_content, "enc-1");
    assert.equal(replayed.id, "rs_c");
    assert.equal(responseItem(secondBody, "function_call").call_id, "call_1");
    assert.equal(responseItem(secondBody, "function_call_output").call_id, "call_1");
  });

  test("a generated Messages model: bearer auth at /v1/messages, adaptive effort, and a tool round trip", async () => {
    let turn = 0;
    const messageStart = {
      type: "message_start",
      message: {
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4.6",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    const transport = fakeFetch({
      [`POST ${ORIGIN}/v1/messages`]: () => {
        turn += 1;
        return turn === 1
          ? anthropicSse([
              messageStart,
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {} },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json: '{"path":"a"}' },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "message_delta",
                delta: { stop_reason: "tool_use", stop_sequence: null },
                usage: { output_tokens: 1 },
              },
              { type: "message_stop" },
            ])
          : anthropicSse([
              messageStart,
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
              { type: "content_block_stop", index: 0 },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: 1 },
              },
              { type: "message_stop" },
            ]);
      },
    });
    const model = generatedModel("claude-sonnet-4.6");
    assert.ok(hasApi(model, "anthropic-messages"));

    const first = await copilot
      .streamSimple(
        model,
        { messages: [user("read it", 0)], tools },
        {
          apiKey: SESSION_TOKEN,
          sessionId: "s-3",
          reasoning: "high",
          cacheRetention: "none",
          fetch: transport.fetch,
        },
      )
      .result();
    assert.equal(first.stopReason, "toolUse");
    const second = await copilot
      .streamSimple(
        model,
        { messages: [user("read it", 0), first, toolResult("toolu_1")], tools },
        {
          apiKey: SESSION_TOKEN,
          sessionId: "s-3",
          reasoning: "high",
          fetch: transport.fetch,
        },
      )
      .result();
    assert.equal(second.stopReason, "stop");
    assert.equal(second.usage.input, 1);

    const sent = transport.requests.filter((request) => request.url === `${ORIGIN}/v1/messages`);
    assert.equal(sent.length, 2);
    const initial = sent[0];
    const followUp = sent[1];
    assert.ok(initial && followUp);
    assert.equal(initial.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
    assert.equal(initial.headers.get("x-api-key"), null);
    assert.equal(initial.headers.get("x-github-api-version"), "2026-06-01");
    assert.equal(initial.headers.get("x-initiator"), "user");
    assert.equal(initial.headers.get("x-interaction-id"), "s-3");
    assert.equal(initial.headers.get("x-client-request-id"), null);
    assert.equal(initial.headers.get("x-session-affinity"), null);
    assert.equal(initial.headers.get("openai-intent"), "conversation-edits");
    assert.equal(followUp.headers.get("x-initiator"), "agent");
    const body = requestBody(initial.body);
    assert.partialDeepStrictEqual(body, {
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    assert.ok(Array.isArray(body.tools));
    assert.equal(body.tools.length, 1);
    const followBody = requestBody(followUp.body);
    assert.ok(Array.isArray(followBody.messages));
    const last = followBody.messages.at(-1);
    assert.ok(isObject(last) && Array.isArray(last.content));
    assert.ok(isObject(last.content[0]));
    assert.equal(last.content[0].type, "tool_result");
  });

  test("a budget Messages definition sends token thinking and clamps unavailable effort", async () => {
    const transport = fakeFetch({
      [`POST ${ORIGIN}/v1/messages`]: () =>
        anthropicSse([
          {
            type: "message_start",
            message: {
              id: "m",
              type: "message",
              role: "assistant",
              model: "x",
              content: [],
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ]),
    });
    const base = generatedModel("claude-haiku-4.5");
    assert.ok(hasApi(base, "anthropic-messages"));
    const model: Model<"anthropic-messages"> = {
      ...base,
      thinkingLevelMap: { medium: null, high: null, xhigh: null, max: null },
    };
    await copilot
      .streamSimple(
        model,
        { messages: [user("hi", 0)] },
        { apiKey: SESSION_TOKEN, reasoning: "high", fetch: transport.fetch },
      )
      .result();
    const request = transport.requests.find((entry) => entry.url === `${ORIGIN}/v1/messages`);
    assert.ok(request);
    const body = requestBody(request.body);
    assert.ok(isObject(body.thinking));
    assert.equal(body.thinking.type, "enabled");
    // `high` is outside the 4000-token range, so the request carries the `low` budget.
    assert.equal(body.thinking.budget_tokens, 2048);
  });
});

const chatModel: Model<"openai-completions"> = {
  id: "copilot-model",
  name: "Copilot model",
  api: "openai-completions",
  provider: "github-copilot",
  baseUrl: ORIGIN,
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
};

describe("GitHub Copilot chat completions reasoning state", () => {
  async function exchange(messages: Context["messages"], chunks: readonly JsonValue[]) {
    const transport = fakeFetch({
      [`POST ${ORIGIN}/chat/completions`]: () => sse(chunks),
    });
    const result = await completions
      .stream(
        chatModel,
        { messages, tools },
        { apiKey: "gh-token", maxRetries: 0, fetch: transport.fetch, sessionId: "session-1" },
      )
      .result();
    const request = transport.requests[0];
    assert.ok(request);
    return { result, request, body: requestBody(request.body) };
  }

  const opaqueReplayCases = [
    {
      name: "opaque state before reasoning text survives later deltas",
      chunks: [
        { choices: [{ delta: { reasoning_opaque: "early-state" } }] },
        { choices: [{ delta: { reasoning_text: "check " } }] },
        { choices: [{ delta: { reasoning_text: "twice" } }] },
        { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
      ],
      continuation: "continue",
      signature: JSON.stringify({ reasoning_opaque: "early-state" }),
      expected: {
        role: "assistant",
        content: "answer",
        reasoning_text: "check twice",
        reasoning_opaque: "early-state",
      },
    },
    {
      name: "opaque state in the reasoning text chunk is kept",
      chunks: [
        { choices: [{ delta: { reasoning_text: "check", reasoning_opaque: "opaque-state" } }] },
        { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
      ],
      continuation: "continue",
      signature: null,
      expected: {
        role: "assistant",
        content: "answer",
        reasoning_text: "check",
        reasoning_opaque: "opaque-state",
      },
    },
    {
      name: "opaque state in the answer text chunk is kept",
      chunks: [
        { choices: [{ delta: { content: "answer", reasoning_opaque: "late-state" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
      continuation: "go",
      signature: null,
      expected: { role: "assistant", content: "answer", reasoning_opaque: "late-state" },
    },
  ];

  test.each(opaqueReplayCases)("$name", async (input) => {
    const first = await exchange([user("hello", 0)], input.chunks);
    if (input.signature !== null) {
      const thinking = first.result.content.find((block) => block.type === "thinking");
      assert.ok(thinking && thinking.type === "thinking");
      assert.equal(thinking.thinkingSignature, input.signature);
    }
    const second = await exchange(
      [user("hello", 0), first.result, user(input.continuation, 1)],
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    );
    assert.deepEqual(messageWithRole(second.body, "assistant"), input.expected);
  });

  test("a repeated identical opaque value is tolerated; a second different one fails the response", async () => {
    const repeated = await exchange(
      [user("hello", 0)],
      [
        { choices: [{ delta: { reasoning_text: "a", reasoning_opaque: "same" } }] },
        { choices: [{ delta: { content: "answer", reasoning_opaque: "same" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    );
    assert.equal(repeated.result.stopReason, "stop");
    const conflicting = await exchange(
      [user("hello", 0)],
      [
        { choices: [{ delta: { reasoning_text: "a", reasoning_opaque: "one" } }] },
        { choices: [{ delta: { reasoning_text: "b", reasoning_opaque: "two" } }] },
        { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
      ],
    );
    assert.equal(conflicting.result.stopReason, "error");
    assert.match(conflicting.result.errorMessage ?? "", /multiple reasoning_opaque/);
  });

  test("does not replay reasoning text without opaque state", async () => {
    const first = await exchange(
      [user("hello", 0)],
      [
        { choices: [{ delta: { reasoning_text: "thoughts" } }] },
        { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
      ],
    );
    const second = await exchange(
      [user("hello", 0), first.result, user("go", 1)],
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    );
    const assistant = messageWithRole(second.body, "assistant");
    assert.deepEqual(assistant, { role: "assistant", content: "answer" });
  });

  test("declares vision requests", async () => {
    const exchangeResult = await exchange(
      [
        {
          role: "user",
          content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
          timestamp: 0,
        },
      ],
      [{ choices: [{ delta: { content: "a picture" }, finish_reason: "stop" }] }],
    );
    assert.equal(exchangeResult.request.headers.get("copilot-vision-request"), "true");
  });

  test("reasoning fields of other providers are untouched by the Copilot path", async () => {
    const transport = fakeFetch({
      ["POST https://example.test/v1/chat/completions"]: () =>
        sse([
          { choices: [{ delta: { reasoning_content: "why", reasoning_opaque: "ignored" } }] },
          { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
        ]),
    });
    const other: Model<"openai-completions"> = {
      ...chatModel,
      provider: "custom",
      baseUrl: "https://example.test/v1",
    };
    const first = await completions
      .stream(
        other,
        { messages: [user("hello", 0)] },
        { apiKey: "k", maxRetries: 0, fetch: transport.fetch },
      )
      .result();
    const thinking = first.content.find((block) => block.type === "thinking");
    assert.ok(thinking && thinking.type === "thinking");
    assert.equal(thinking.thinkingSignature, "reasoning_content");
    await completions
      .stream(
        other,
        { messages: [user("hello", 0), first, user("go", 1)] },
        { apiKey: "k", maxRetries: 0, fetch: transport.fetch },
      )
      .result();
    const replay = transport.requests[1];
    assert.ok(replay);
    const body = requestBody(replay.body);
    const assistant = messageWithRole(body, "assistant");
    assert.equal(assistant.reasoning_opaque, undefined);
    assert.equal(assistant.reasoning_content, "why");
  });
});
