import { normalizeContext } from "@nyte-ai/schema";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { stream } from "../src/api/anthropic-messages.ts";
import type { Model, Tool } from "../src/types.ts";

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
  compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
} satisfies Model<"anthropic-messages">;

const responseBody = [
  `event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: { id: "msg_test", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } },
  })}`,
  `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 1 },
  })}`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
].join("\n\n");

function createTool(
  parameters: Tool["parameters"],
  constrainedSampling?: Tool["constrainedSampling"],
): Tool {
  return {
    name: "lookup",
    description: "Look up a value",
    parameters,
    ...(constrainedSampling ? { constrainedSampling } : {}),
  };
}

function createStrictTool(parameters: Tool["parameters"]): Tool {
  return createTool(parameters, { type: "json_schema", strict: "prefer" });
}

async function captureRequestBody(tool: Tool): Promise<unknown> {
  let body: unknown;
  const result = await stream(
    model,
    normalizeContext({
      messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
      tools: [tool],
    }),
    {
      apiKey: "test-key",
      cacheRetention: "none",
      maxRetries: 0,
      fetch: async (input, init) => {
        body = await new Request(input, init).json();
        return new Response(responseBody, { headers: { "content-type": "text/event-stream" } });
      },
    },
  ).result();

  if (result.stopReason !== "stop") {
    throw new Error(result.errorMessage ?? "Anthropic fixture did not finish");
  }
  return body;
}

describe("Anthropic strict tool schemas", () => {
  it("only sends the full input schema for strict JSON-schema tools", async () => {
    const legacyBody = await captureRequestBody(
      createTool(
        Type.Object(
          { value: Type.String() },
          { additionalProperties: false, title: "LookupInput" },
        ),
      ),
    );

    expect(legacyBody).toMatchObject({
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
    expect(legacyBody).not.toHaveProperty("tools.0.strict");
    expect(legacyBody).not.toHaveProperty("tools.0.input_schema.additionalProperties");
    expect(legacyBody).not.toHaveProperty("tools.0.input_schema.title");

    const strictBody = await captureRequestBody(
      createStrictTool(
        Type.Object(
          { value: Type.String(), optional: Type.Optional(Type.Number()) },
          { title: "StrictLookupInput" },
        ),
      ),
    );

    expect(strictBody).toMatchObject({
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

  // https://github.com/earendil-works/pi/issues/9953
  it("sends prefer tools non-strict when they use keywords Anthropic strict mode rejects", async () => {
    const unsupportedParameters: Tool["parameters"][] = [
      Type.Object({ timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 300000 })) }),
      Type.Object({ options: Type.Object({ tags: Type.Array(Type.String(), { minItems: 2 }) }) }),
      Type.Object({ expression: Type.String({ format: "regex" }) }),
    ];

    for (const parameters of unsupportedParameters) {
      const body = await captureRequestBody(createStrictTool(parameters));
      expect(body).toMatchObject({ tools: [{ name: "lookup" }] });
      expect(body).not.toHaveProperty("tools.0.strict");
    }

    const supportedBody = await captureRequestBody(
      createStrictTool(
        Type.Object({
          code: Type.String({ minLength: 1, maxLength: 1000, pattern: "^[a-z]+$" }),
          url: Type.String({ format: "uri" }),
          tags: Type.Array(Type.String(), { minItems: 1 }),
        }),
      ),
    );

    expect(supportedBody).toMatchObject({ tools: [{ name: "lookup", strict: true }] });
  });
});
