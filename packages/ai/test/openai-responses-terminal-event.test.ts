import { describe, expect, it } from "vitest";
import { stream } from "../src/api/openai-responses.ts";
import type { AssistantMessage, JsonValue, Model } from "../src/types.ts";

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

/** Feed wire JSON through the real OpenAI SDK and adapter, without replacing SDK methods. */
async function run(events: readonly JsonValue[]) {
  const source = stream(
    model,
    {
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    },
    {
      apiKey: "test",
      maxRetries: 0,
      fetch: async () =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        }),
    },
  );
  const kinds: string[] = [];
  const stopReasons: AssistantMessage["stopReason"][] = [];
  for await (const event of source) {
    kinds.push(event.type);
    if (event.type === "text_start" || event.type === "text_end") {
      stopReasons.push(event.partial.stopReason);
    }
  }
  return { result: await source.result(), kinds, stopReasons };
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

  it.each([
    { phases: ["commentary", "commentary"], expected: ["pending", "pending"] },
    { phases: ["final_answer", "final_answer"], expected: ["stop", "stop"] },
    { phases: ["commentary", "final_answer"], expected: ["pending", "stop"] },
  ] as const)("tracks message phases $phases", async (input) => {
    const result2 = await run([...phasedMessages(input.phases), completed]);
    expect(result2.stopReasons).toEqual(input.expected);
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

  it("finalizes incomplete terminal events as length stops", async () => {
    const result2 = await run([incomplete("max_output_tokens")]);
    expect(result2.result.responseId).toBe("resp_incomplete");
    expect(result2.result.stopReason).toBe("length");
    expect(result2.result.rawStopReason).toBe("incomplete.max_output_tokens");
    expect(result2.result.usage).toMatchObject({
      input: 25,
      output: 12,
      cacheRead: 5,
      cacheWrite: 0,
      totalTokens: 42,
    });
  });

  it.each(["content_filter", "max_time_limit"])(
    "preserves incomplete reason %s as a non-retryable error",
    async (reason) => {
      const result2 = await run([incomplete(reason)]);
      expect(result2.result.stopReason).toBe("error");
      expect(result2.result.rawStopReason).toBe(`incomplete.${reason}`);
      expect(result2.result.errorMessage).toBe(`Response incomplete: ${reason}`);
      expect(result2.kinds.at(-1)).toBe("error");
    },
  );

  it("reports failed terminal events with the provider error", async () => {
    const result2 = await run([
      {
        type: "response.failed",
        sequence_number: 0,
        response: {
          id: "resp_failed",
          status: "failed",
          error: { code: "server_error", message: "boom" },
        },
      },
    ]);
    expect(result2.result.stopReason).toBe("error");
    expect(result2.result.errorMessage).toBe("server_error: boom");
    expect(result2.result.rawStopReason).toBe("failed");
    expect(result2.kinds.at(-1)).toBe("error");
  });
});
