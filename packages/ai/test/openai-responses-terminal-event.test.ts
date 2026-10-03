import { normalizeContext } from "@nyte-ai/schema";
import type { ResponseUsage } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { stream } from "../src/api/openai-responses.ts";
import type { AssistantMessage, JsonValue, Model, ToolCall } from "../src/types.ts";

const model = {
  id: "gpt-5-mini",
  name: "GPT-5 Mini",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
} satisfies Model<"openai-responses">;

const pricedModel = {
  ...model,
  id: "gpt-5.4",
  cost: { input: 1_000_000, output: 2_000_000, cacheRead: 3_000_000, cacheWrite: 0 },
} satisfies Model<"openai-responses">;

/** Feed wire JSON through the real OpenAI SDK and adapter, without replacing SDK methods. */
async function run(events: readonly JsonValue[], streamModel = model) {
  const source = stream(
    streamModel,
    normalizeContext({
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    }),
    {
      apiKey: "test",
      maxRetries: 0,
      fetch: async () =>
        new Response(
          events
            .map(
              (event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
            )
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
    },
  );
  const kinds: string[] = [];
  const stopReasons: AssistantMessage["stopReason"][] = [];
  const toolCalls: ToolCall[] = [];
  for await (const event of source) {
    kinds.push(event.type);
    if (event.type === "text_start" || event.type === "text_end") {
      stopReasons.push(event.partial.stopReason);
    }
    // Snapshot the emitted value so later mutation cannot make a bad event appear correct.
    if (event.type === "toolcall_end") toolCalls.push(structuredClone(event.toolCall));
  }
  return { result: await source.result(), kinds, stopReasons, toolCalls };
}

function incomplete(reason: string) {
  return {
    type: "response.incomplete",
    sequence_number: 0,
    response: {
      id: "resp_incomplete",
      status: "incomplete",
      incomplete_details: { reason },
      usage: {
        input_tokens: 30,
        output_tokens: 12,
        total_tokens: 42,
        input_tokens_details: { cached_tokens: 5 },
      },
    },
  };
}

function phasedMessages(phases: readonly [string, string]) {
  return [
    {
      type: "response.output_item.added",
      sequence_number: 0,
      output_index: 0,
      item: {
        type: "message",
        id: "msg_phase",
        role: "assistant",
        status: "in_progress",
        content: [],
        phase: phases[0],
      },
    },
    {
      type: "response.output_item.done",
      sequence_number: 1,
      output_index: 0,
      item: {
        type: "message",
        id: "msg_phase",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "answer", annotations: [] }],
        phase: phases[1],
      },
    },
  ];
}

const completed = {
  type: "response.completed",
  sequence_number: 2,
  response: { id: "resp_phase", status: "completed" },
};

