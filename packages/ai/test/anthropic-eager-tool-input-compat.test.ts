import { normalizeContext } from "@nyte-ai/schema/model";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { stream } from "../src/api/anthropic-messages.ts";
import type { Context, Model, Tool } from "../src/types.ts";

interface CapturedRequest {
  headers: Headers;
  body: unknown;
}

const model = {
  id: "claude-opus-4-8",
  name: "Claude Opus 4.8",
  api: "anthropic-messages",
  provider: "test-anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 32000,
  compat: { forceAdaptiveThinking: true },
} satisfies Model<"anthropic-messages">;

const tool = {
  name: "lookup",
  description: "Look up a value",
  parameters: Type.Object({ value: Type.String() }),
} satisfies Tool;

const responseBody = [
  `event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: "msg_test",
      model: model.id,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })}`,
  `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 1 },
  })}`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
].join("\n\n");

async function captureAnthropicRequest(input: {
  compat?: Model<"anthropic-messages">["compat"];
  context: Context;
}): Promise<CapturedRequest> {
  let capturedRequest: CapturedRequest | undefined;
  let requestCount = 0;
  const result = await stream(
    { ...model, compat: { forceAdaptiveThinking: true, ...input.compat } },
    normalizeContext(input.context),
    {
      apiKey: "test-key",
      cacheRetention: "none",
      maxRetries: 0,
      fetch: async (input, init) => {
        requestCount += 1;
        const request = new Request(input, init);
        const body: unknown = await request.clone().json();
        capturedRequest = { headers: request.headers, body };
        return new Response(responseBody, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    },
  ).result();

  if (result.stopReason !== "stop") {
    throw new Error(result.errorMessage ?? "Anthropic fixture did not finish");
  }
  if (requestCount !== 1 || capturedRequest === undefined) {
    throw new Error(`Expected one Anthropic request, received ${requestCount}`);
  }
  return capturedRequest;
}

describe("Anthropic eager tool input streaming compatibility", () => {
  it.each([
    {
      name: "sends per-tool eager_input_streaming by default",
      compat: undefined,
      tools: [tool],
      beta: null,
      body: { tools: [{ name: "lookup", eager_input_streaming: true }] },
      absent: undefined,
    },
    {
      name: "uses the legacy fine-grained tool streaming beta when eager tool input streaming is disabled",
      compat: { supportsEagerToolInputStreaming: false },
      tools: [tool],
      beta: "fine-grained-tool-streaming-2025-05-14",
      body: { tools: [{ name: "lookup" }] },
      absent: "tools.0.eager_input_streaming",
    },
    {
      name: "does not send the legacy fine-grained tool streaming beta when there are no tools",
      compat: { supportsEagerToolInputStreaming: false },
      tools: undefined,
      beta: null,
      body: {
        model: "claude-opus-4-8",
        messages: [{ role: "user", content: "Use the tool" }],
      },
      absent: "tools",
    },
  ])("$name", async (input) => {
    const request = await captureAnthropicRequest({
      compat: input.compat,
      context: {
        messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
        tools: input.tools,
      },
    });

    expect(request.headers.get("anthropic-beta")).toBe(input.beta);
    expect(request.body).toMatchObject(input.body);
    if (input.absent !== undefined) expect(request.body).not.toHaveProperty(input.absent);
  });
});
