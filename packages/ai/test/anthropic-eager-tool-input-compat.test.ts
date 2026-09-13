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

const schemaCompatibilityTool = {
  ...tool,
  parameters: Type.Object(
    { value: Type.String() },
    { additionalProperties: false, title: "LookupInput" },
  ),
} satisfies Tool;

const strictTool = {
  ...tool,
  parameters: Type.Object(
    { value: Type.String(), optional: Type.Optional(Type.Number()) },
    { title: "StrictLookupInput" },
  ),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
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
    input.context,
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
  it("sends per-tool eager_input_streaming by default", async () => {
    const request = await captureAnthropicRequest({
      context: {
        messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
        tools: [tool],
      },
    });

    expect(request.headers.get("x-api-key")).toBe("test-key");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("anthropic-beta")).toBeNull();
    expect(request.body).toMatchObject({
      tools: [{ name: "lookup", eager_input_streaming: true }],
    });
  });

  it("uses the legacy fine-grained tool streaming beta when eager tool input streaming is disabled", async () => {
    const request = await captureAnthropicRequest({
      compat: { supportsEagerToolInputStreaming: false },
      context: {
        messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
        tools: [tool],
      },
    });

    expect(request.headers.get("x-api-key")).toBe("test-key");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("anthropic-beta")).toBe("fine-grained-tool-streaming-2025-05-14");
    expect(request.body).toMatchObject({ tools: [{ name: "lookup" }] });
    expect(request.body).not.toHaveProperty("tools.0.eager_input_streaming");
  });

  it("does not send the legacy fine-grained tool streaming beta when there are no tools", async () => {
    const request = await captureAnthropicRequest({
      compat: { supportsEagerToolInputStreaming: false },
      context: { messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }] },
    });

    expect(request.headers.get("x-api-key")).toBe("test-key");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("anthropic-beta")).toBeNull();
    expect(request.body).toMatchObject({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "Use the tool" }],
    });
    expect(request.body).not.toHaveProperty("tools");
  });

  it("only sends the full input schema for strict JSON-schema tools", async () => {
    const legacyRequest = await captureAnthropicRequest({
      compat: { supportsStrictTools: true },
      context: {
        messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
        tools: [schemaCompatibilityTool],
      },
    });

    expect(legacyRequest.headers.get("x-api-key")).toBe("test-key");
    expect(legacyRequest.headers.get("authorization")).toBeNull();
    expect(legacyRequest.body).toMatchObject({
      tools: [
        {
          name: "lookup",
          input_schema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
    });
    expect(legacyRequest.body).not.toHaveProperty("tools.0.input_schema.additionalProperties");
    expect(legacyRequest.body).not.toHaveProperty("tools.0.input_schema.title");

    const strictRequest = await captureAnthropicRequest({
      compat: { supportsStrictTools: true },
      context: {
        messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
        tools: [strictTool],
      },
    });

    expect(strictRequest.headers.get("x-api-key")).toBe("test-key");
    expect(strictRequest.headers.get("authorization")).toBeNull();
    expect(strictRequest.body).toMatchObject({
      tools: [
        {
          name: "lookup",
          strict: true,
          input_schema: {
            additionalProperties: false,
            required: ["value", "optional"],
            properties: { optional: { anyOf: [{ type: "number" }, { type: "null" }] } },
            title: "StrictLookupInput",
          },
        },
      ],
    });
  });
});
