import assert from "node:assert/strict";
import { describe, vi, test } from "vitest";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import {
  failedTransiently,
  type RetryPolicy,
  retryAssistantCall,
  retryDelayMs,
} from "../src/utils/retry.ts";

function fauxAssistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

const openAIExplicitRetryMessage =
  "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID req_******** in your message.";
const nvidiaNIMResourceExhaustedMessage =
  "ResourceExhausted: Worker local total request limit reached (288/48)";
const bunFetchSocketClosedMessage =
  "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
const openAIResponsesEarlyEofMessage =
  "OpenAI Responses stream ended before a terminal response event";
const wrappedDnsLookupError =
  "The pending stream has been canceled (caused by: getaddrinfo ENOTFOUND bedrock-runtime.us-east-1.amazonaws.com)";
const azurePeakLoadError =
  "The system is currently experiencing high demand and cannot process your request. Your request exceeds the maximum usage size allowed during peak load. For improved capacity reliability, consider switching to Provisioned Throughput.";

function errorMessage(text: string): AssistantMessage {
  return fauxAssistantMessage("", { stopReason: "error", errorMessage: text });
}

describe("provider retry classification", () => {
  test("retries provider overload, rate limiting, and explicit retry guidance (#9669, #9627)", () => {
    assert.equal(failedTransiently(errorMessage(openAIExplicitRetryMessage)), true);
    assert.equal(failedTransiently(errorMessage(nvidiaNIMResourceExhaustedMessage)), true);
    assert.equal(failedTransiently(errorMessage(azurePeakLoadError)), true);
    assert.equal(failedTransiently(errorMessage("520 status code (no body)")), true);
  });

  test("retries DNS failures, socket drops, and streams that end before a terminal event", () => {
    assert.equal(failedTransiently(errorMessage(wrappedDnsLookupError)), true);
    assert.equal(failedTransiently(errorMessage(bunFetchSocketClosedMessage)), true);
    assert.equal(failedTransiently(errorMessage(openAIResponsesEarlyEofMessage)), true);
  });

  test("does not retry quota exhaustion or a message that did not fail", () => {
    assert.equal(failedTransiently(errorMessage("429 quota exceeded")), false);
    assert.equal(
      failedTransiently(
        errorMessage('429 {"type":"error","error":{"type":"extra_usage_out_of_credits"}}'),
      ),
      false,
    );
    assert.equal(failedTransiently(fauxAssistantMessage("not an error")), false);
  });
});

