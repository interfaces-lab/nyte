import assert from "node:assert/strict";
import { afterEach, describe, vi, test } from "vitest";
import { runAssistantStream } from "../src/api/assistant-stream.ts";
import type { Model } from "../src/types.ts";
import { classifyAssistantFailure, requestUnsent } from "../src/utils/failure.ts";
import { requestedRetryDelayMs, retryProviderRequest } from "../src/utils/provider-retry.ts";

const NOW = 2_000_000_000_000;

const model: Model<"anthropic-messages"> = {
  id: "claude-test",
  name: "Claude Test",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1/",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 10_000,
};

function providerError(status: number | undefined, headers?: Record<string, string>): Error {
  return Object.assign(new Error(`Provider error: ${status}`), {
    status,
    headers: new Headers(headers),
  });
}

function systemError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function flakyRequest(error: Error, failures: number) {
  let calls = 0;
  return vi.fn(async (): Promise<string> => {
    calls++;
    if (calls <= failures) throw error;
    return "ok";
  });
}

describe("provider request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("retries retryable provider errors", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const request = flakyRequest(providerError(429, { "retry-after-ms": "1000" }), 1);

    const result = retryProviderRequest(request, { maxRetries: 1 });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    await Promise.resolve();
    assert.equal(request.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(1);

    assert.equal(await result, "ok");
    assert.equal(request.mock.calls.length, 2);
  });

  test.each([
    ["retry-after-ms", "Infinity"],
    ["retry-after", "Infinity"],
  ])("backs off and recovers when %s is %s", async (name, value) => {
    vi.useFakeTimers();
    const request = flakyRequest(providerError(429, { [name]: value }), 1);
    const result = retryProviderRequest(request, { maxRetries: 1 }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(request.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(500);
    assert.deepEqual(await result, { value: "ok" });
  });

  test("does not retry errors the provider marks as non-retryable", async () => {
    const error = providerError(429, { "x-should-retry": "false" });
    const request = vi.fn(async (): Promise<string> => {
      throw error;
    });

    await assert.rejects(
      retryProviderRequest(request, { maxRetries: 2 }),
      (thrown) => thrown === error,
    );
    assert.equal(request.mock.calls.length, 1);
  });

  test("rejects a provider-requested retry delay above the limit", async () => {
    const request = vi.fn(async (): Promise<string> => {
      throw providerError(429, { "retry-after": "277403" });
    });

    await assert.rejects(
      retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 1000 }),
      /Server requested 277403s retry delay \(max: 1s\)/,
    );
    assert.equal(request.mock.calls.length, 1);
  });

  test("aborts a provider-requested retry delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const controller = new AbortController();
    const request = vi.fn(async (): Promise<string> => {
      throw providerError(429, { "retry-after": "277403" });
    });

    const result = retryProviderRequest(request, {
      maxRetries: 2,
      maxRetryDelayMs: 0,
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(request.mock.calls.length, 1);

    controller.abort();

    await assert.rejects(result, (error) => error instanceof Error && error.name === "AbortError");
    assert.equal(request.mock.calls.length, 1);
  });
});

describe("provider-requested retry delay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    ["retry-after-ms", providerError(429, { "retry-after-ms": "1500" }), 1500],
    ["retry-after in seconds", providerError(429, { "retry-after": "30" }), 30_000],
    [
      "retry-after as a date",
      providerError(429, { "retry-after": new Date(NOW + 5000).toUTCString() }),
      5000,
    ],
    [
      "retry-after as a past date",
      providerError(429, { "retry-after": new Date(NOW - 5000).toUTCString() }),
      0,
    ],
    ["neither header", providerError(429), undefined],
    [
      "an error with no headers",
      Object.assign(new Error("Provider error: 429"), { status: 429, headers: undefined }),
      undefined,
    ],
    [
      "a value that is not an error",
      { status: 429, headers: new Headers({ "retry-after": "30" }) },
      undefined,
    ],
  ])("reads %s", (_name, error, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    assert.equal(requestedRetryDelayMs(error), expected);
  });

  test("a thrown 429 with retry-after fails the stream with the asked delay", async () => {
    const stream = runAssistantStream(model, undefined, "Test", async () => {
      throw providerError(429, { "retry-after": "30" });
    });

    const message = await stream.result();

    assert.equal(message.stopReason, "error");
    assert.equal(classifyAssistantFailure(message).retryAfterMs, 30_000);
  });
});

describe("a request that never left", () => {
  test.each([
    [
      "Node's fetch when the name does not resolve",
      new TypeError("fetch failed", { cause: systemError("getaddrinfo ENOTFOUND", "ENOTFOUND") }),
      true,
    ],
    [
      "an SDK's connection error wrapping a refused connection",
      new Error("Connection error.", {
        cause: new TypeError("fetch failed", {
          cause: systemError("connect ECONNREFUSED", "ECONNREFUSED"),
        }),
      }),
      true,
    ],
    [
      "Bun's fetch when the connection is refused",
      systemError("Unable to connect", "ECONNREFUSED"),
      true,
    ],
    [
      "a connection reset after the request was sent",
      new TypeError("fetch failed", { cause: systemError("read ECONNRESET", "ECONNRESET") }),
      false,
    ],
    [
      "a timeout waiting for headers",
      new TypeError("fetch failed", {
        cause: systemError("Headers Timeout", "UND_ERR_HEADERS_TIMEOUT"),
      }),
      false,
    ],
    ["a gateway's 504", providerError(504, { "retry-after": "30" }), false],
  ])("%s", async (_name, error, unsent) => {
    const stream = runAssistantStream(model, undefined, "Test", async () => {
      throw error;
    });

    assert.equal(requestUnsent(await stream.result()), unsent);
  });
});
