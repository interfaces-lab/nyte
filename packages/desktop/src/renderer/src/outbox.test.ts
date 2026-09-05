import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { SendInput, SendReceipt, SessionId } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import { createOutbox, retryDelayMs } from "./outbox.ts";
import type { Outbox, OutboxRow } from "./outbox.ts";

const SESSION: SessionId = sessionId("session-1");
const OTHER: SessionId = sessionId("session-2");

interface Deferred {
  readonly input: SendInput;
  readonly resolve: (receipt: SendReceipt) => void;
  readonly reject: (cause: Error) => void;
}

interface Scheduled {
  readonly delayMs: number;
  readonly run: () => void;
  cancelled: boolean;
}

/** A bridge that answers each send by hand, and a clock that fires timers by hand. */
function harness() {
  const sends: Deferred[] = [];
  const timers: Scheduled[] = [];
  const settled: { sessionId: SessionId; change: string }[] = [];
  const changes: OutboxRow[][] = [];
  let keys = 0;
  const outbox: Outbox = createOutbox({
    send: (input) =>
      new Promise<SendReceipt>((resolve, reject) => {
        sends.push({ input, resolve, reject });
      }),
    settled: (sessionId, change) => {
      settled.push({ sessionId, change });
      return Promise.resolve();
    },
    schedule: (run, delayMs) => {
      const timer: Scheduled = { delayMs, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => 42,
    mintKey: () => `key-${String(++keys)}`,
  });
  outbox.subscribe(() => changes.push([...outbox.rows()]));
  return { outbox, sends, timers, settled, changes };
}

/** Let the outbox observe a receipt or failure it was handed. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("outbox", () => {
  test("draws the row at once and submits under a minted key", () => {
    const { outbox, sends } = harness();

    const key = outbox.submit({ sessionId: SESSION, content: "hello" });

    assert.equal(key, "key-1");
    assert.deepEqual(outbox.rows(), [
      { key: "key-1", sessionId: SESSION, content: "hello", at: 42, state: { kind: "sending" } },
    ]);
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0]?.input, { sessionId: SESSION, content: "hello", key: "key-1" });
  });

  test("queued and duplicate both settle the row after the thread is reloaded", async () => {
    for (const receipt of [
      { kind: "queued", change: "c1" },
      { kind: "duplicate", change: "c1" },
    ] satisfies readonly SendReceipt[]) {
      const { outbox, sends, settled } = harness();
      outbox.submit({ sessionId: SESSION, content: "hello" });

      sends[0]?.resolve(receipt);
      await tick();

      assert.deepEqual(settled, [{ sessionId: SESSION, change: "c1" }], receipt.kind);
      assert.deepEqual(outbox.rows(), [], receipt.kind);
    }
  });

  test("a failed send keeps the row, counts the failure, and retries with the same key", async () => {
    const { outbox, sends, timers } = harness();
    outbox.submit({ sessionId: SESSION, content: "hello" });

    sends[0]?.reject(new Error("bridge down"));
    await tick();

    assert.deepEqual(outbox.rows()[0]?.state, { kind: "failed", reason: "bridge down" });
    assert.equal(timers.length, 1);
    assert.equal(timers[0]?.delayMs, retryDelayMs(1));
    assert.equal(sends.length, 1);

    timers[0]?.run();
    assert.equal(sends.length, 2);
    assert.equal(sends[1]?.input.key, "key-1");

    sends[1]?.reject(new Error("still down"));
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "failed", reason: "still down" });
    assert.equal(timers[1]?.delayMs, retryDelayMs(2));

    timers[1]?.run();
    sends[2]?.resolve({ kind: "duplicate", change: "c1" });
    await tick();
    assert.deepEqual(outbox.rows(), []);
  });

  test("retry delay doubles from half a second and caps at ten seconds", () => {
    assert.equal(retryDelayMs(1), 500);
    assert.equal(retryDelayMs(2), 1_000);
    assert.equal(retryDelayMs(3), 2_000);
    assert.equal(retryDelayMs(20), 10_000);
  });

  test("cancel drops the row and its pending retry", async () => {
    const { outbox, sends, timers, changes } = harness();
    const key = outbox.submit({ sessionId: SESSION, content: "hello" });
    sends[0]?.reject(new Error("bridge down"));
    await tick();

    outbox.cancel(key);

    assert.deepEqual(outbox.rows(), []);
    assert.equal(timers[0]?.cancelled, true);
    assert.deepEqual(changes.at(-1), []);
  });

  test("a cancel while a send is in flight does not resurrect the row on its receipt", async () => {
    const { outbox, sends, settled } = harness();
    const key = outbox.submit({ sessionId: SESSION, content: "hello" });

    outbox.cancel(key);
    sends[0]?.resolve({ kind: "queued", change: "c1" });
    await tick();

    assert.deepEqual(outbox.rows(), []);
    assert.deepEqual(settled, []);
  });

  test("a failed reload after a receipt still releases the row", async () => {
    const outbox = createOutbox({
      send: () => Promise.resolve({ kind: "queued", change: "c1" }),
      settled: () => Promise.reject(new Error("snapshot unavailable")),
      mintKey: () => "k",
    });
    outbox.submit({ sessionId: SESSION, content: "hello" });

    await tick();

    assert.deepEqual(outbox.rows(), []);
  });

  test("rows keep submission order across sessions and notify subscribers", () => {
    const { outbox, changes } = harness();

    outbox.submit({ sessionId: SESSION, content: "one" });
    outbox.submit({ sessionId: OTHER, content: "two" });
    outbox.submit({ sessionId: SESSION, content: [{ type: "text", text: "three" }] });

    assert.deepEqual(
      outbox.rows().map((row) => [row.sessionId, row.key]),
      [
        [SESSION, "key-1"],
        [OTHER, "key-2"],
        [SESSION, "key-3"],
      ],
    );
    assert.equal(changes.length, 3);
  });
});
