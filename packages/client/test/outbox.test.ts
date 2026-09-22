import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { SendInput, SendReceipt, SessionId } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import { createOutbox, retryDelayMs, stateFromSnapshot } from "../src/index.ts";
import type { OutboxRecord, OutboxStorage, SessionState, SessionUpdate } from "../src/index.ts";

const SESSION: SessionId = sessionId("session-1");

interface Deferred {
  readonly input: SendInput;
  readonly resolve: (receipt: SendReceipt) => void;
  readonly reject: (cause: Error) => void;
}

interface Timer {
  readonly due: number;
  readonly run: () => void;
  cancelled: boolean;
  fired: boolean;
}

function memoryStorage(seed: readonly OutboxRecord[] = []) {
  const stored = new Map(seed.map((record) => [record.key, record]));
  let holdPut: Promise<void> | undefined;
  let failPut: Error | undefined;
  const storage: OutboxStorage = {
    load: () => Promise.resolve([...stored.values()]),
    put: async (record) => {
      await holdPut;
      if (failPut !== undefined) throw failPut;
      stored.set(record.key, record);
    },
    remove: (key) => {
      stored.delete(key);
      return Promise.resolve();
    },
  };
  return {
    storage,
    stored,
    holdPuts: () => {
      const gate = Promise.withResolvers<void>();
      holdPut = gate.promise.then(() => {
        holdPut = undefined;
      });
      return gate.resolve;
    },
    failPutWith: (error: Error) => {
      failPut = error;
    },
  };
}

