import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { AssistantMessage, FailureClass } from "@nyte-ai/schema";
import { classifyAssistantFailure, isRetryableFailureClass } from "../src/utils/failure.ts";

function failed(errorMessage: string | undefined, stopReason: "error" | "aborted" = "error") {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
  return errorMessage === undefined ? message : { ...message, errorMessage };
}

const cases: readonly (readonly [FailureClass, string])[] = [
  ["rate_limit", "429 rate limit exceeded"],
  ["rate_limit", "Rate_limit reached for requests"],
  ["rate_limit", "Too many requests. Please slow down."],
  ["rate_limit", "Throttling error: Too many tokens, please wait before trying again."],
  ["rate_limit", "ResourceExhausted: Worker local total request limit reached (288/48)"],
  ["auth", "401 Unauthorized"],
  ["auth", "authentication_error: invalid x-api-key"],
  ["quota", "429 quota exceeded"],
  ["quota", "You exceeded your current quota, please check your plan and billing details"],
  ["quota", "insufficient_quota"],
  ["context_window", "prompt is too long: 213462 tokens > 200000 maximum"],
  ["context_window", "Your input exceeds the context window of this model"],
  ["overloaded", "overloaded_error"],
  ["overloaded", '529 {"type":"overloaded_error"}'],
  ["overloaded", "524 status code (no body)"],
  ["overloaded", "Service unavailable: The service is temporarily unavailable."],
  [
    "overloaded",
    "The system encountered an unexpected error during processing. Try your request again.",
  ],
  ["network", "fetch failed"],
  ["network", "connect ECONNREFUSED 127.0.0.1:443"],
  ["network", "getaddrinfo ENOTFOUND api.example.com"],
  ["network", "OpenAI Responses stream ended before a terminal response event"],
  ["provider", "Invalid request: unknown parameter 'foo'"],
];

describe("classifyAssistantFailure", () => {
  for (const [expected, text] of cases) {
    test(`${expected}: ${text}`, () => {
      assert.equal(classifyAssistantFailure(failed(text)).class, expected);
    });
  }

  test("an aborted message is aborted regardless of text", () => {
    assert.equal(classifyAssistantFailure(failed("429", "aborted")).class, "aborted");
  });

  test("a missing error message is a provider failure with the default text", () => {
    assert.deepEqual(classifyAssistantFailure(failed(undefined)), {
      class: "provider",
      message: "Unknown error",
    });
  });

  test("structured status takes precedence over error text", () => {
    for (const [status, text, expected] of [
      [429, "billing quota exceeded", "rate_limit"],
      [401, "service unavailable", "auth"],
      [403, "network timeout", "auth"],
      [402, "network timeout", "quota"],
      [413, "service unavailable", "context_window"],
      [500, "invalid api key", "overloaded"],
      [529, "authentication failed", "overloaded"],
    ] as const) {
      const message = {
        ...failed(text),
        diagnostics: [{ type: "provider", timestamp: 0, details: { status } }],
      };
      assert.equal(classifyAssistantFailure(message).class, expected, String(status));
    }
  });

  for (const [retryable, terminal, text, expected] of [
    ["overloaded", "auth", "authentication service unavailable", "overloaded"],
    ["overloaded", "quota", "billing service unavailable", "overloaded"],
    ["network", "auth", "authentication network error", "network"],
    ["network", "quota", "billing network error", "network"],
  ] as const) {
    test(`${retryable} text takes precedence over ${terminal}`, () => {
      assert.equal(classifyAssistantFailure(failed(text)).class, expected);
    });
  }

  test("a provider-requested retry delay is read from the text", () => {
    const failure = classifyAssistantFailure(
      failed("Server requested 30s retry delay. 429 Too Many Requests"),
    );
    assert.equal(failure.class, "rate_limit");
    assert.equal(failure.retryAfterMs, 30_000);
  });

  test("a retry delay rejected by the provider is not made durable", () => {
    const failure = classifyAssistantFailure(
      failed("Server requested 30s retry delay (max: 15s). 429 Too Many Requests"),
    );
    assert.equal(failure.class, "rate_limit");
    assert.ok(!("retryAfterMs" in failure));
  });

  test("silent overflow needs the model window", () => {
    const message = { ...failed(undefined), stopReason: "stop" as const };
    const overflowing = { ...message, usage: { ...message.usage, input: 300_000 } };
    assert.equal(classifyAssistantFailure(overflowing).class, "provider");
    assert.equal(
      classifyAssistantFailure(overflowing, { contextWindow: 200_000 }).class,
      "context_window",
    );
  });

  test("only load, lifting limits, and transport are retryable", () => {
    assert.deepEqual(
      cases.map(([failureClass]) => failureClass).filter(isRetryableFailureClass),
      cases
        .map(([failureClass]) => failureClass)
        .filter((failureClass) => ["rate_limit", "overloaded", "network"].includes(failureClass)),
    );
  });
});
