import { expect, it } from "vitest";
import { stream } from "../src/api/openai-responses.ts";
import type { Model, ToolCall } from "../src/types.ts";

it("emits and retains completed tool arguments without parser state", async () => {
  const model: Model<"openai-responses"> = {
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
  };
  const call = {
    type: "function_call",
    id: "fc_test",
    call_id: "call_test",
    name: "edit",
    arguments: '{"path":"README.md","content":"updated"}',
  };
  const frames = [
    { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
    {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      item_id: call.id,
      delta: '{"path":"README.md"',
    },
    {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      item_id: call.id,
      delta: ',"content":"updated"}',
    },
    {
      type: "response.function_call_arguments.done",
      output_index: 0,
      item_id: call.id,
      arguments: call.arguments,
    },
    { type: "response.output_item.done", output_index: 0, item: call },
    { type: "response.completed", response: { id: "resp_test", status: "completed" } },
  ];
  const source = stream(
    model,
    { messages: [] },
    {
      apiKey: "test",
      maxRetries: 0,
      fetch: async () =>
        new Response(
          frames
            .map(
              (frame, sequence_number) =>
                `data: ${JSON.stringify({ ...frame, sequence_number })}\n\n`,
            )
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
    },
  );
  const completedCalls: ToolCall[] = [];
  for await (const event of source) {
    // Snapshot the emitted value so later mutation cannot make a bad event appear correct.
    if (event.type === "toolcall_end") completedCalls.push(structuredClone(event.toolCall));
  }
  const output = await source.result();
  const expected = [
    {
      type: "toolCall",
      id: "call_test|fc_test",
      name: "edit",
      arguments: { path: "README.md", content: "updated" },
    },
  ];
  expect(output.stopReason).toBe("toolUse");
  expect(output.content).toEqual(expected);
  expect(completedCalls).toEqual(expected);
  expect(output.content[0]).not.toHaveProperty("partialJson");
  expect(completedCalls[0]).not.toHaveProperty("partialJson");
});