/** A bridge that answers each send by hand, and a clock the test advances by hand. */
function harness(seed: readonly OutboxRecord[] = []) {
  const sends: Deferred[] = [];
  const timers: Timer[] = [];
  const memory = memoryStorage(seed);
  let clock = 1_000;
  let keys = 0;
  const outbox = createOutbox({
    storage: memory.storage,
    send: (input) =>
      new Promise<SendReceipt>((resolve, reject) => {
        sends.push({ input, resolve, reject });
      }),
    schedule: (run, delayMs) => {
      const timer: Timer = { due: clock + delayMs, run, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => clock,
    mintKey: () => `key-${String(++keys)}`,
  });
  const advance = (ms: number): void => {
    clock += ms;
    for (const timer of timers) {
      if (timer.cancelled || timer.fired || timer.due > clock) continue;
      timer.fired = true;
      timer.run();
    }
  };
  const sentKeys = (): readonly (string | undefined)[] => sends.map((send) => send.input.key);
  return { outbox, sends, sentKeys, advance, ...memory };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function snapshotUpdate(state: Partial<SessionState>): SessionUpdate {
  const base = stateFromSnapshot({
    session: {
      sessionId: SESSION,
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [],
      activation: { kind: "active" },
      config: {},
    },
    head: "main",
    config: {},
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 0 },
    seq: 0,
    tip: null,
    transcript: [],
    pending: [],
  });
  return { kind: "snapshot", state: { ...base, ...state }, selectedVersion: undefined };
}

describe("outbox", () => {
  test("draws the row before the write lands, then sends under the minted key", async () => {
    const { outbox, sends, stored, holdPuts } = harness();
    const release = holdPuts();

    const submitted = outbox.submit({ sessionId: SESSION, content: "hello" });
    await tick();
    assert.deepEqual(outbox.rows(), [
      {
        key: "key-1",
        input: { sessionId: SESSION, content: "hello" },
        at: 1_000,
        state: { kind: "storing" },
      },
    ]);
    assert.equal(stored.has("key-1"), false);
    assert.equal(sends.length, 0);

    release();
    assert.equal(await submitted, "key-1");
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "sending", attempts: 1 });
    assert.ok(stored.has("key-1"));
    assert.deepEqual(sends[0]?.input, { sessionId: SESSION, content: "hello", key: "key-1" });
  });

  test("a receipt forgets the record and keeps the row durable until the watch draws it", async () => {
    for (const receipt of [
      { kind: "queued", change: "c1" },
      { kind: "duplicate", change: "c1" },
    ] satisfies readonly SendReceipt[]) {
      const { outbox, sends, sentKeys, stored, advance } = harness();
      const key = await outbox.submit({ sessionId: SESSION, content: "hello" });

      sends[0]?.resolve(receipt);
      await tick();

      assert.equal(stored.size, 0, receipt.kind);
      assert.deepEqual(outbox.rows()[0]?.state, { kind: "durable", change: "c1" }, receipt.kind);
      advance(10_000);
      assert.deepEqual(sentKeys(), [key], receipt.kind);

      outbox.observe({
        kind: "event",
        event: {
          seq: 1,
          kind: "queued",
          head: "main",
          item: { change: "c2", delivery: "next", at: 1, content: "other", key: "other" },
        },
        state: snapshotUpdate({}).state,
        selectedVersion: undefined,
      });
      assert.equal(outbox.rows().length, 1, receipt.kind);
      outbox.observe({
        kind: "event",
        event: {
          seq: 2,
          kind: "queued",
          head: "main",
          item: { change: "c1", delivery: "next", at: 1, content: "hello", key },
        },
        state: snapshotUpdate({}).state,
        selectedVersion: undefined,
      });
      assert.deepEqual(outbox.rows(), [], receipt.kind);
    }
  });

  test("a watch update before the receipt completes the handoff", async () => {
    for (const update of [
      snapshotUpdate({
        pending: [{ change: "c1", delivery: "next", at: 1, content: "hello", key: "key-1" }],
      }),
      {
        kind: "event",
        event: {
          seq: 1,
          kind: "queued",
          head: "main",
          item: {
            change: "c1",
            delivery: "next",
            at: 1,
            content: "hello",
            key: "key-1",
          },
        },
        state: snapshotUpdate({}).state,
        selectedVersion: undefined,
      },
    ] satisfies readonly SessionUpdate[]) {
      const { outbox, sends } = harness();
      await outbox.submit({ sessionId: SESSION, content: "hello" });

      outbox.observe(update);
      sends[0]?.resolve({ kind: "queued", change: "c1" });
      await tick();

      assert.deepEqual(outbox.rows(), [], update.kind);
    }
  });

  test("a snapshot that draws the key or withdraws the change releases the row", async () => {
    const { outbox, sends } = harness();
    const key = await outbox.submit({ sessionId: SESSION, content: "hello" });
    sends[0]?.resolve({ kind: "queued", change: "c1" });
    await tick();

    outbox.observe(snapshotUpdate({}));
    assert.equal(outbox.rows().length, 1);
    outbox.observe(
      snapshotUpdate({
        pending: [{ change: "c1", delivery: "next", at: 1, content: "hello", key }],
      }),
    );
    assert.deepEqual(outbox.rows(), []);

    await outbox.submit({ sessionId: SESSION, content: "again" });
    sends[1]?.resolve({ kind: "queued", change: "c2" });
    await tick();
    outbox.observe({
      kind: "event",
      event: { seq: 3, kind: "queue_cancelled", change: "c2" },
      state: snapshotUpdate({}).state,
      selectedVersion: undefined,
    });
    assert.deepEqual(outbox.rows(), []);
  });

  test("a failed send keeps the row, backs off, and retries with the same key", async () => {
    const { outbox, sends, sentKeys, stored, advance } = harness();
    await outbox.submit({ sessionId: SESSION, content: "hello" });

    sends[0]?.reject(new Error("bridge down"));
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, {
      kind: "retrying",
      attempts: 1,
      reason: "bridge down",
    });

    advance(499);
    assert.deepEqual(sentKeys(), ["key-1"]);
    advance(1);
    assert.deepEqual(sentKeys(), ["key-1", "key-1"]);

    sends[1]?.reject(new Error("still down"));
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, {
      kind: "retrying",
      attempts: 2,
      reason: "still down",
    });
    advance(999);
    assert.equal(sends.length, 2);
    advance(1);
    assert.equal(sends.length, 3);

    sends[2]?.resolve({ kind: "duplicate", change: "c1" });
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "durable", change: "c1" });
    assert.equal(stored.size, 0);
  });

  test("retry delay doubles from half a second and caps at ten seconds", () => {
    assert.equal(retryDelayMs(0), 500);
    assert.equal(retryDelayMs(1), 500);
    assert.equal(retryDelayMs(2), 1_000);
    assert.equal(retryDelayMs(3), 2_000);
    assert.equal(retryDelayMs(5), 8_000);
    assert.equal(retryDelayMs(6), 10_000);
    assert.equal(retryDelayMs(20), 10_000);
  });

  test("withdraw drops a waiting row and its record, and no retry follows", async () => {
    const { outbox, sends, stored, advance } = harness();
    const key = await outbox.submit({ sessionId: SESSION, content: "hello" });
    sends[0]?.reject(new Error("down"));
    await tick();

    assert.deepEqual(await outbox.withdraw(key), { kind: "withdrawn" });
    assert.deepEqual(outbox.rows(), []);
    assert.equal(stored.size, 0);
    advance(10_000);
    assert.equal(sends.length, 1);
    assert.equal(outbox.withdraw(key), undefined);
  });

  test("withdraw during a send answers with what the store did", async () => {
    for (const receipt of [
      { kind: "queued", change: "c1" },
      { kind: "duplicate", change: "c1" },
    ] satisfies readonly SendReceipt[]) {
      const { outbox, sends } = harness();
      const key = await outbox.submit({ sessionId: SESSION, content: "hello" });

      const outcome = outbox.withdraw(key);
      sends[0]?.resolve(receipt);
      assert.deepEqual(await outcome, { kind: "durable", change: "c1" }, receipt.kind);
      assert.deepEqual(outbox.rows(), [], receipt.kind);
    }
    const { outbox, sends } = harness();
    const key = await outbox.submit({ sessionId: SESSION, content: "hello" });
    const outcome = outbox.withdraw(key);
    sends[0]?.reject(new Error("down"));
    assert.deepEqual(await outcome, { kind: "withdrawn" });
    assert.deepEqual(outbox.rows(), []);
  });

  test("withdraw of a durable row answers its change", async () => {
    const { outbox, sends } = harness();
    const key = await outbox.submit({ sessionId: SESSION, content: "hello" });
    sends[0]?.resolve({ kind: "queued", change: "c1" });
    await tick();

    assert.deepEqual(await outbox.withdraw(key), { kind: "durable", change: "c1" });
    assert.deepEqual(outbox.rows(), []);
  });

  test("a withdraw while the row is still being stored takes the write back once it lands", async () => {
    const { outbox, sends, stored, holdPuts } = harness();
    const release = holdPuts();
    const submitted = outbox.submit({ sessionId: SESSION, content: "hello" });
    await tick();

    const withdrawal = outbox.withdraw("key-1");
    release();
    assert.deepEqual(await withdrawal, { kind: "withdrawn" });
    await submitted;
    await tick();

    assert.equal(stored.size, 0);
    assert.equal(sends.length, 0);
    assert.deepEqual(outbox.rows(), []);
  });

  test("a failed write drops the row and surfaces the error", async () => {
    const { outbox, sends, failPutWith } = harness();
    failPutWith(new Error("quota exceeded"));

    await assert.rejects(outbox.submit({ sessionId: SESSION, content: "hello" }), /quota/);
    assert.deepEqual(outbox.rows(), []);
    assert.equal(sends.length, 0);
  });

  test("activate replaces the rows with what storage holds and sends them", async () => {
    const { outbox, sends, sentKeys, stored } = harness([
      { key: "stored", input: { sessionId: SESSION, content: "stored" }, at: 1 },
    ]);
    await outbox.submit({ sessionId: SESSION, content: "live" });

    await outbox.activate();
    assert.deepEqual(
      outbox.rows().map((row) => row.key),
      ["stored", "key-1"],
    );
    assert.deepEqual(sentKeys(), ["key-1", "stored", "key-1"]);

    // The replaced send still answers the store, but only the activation's flights draw.
    sends[0]?.resolve({ kind: "queued", change: "c1" });
    await tick();
    assert.equal(stored.has("key-1"), false);
    assert.deepEqual(outbox.rows()[1]?.state, { kind: "sending", attempts: 1 });
    sends[2]?.resolve({ kind: "duplicate", change: "c1" });
    await tick();
    assert.deepEqual(outbox.rows()[1]?.state, { kind: "durable", change: "c1" });
  });

  test("rows keep submission order and subscribers hear each change", async () => {
    const { outbox, advance } = harness();
    const seen: number[] = [];
    const unsubscribe = outbox.subscribe(() => seen.push(outbox.rows().length));
    await outbox.submit({ sessionId: SESSION, content: "first" });
    advance(1);
    await outbox.submit({ sessionId: SESSION, content: "second" });

    assert.deepEqual(
      outbox.rows().map((row) => row.input.content),
      ["first", "second"],
    );
    assert.ok(seen.length >= 2);
    unsubscribe();
  });
});
