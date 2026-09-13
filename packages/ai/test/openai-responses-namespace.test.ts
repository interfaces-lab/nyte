import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { stream } from "../src/api/openai-responses.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import type { Api, AssistantMessage, Context, JsonValue, Model } from "../src/types.ts";

const model: Model<"openai-responses"> = {
  id: "gpt-5.4",
  name: "GPT-5.4",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
  compat: { supportsOpenAIGrammarTools: true },
};

function createOutput(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

const completed = {
  type: "response.completed",
  response: { id: "resp_test", status: "completed" },
};

async function exchange(input: { events: readonly JsonValue[]; context: Context }) {
  let body: unknown;
  const output = await stream(model, input.context, {
    apiKey: "test",
    maxRetries: 0,
    fetch: async (url, init) => {
      body = JSON.parse(await new Request(url, init).text());
      return new Response(
        input.events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  }).result();
  return { output, body };
}

describe("OpenAI Responses tool-call namespaces", () => {
  it("round-trips a function namespace received only on output_item.done", async () => {
    const call = {
      type: "function_call",
      id: "fc_test",
      call_id: "call_test",
      name: "lookup",
      arguments: '{"value":"hello"}',
    };
    const first = await exchange({
      context: { messages: [] },
      events: [
        { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { ...call, namespace: "dynamic_tools" },
        },
        completed,
      ],
    });
    expect(first.output.content).toEqual([
      {
        type: "toolCall",
        id: "call_test|fc_test",
        name: "lookup",
        arguments: { value: "hello" },
        namespace: "dynamic_tools",
      },
    ]);
    const replay = await exchange({ context: { messages: [first.output] }, events: [completed] });
    expect(replay.body).toMatchObject({
      input: expect.arrayContaining([{ ...call, namespace: "dynamic_tools" }]),
    });
  });

  it("round-trips a custom-tool namespace received only on output_item.done", async () => {
    const tools: Context["tools"] = [
      {
        name: "query",
        description: "Query text",
        parameters: Type.Object({ input: Type.String() }),
        constrainedSampling: { type: "grammar", variants: { openai_regex: ".*" } },
      },
    ];
    const call = {
      type: "custom_tool_call",
      id: "ctc_test",
      call_id: "call_test",
      name: "query",
      input: "hello",
    };
    const first = await exchange({
      context: { messages: [], tools },
      events: [
        { type: "response.output_item.added", output_index: 0, item: { ...call, input: "" } },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { ...call, namespace: "dynamic_tools" },
        },
        completed,
      ],
    });
    expect(first.output.content).toEqual([
      {
        type: "toolCall",
        id: "call_test|ctc_test",
        name: "query",
        arguments: { input: "hello" },
        namespace: "dynamic_tools",
      },
    ]);
    const replay = await exchange({
      context: { messages: [first.output], tools },
      events: [completed],
    });
    expect(replay.body).toMatchObject({
      input: expect.arrayContaining([{ ...call, namespace: "dynamic_tools" }]),
    });
  });

  it("drops namespaces when the target cannot replay their load items", () => {
    const output = createOutput();
    output.content.push(
      {
        type: "toolCall",
        id: "call_function|fc_test",
        name: "lookup",
        arguments: { value: "hello" },
        namespace: "dynamic_tools",
      },
      {
        type: "toolCall",
        id: "call_custom|ctc_test",
        name: "query",
        arguments: { input: "hello" },
        namespace: "dynamic_tools",
      },
    );
    const targetModels: Model<Api>[] = [
      { ...model, id: "gpt-5.2", name: "GPT-5.2" },
      { ...model, provider: "azure-openai-responses" },
      {
        ...model,
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "gpt-5.3-codex-spark",
        name: "GPT-5.3 Codex Spark",
      },
    ];

    for (const targetModel of targetModels) {
      const replayed = convertResponsesMessages(
        targetModel,
        { messages: [output] },
        new Set(["openai"]),
        {
          grammarToolInputProperties: new Map([["query", "input"]]),
        },
      );
      const functionCall = replayed.find((item) => item.type === "function_call");
      const customToolCall = replayed.find((item) => item.type === "custom_tool_call");
      expect(functionCall).toBeDefined();
      expect(functionCall).not.toHaveProperty("namespace");
      expect(customToolCall).toBeDefined();
      expect(customToolCall).not.toHaveProperty("namespace");
    }
  });

  it("does not add a namespace to ordinary function calls", () => {
    const output = createOutput();
    output.content.push({
      type: "toolCall",
      id: "call_test|fc_test",
      name: "lookup",
      arguments: { value: "hello" },
    });

    const replayed = convertResponsesMessages(
      model,
      { messages: [output] },
      new Set(["openai"]),
    ).find((item) => item.type === "function_call");
    expect(replayed).toBeDefined();
    expect(replayed).not.toHaveProperty("namespace");
  });
});