describe("OpenAI Responses terminal event handling", () => {
  it("emits an error and retains partial content when the stream ends before a terminal event", async () => {
    const result2 = await run([
      { type: "response.created", sequence_number: 0, response: { id: "resp_early_eof" } },
      {
        type: "response.output_item.added",
        sequence_number: 1,
        output_index: 0,
        item: { type: "reasoning", id: "rs_early_eof", summary: [] },
      },
      {
        type: "response.reasoning_text.delta",
        sequence_number: 2,
        output_index: 0,
        content_index: 0,
        item_id: "rs_early_eof",
        delta: "partial reasoning before the stream ends",
      },
    ]);
    expect(result2.kinds.at(-1)).toBe("error");
    expect(result2.result.stopReason).toBe("error");
    expect(result2.result.errorMessage).toBe(
      "OpenAI Responses stream ended before a terminal response event",
    );
    expect(result2.result.content).toEqual([
      { type: "thinking", thinking: "partial reasoning before the stream ends" },
    ]);
  });

  it("keeps commentary pending until the final_answer phase arrives", async () => {
    const result2 = await run([...phasedMessages(["commentary", "final_answer"]), completed]);
    expect(result2.stopReasons).toEqual(["pending", "stop"]);
    expect(result2.result.stopReason).toBe("stop");
    expect(result2.result.content[0]).toMatchObject({ type: "text", text: "answer" });
  });

  it("replaces a provisional final-answer stop with an incomplete terminal reason", async () => {
    const result2 = await run([
      ...phasedMessages(["final_answer", "final_answer"]),
      incomplete("max_output_tokens"),
    ]);
    expect(result2.stopReasons).toEqual(["stop", "stop"]);
    expect(result2.result.stopReason).toBe("length");
  });

  it("finalizes completed terminal events as stop and separates cached token usage", async () => {
    const result2 = await run([
      {
        type: "response.completed",
        sequence_number: 0,
        response: {
          id: "resp_completed",
          status: "completed",
          usage: {
            input_tokens: 20,
            output_tokens: 7,
            total_tokens: 27,
            input_tokens_details: { cached_tokens: 2, cache_write_tokens: 3 },
          },
        },
      },
    ]);
    expect(result2.result.responseId).toBe("resp_completed");
    expect(result2.result.stopReason).toBe("stop");
    expect(result2.result.rawStopReason).toBe("completed");
    expect(result2.result.usage).toMatchObject({
      input: 15,
      output: 7,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 27,
    });
  });

  it("preserves an incomplete content_filter reason as a non-retryable error", async () => {
    const result2 = await run([incomplete("content_filter")]);
    expect(result2.result.stopReason).toBe("error");
    expect(result2.result.rawStopReason).toBe("incomplete.content_filter");
    expect(result2.result.errorMessage).toBe("Response incomplete: content_filter");
    expect(result2.kinds.at(-1)).toBe("error");
  });

  it.each(["response.completed", "response.failed"])(
    "preserves SDK stream usage and service-tier cost on %s",
    async (type) => {
      const usage = {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 150,
      } satisfies ResponseUsage;
      const result2 = await run(
        [
          {
            type,
            sequence_number: 0,
            response: {
              id: "resp_usage",
              status: type.slice("response.".length),
              output: [],
              service_tier: "priority",
              usage,
              error:
                type === "response.failed"
                  ? { code: "server_error", message: "Generation failed" }
                  : null,
            },
          },
          "[DONE]",
        ],
        pricedModel,
      );
      expect(result2.result.usage).toEqual({
        input: 70,
        output: 50,
        cacheRead: 30,
        cacheWrite: 0,
        reasoning: 20,
        totalTokens: 150,
        cost: { input: 140, output: 200, cacheRead: 180, cacheWrite: 0, total: 520 },
      });
      expect(result2.result.responseId).toBe("resp_usage");
      if (type === "response.failed") {
        expect(result2.result.stopReason).toBe("error");
        expect(result2.result.errorMessage).toContain("server_error: Generation failed");
        expect(result2.kinds).not.toContain("done");
      } else {
        expect(result2.result.stopReason).toBe("stop");
        expect(result2.kinds).toContain("done");
      }
    },
  );

  it("prices the fast service tier GPT-6 reports like priority", async () => {
    const { result } = await run(
      [
        {
          type: "response.completed",
          sequence_number: 0,
          response: {
            id: "resp_fast",
            status: "completed",
            output: [],
            service_tier: "fast",
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 30 },
              output_tokens: 50,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 150,
            },
          },
        },
        "[DONE]",
      ],
      { ...pricedModel, id: "gpt-6-luna" },
    );
    expect(result.usage.cost).toEqual({
      input: 140,
      output: 200,
      cacheRead: 180,
      cacheWrite: 0,
      total: 520,
    });
  });

  it("emits and retains completed tool arguments without parser state", async () => {
    const call = {
      type: "function_call",
      id: "fc_test",
      call_id: "call_test",
      name: "edit",
      arguments: '{"path":"README.md","content":"updated"}',
    };
    const result2 = await run([
      {
        type: "response.output_item.added",
        sequence_number: 0,
        output_index: 0,
        item: { ...call, arguments: "" },
      },
      {
        type: "response.function_call_arguments.delta",
        sequence_number: 1,
        output_index: 0,
        item_id: call.id,
        delta: '{"path":"README.md"',
      },
      {
        type: "response.function_call_arguments.delta",
        sequence_number: 2,
        output_index: 0,
        item_id: call.id,
        delta: ',"content":"updated"}',
      },
      {
        type: "response.function_call_arguments.done",
        sequence_number: 3,
        output_index: 0,
        item_id: call.id,
        arguments: call.arguments,
      },
      { type: "response.output_item.done", sequence_number: 4, output_index: 0, item: call },
      {
        type: "response.completed",
        sequence_number: 5,
        response: { id: "resp_test", status: "completed" },
      },
    ]);
    const expected = [
      {
        type: "toolCall",
        id: "call_test|fc_test",
        name: "edit",
        arguments: { path: "README.md", content: "updated" },
      },
    ];
    expect(result2.result.stopReason).toBe("toolUse");
    expect(result2.result.content).toEqual(expected);
    expect(result2.toolCalls).toEqual(expected);
    expect(result2.result.content[0]).not.toHaveProperty("partialJson");
    expect(result2.toolCalls[0]).not.toHaveProperty("partialJson");
  });

  it("rejects completed streams whose tool call never received output_item.done", async () => {
    const result2 = await run([
      {
        type: "response.output_item.added",
        sequence_number: 0,
        output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "bash", arguments: "" },
      },
      {
        type: "response.function_call_arguments.delta",
        sequence_number: 1,
        output_index: 0,
        item_id: "fc_1",
        delta: '{"command":"rm -rf /tmp/build',
      },
      {
        type: "response.completed",
        sequence_number: 2,
        response: { id: "resp_unfinished", status: "completed" },
      },
    ]);
    expect(result2.kinds.at(-1)).toBe("error");
    expect(result2.result.stopReason).toBe("error");
    expect(result2.result.errorMessage).toBe(
      "OpenAI Responses stream completed with an unfinished tool call: bash (call_1|fc_1)",
    );
  });

  // https://github.com/earendil-works/pi/issues/9974
  it("rejects parallel tool calls without output_index instead of running mixed-up calls", async () => {
    const call = (n: string) => ({
      type: "function_call",
      id: `fc_${n}`,
      call_id: `call_${n}`,
      name: "bash",
    });
    // llama.cpp omits output_index from every event and sends both done events after all deltas.
    const result2 = await run([
      { type: "response.output_item.added", item: { ...call("a"), arguments: "" } },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_a",
        delta: '{"command":"echo a"}',
      },
      { type: "response.output_item.added", item: { ...call("b"), arguments: "" } },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_b",
        delta: '{"command":"echo b"}',
      },
      {
        type: "response.output_item.done",
        item: { ...call("a"), arguments: '{"command":"echo a"}' },
      },
      {
        type: "response.output_item.done",
        item: { ...call("b"), arguments: '{"command":"echo b"}' },
      },
      {
        type: "response.completed",
        response: { id: "resp_no_output_index", status: "completed" },
      },
    ]);
    expect(result2.kinds.at(-1)).toBe("error");
    expect(result2.result.stopReason).toBe("error");
    expect(result2.result.errorMessage).toBe(
      "OpenAI Responses stream completed with an unfinished tool call: bash (call_a|fc_a)",
    );
  });
});
