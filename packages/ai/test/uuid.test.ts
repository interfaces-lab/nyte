/**
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/test/uuid.test.ts
 * Synced with pi 7ebf9087e.
 */
import assert from "node:assert/strict";
import { afterEach, describe, vi, test } from "vitest";
import { uuidv7 } from "../src/utils/uuid.ts";

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = 0x0123456789ab;

function parseTimestamp(uuid: string): number {
  return Number.parseInt(uuid.replaceAll("-", "").slice(0, 12), 16);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("uuidv7", () => {
  test("generates ordered UUIDv7s while preserving follower timestamps", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: TIMESTAMP });

    const first = uuidv7();
    const second = uuidv7();
    vi.setSystemTime(TIMESTAMP - 1);
    const afterRollback = uuidv7();
    vi.setSystemTime(TIMESTAMP + 1);
    const afterAdvance = uuidv7();
    const ordinaryIds = [first, second, afterRollback, afterAdvance];
    const followerTimestamp = TIMESTAMP - 1_000;
    const followers = [uuidv7(followerTimestamp), uuidv7(followerTimestamp)];

    for (const id of [...ordinaryIds, ...followers]) assert.match(id, UUID_V7_RE);
    assert.deepEqual(ordinaryIds, [...ordinaryIds].sort());
    assert.equal(new Set(ordinaryIds).size, ordinaryIds.length);
    assert.deepEqual(ordinaryIds.map(parseTimestamp), [
      TIMESTAMP,
      TIMESTAMP,
      TIMESTAMP,
      TIMESTAMP + 1,
    ]);
    assert.deepEqual(followers.map(parseTimestamp), [followerTimestamp, followerTimestamp]);
    assert.equal(new Set(followers).size, followers.length);
  });

  test("accepts exactly the 48-bit timestamp range", () => {
    assert.equal(parseTimestamp(uuidv7(0)), 0);
    assert.equal(parseTimestamp(uuidv7(2 ** 48 - 1)), 2 ** 48 - 1);
    for (const timestamp of [-1, 2 ** 48, 1.5]) {
      assert.throws(() => uuidv7(timestamp), RangeError);
    }
  });
});
