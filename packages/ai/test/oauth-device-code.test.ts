/**
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/test/oauth-device-code.test.ts
 * Synced with pi 7ebf9087e.
 */
import assert from "node:assert/strict";
import { afterEach, describe, vi, test } from "vitest";
import { pollOAuthDeviceCodeFlow } from "../src/auth/oauth/device-code.ts";

const neverAbortedSignal = new AbortController().signal;

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("can wait before the first poll", async () => {
    const start = new Date("2026-03-09T00:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"], now: start });

    const pollTimes: number[] = [];
    const resultPromise = pollOAuthDeviceCodeFlow({
      intervalSeconds: 2,
      expiresInSeconds: 30,
      waitBeforeFirstPoll: true,
      poll: async () => {
        pollTimes.push(Date.now());
        return { status: "complete" as const, value: "token" };
      },
      signal: neverAbortedSignal,
    });

    await vi.advanceTimersByTimeAsync(1999);
    assert.deepEqual(pollTimes, []);

    await vi.advanceTimersByTimeAsync(1);
    assert.equal(await resultPromise, "token");
    assert.deepEqual(pollTimes, [start + 2000]);
  });

  test("increases the interval by 5 seconds after slow_down without a server interval", async () => {
    const startTime = new Date("2026-03-09T00:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"], now: startTime });

    const pollTimes: number[] = [];
    const results = [
      { status: "slow_down" as const },
      { status: "complete" as const, value: "token" },
    ];
    const resultPromise = pollOAuthDeviceCodeFlow({
      intervalSeconds: 2,
      expiresInSeconds: 900,
      poll: async () => {
        pollTimes.push(Date.now());
        const result = results.shift();
        if (!result) throw new Error("Unexpected extra poll");
        return result;
      },
      signal: neverAbortedSignal,
    });

    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(pollTimes, [startTime]);

    await vi.advanceTimersByTimeAsync(6999);
    assert.deepEqual(pollTimes, [startTime]);

    await vi.advanceTimersByTimeAsync(1);
    assert.equal(await resultPromise, "token");
    assert.deepEqual(pollTimes, [startTime, startTime + 7000]);
  });
});
