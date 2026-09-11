import type { ResponseUsage } from "openai/resources/responses/responses.js";
import { expect, it } from "vitest";
import { stream } from "../src/api/openai-responses.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-responses"> = {
  id: "gpt-5.4",
  name: "Usage fixture",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://openai.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1_000_000, output: 2_000_000, cacheRead: 3_000_000, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 128_000,
};
const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 30 },
  output_tokens: 50,
  output_tokens_details: { reasoning_tokens: 20 },
  total_tokens: 150,
} satisfies ResponseUsage;

it.each(["response.completed", "response.incomplete", "response.failed"])(
  "preserves SDK stream usage and service-tier cost on %s",
  async (type) => {
    const source = stream(
      model,
      { messages: [] },
      {
        apiKey: "fixture",
        fetch: async () =>
          new Response(
            `data: ${JSON.stringify({
              type,
              sequence_number: 0,
              response: {
                id: "resp_usage",
                status: type.slice("response.".length),
                output: [],
                service_tier: "priority",
                usage,
                incomplete_details:
                  type === "response.incomplete" ? { reason: "max_output_tokens" } : null,
                error:
                  type === "response.failed"
                    ? { code: "server_error", message: "Generation failed" }
                    : null,
              },
            })}\n\ndata: [DONE]\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          ),
      },
    );
    const eventTypes = [];
    for await (const event of source) eventTypes.push(event.type);
    const message = await source.result();
    expect(message.usage).toEqual({
      input: 70,
      output: 50,
      cacheRead: 30,
      cacheWrite: 0,
      reasoning: 20,
      totalTokens: 150,
      cost: { input: 140, output: 200, cacheRead: 180, cacheWrite: 0, total: 520 },
    });
    expect(message.responseId).toBe("resp_usage");
    if (type === "response.failed") {
      expect(message.stopReason).toBe("error");
      expect(message.errorMessage).toContain("server_error: Generation failed");
      expect(eventTypes).not.toContain("done");
    } else {
      expect(message.stopReason).toBe(type === "response.incomplete" ? "length" : "stop");
      expect(eventTypes).toContain("done");
    }
  },
);