describe("retryAssistantCall", () => {
  const disabled: RetryPolicy = { enabled: false, maxRetries: 3, baseDelayMs: 0 };
  const enabled: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 0 };

  test("does not retry an aborted message", async () => {
    const produce = vi.fn(async () => fauxAssistantMessage("", { stopReason: "aborted" }));
    const onRetryScheduled = vi.fn();
    const res = await retryAssistantCall(produce, enabled, undefined, { onRetryScheduled });
    assert.equal(res.stopReason, "aborted");
    assert.equal(produce.mock.calls.length, 1);
    assert.equal(onRetryScheduled.mock.calls.length, 0);
  });

  test("does not retry a non-retryable error (quota/billing)", async () => {
    const produce = vi.fn(async () => errorMessage("insufficient_quota"));
    const onRetryScheduled = vi.fn();
    const onRetryFinished = vi.fn();
    const res = await retryAssistantCall(produce, enabled, undefined, {
      onRetryScheduled,
      onRetryFinished,
    });
    assert.equal(res.stopReason, "error");
    assert.equal(produce.mock.calls.length, 1);
    assert.equal(onRetryScheduled.mock.calls.length, 0);
    assert.equal(onRetryFinished.mock.calls.length, 0);
  });

  test("retries a transient error up to maxRetries then returns the final error", async () => {
    const produce = vi.fn(async () => errorMessage("terminated"));
    const onRetryScheduled = vi.fn();
    const onRetryFinished = vi.fn();
    const res = await retryAssistantCall(produce, enabled, undefined, {
      onRetryScheduled,
      onRetryFinished,
    });
    assert.equal(res.stopReason, "error");
    assert.equal(produce.mock.calls.length, 1 + enabled.maxRetries);
    assert.equal(onRetryScheduled.mock.calls.length, 3);
    assert.deepEqual(onRetryFinished.mock.calls.at(-1), [false, 3, "terminated"]);
  });

  test("caps agent retry delay (#8826)", async () => {
    assert.equal(retryDelayMs({ baseDelayMs: 2000 }, 6), 60000);
    assert.equal(retryDelayMs({ baseDelayMs: 2000, maxAgentDelayMs: 5000 }, 5), 5000);
    assert.equal(retryDelayMs({ baseDelayMs: 2000, maxAgentDelayMs: 0 }, 5), 0);

    let n = 0;
    const policy: RetryPolicy = {
      enabled: true,
      maxRetries: 4,
      baseDelayMs: 10,
      maxAgentDelayMs: 15,
    };
    const produce = vi.fn(async () => {
      n++;
      return n < 5 ? errorMessage("terminated") : fauxAssistantMessage("recovered");
    });
    const onRetryScheduled = vi.fn();

    await retryAssistantCall(produce, policy, undefined, { onRetryScheduled });

    assert.deepEqual(
      onRetryScheduled.mock.calls.map((call) => call[2]),
      [10, 15, 15, 15],
    );
  });

  test("waits the provider's retry-after and gives up when it asks past the cap", async () => {
    const limited = (retryAfterMs: number) =>
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "terminated",
        diagnostics: [{ type: "http", timestamp: 0, details: { retryAfterMs } }],
      });
    const policy: RetryPolicy = {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 1,
      maxAgentDelayMs: 40,
    };
    const onRetryScheduled = vi.fn();
    let n = 0;
    const produce = vi.fn(async () => {
      n++;
      return n === 1 ? limited(30) : fauxAssistantMessage("recovered");
    });

    const res = await retryAssistantCall(produce, policy, undefined, { onRetryScheduled });

    assert.equal(res.stopReason, "stop");
    assert.deepEqual(
      onRetryScheduled.mock.calls.map((call) => call[2]),
      [30],
    );

    const tooLong = vi.fn(async () => limited(41));
    const given = await retryAssistantCall(tooLong, policy, undefined);

    assert.equal(given.stopReason, "error");
    assert.equal(tooLong.mock.calls.length, 1);
  });

  test("reports an aborted retried call as unsuccessful", async () => {
    let n = 0;
    const produce = vi.fn(async () => {
      n++;
      return n === 1
        ? errorMessage("terminated")
        : fauxAssistantMessage("", { stopReason: "aborted" });
    });
    const onRetryFinished = vi.fn();
    const res = await retryAssistantCall(produce, enabled, undefined, { onRetryFinished });
    assert.equal(res.stopReason, "aborted");
    assert.equal(produce.mock.calls.length, 2);
    assert.deepEqual(onRetryFinished.mock.calls.at(-1), [false, 1]);
  });

  test("does not retry when policy is disabled", async () => {
    const produce = vi.fn(async () => errorMessage("terminated"));
    const onRetryScheduled = vi.fn();
    const onRetryFinished = vi.fn();
    const res = await retryAssistantCall(produce, disabled, undefined, {
      onRetryScheduled,
      onRetryFinished,
    });
    assert.equal(res.stopReason, "error");
    assert.equal(produce.mock.calls.length, 1);
    assert.equal(onRetryScheduled.mock.calls.length, 0);
    assert.equal(onRetryFinished.mock.calls.length, 0);
  });

  test("emits onRetryAttemptStart after backoff before each retried call, then onRetryFinished(true)", async () => {
    const events: string[] = [];
    let n = 0;
    const produce = vi.fn(async () => {
      events.push(`produce:${n}`);
      n++;
      return n < 3 ? errorMessage("terminated") : fauxAssistantMessage("recovered");
    });
    const onRetryScheduled = vi.fn((attempt: number) => {
      events.push(`retry:${attempt}`);
    });
    const onRetryAttemptStart = vi.fn(() => {
      events.push("attempt-start");
    });
    const onRetryFinished = vi.fn();
    const res = await retryAssistantCall(produce, enabled, undefined, {
      onRetryScheduled,
      onRetryAttemptStart,
      onRetryFinished,
    });
    assert.deepEqual(res.content, [{ type: "text", text: "recovered" }]);
    assert.equal(onRetryScheduled.mock.calls.length, 2);
    assert.equal(onRetryAttemptStart.mock.calls.length, 2);
    assert.deepEqual(events, [
      "produce:0",
      "retry:1",
      "attempt-start",
      "produce:1",
      "retry:2",
      "attempt-start",
      "produce:2",
    ]);
    assert.deepEqual(onRetryFinished.mock.calls.at(-1), [true, 2]);
  });

  test("aborts backoff sleep via signal, returns an aborted message, and emits onRetryFinished(false)", async () => {
    const controller = new AbortController();
    const produce = vi.fn(async () => errorMessage("terminated"));
    const policy: RetryPolicy = { enabled: true, maxRetries: 5, baseDelayMs: 10_000 };
    const onRetryFinished = vi.fn();
    const p = retryAssistantCall(produce, policy, controller.signal, { onRetryFinished });
    while (produce.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    const res = await p;
    assert.equal(res.stopReason, "aborted");
    assert.equal(res.errorMessage, undefined);
    assert.equal(produce.mock.calls.length, 1);
    assert.deepEqual(onRetryFinished.mock.calls.at(-1), [false, 1, "terminated"]);
  });
});
