/** `fast` is the user-facing name; OpenAI receives its existing priority tier. */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { streamSimple as streamCodex } from "../src/api/openai-codex-responses.ts";
import { streamSimple as streamOpenAI } from "../src/api/openai-responses.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";

const context: Context = {
  systemPrompt: "sys",
  messages: [{ role: "user", content: "hi", timestamp: 0 }],
};

const codexModel: Model<"openai-codex-responses"> = {
  id: "gpt-test",
  name: "GPT Test",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.test/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 10_000,
};

const openaiModel: Model<"openai-responses"> = {
  ...codexModel,
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.test/v1",
};

const codexToken = `h.${Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }),
).toString("base64")}.s`;

interface CapturedBody {
  service_tier?: unknown;
}

function isCapturedBody(value: unknown): value is CapturedBody {
  return typeof value === "object" && value !== null;
}

function capture(): { seen: { body?: unknown }; options: SimpleStreamOptions } {
  const seen: { body?: unknown } = {};
  return {
    seen,
    options: {
      maxRetries: 0,
      fetch: async () => {
        throw new Error("offline");
      },
      onPayload: (payload) => {
        seen.body = payload;
        return undefined;
      },
    },
  };
}

describe("OpenAI fast mode", () => {
  test("maps fast to the priority tier for OpenAI and Codex", async () => {
    const codex = capture();
    await streamCodex(codexModel, context, {
      ...codex.options,
      apiKey: codexToken,
      fast: true,
      transport: "sse",
    }).result();
    assert.ok(isCapturedBody(codex.seen.body));
    assert.equal(codex.seen.body.service_tier, "priority");

    const openai = capture();
    await streamOpenAI(openaiModel, context, {
      ...openai.options,
      apiKey: "sk-test",
      fast: true,
    }).result();
    assert.ok(isCapturedBody(openai.seen.body));
    assert.equal(openai.seen.body.service_tier, "priority");
  });
});
