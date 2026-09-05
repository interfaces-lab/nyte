/**
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/test/provider-retry.test.ts
 * Synced with pi 7ebf9087e.
 */
import assert from "node:assert/strict";
import { afterEach, describe, vi, test } from "vitest";
import { retryProviderRequest } from "../src/utils/provider-retry.ts";

function providerError(status: number | undefined, headers?: Record<string, string>): Error {
  return Object.assign(new Error(`Provider error: ${status}`), {
    status,
    headers: new Headers(headers),
  });
}

/** A request that rejects `failures` times with `error`, then resolves "ok". */
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

  test("allows disabling the provider-requested retry delay cap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const request = flakyRequest(providerError(429, { "retry-after": "2" }), 1);

    const result = retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 0 });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1999);
    await Promise.resolve();
    assert.equal(request.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(1);

    assert.equal(await result, "ok");
    assert.equal(request.mock.calls.length, 2);
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
