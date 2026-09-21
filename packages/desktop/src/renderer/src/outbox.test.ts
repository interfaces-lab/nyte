import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { SendInput, SendReceipt, SessionId } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import {
  createOutbox,
  HOME_WORKSPACE_PARTITION,
  retryDelayMs,
  workspacePartition,
} from "./outbox.ts";
import type { Outbox, OutboxRow } from "./outbox.ts";
import type { OutboxStorage, PersistedOutboxRecordV1 } from "./outbox-storage.ts";

const SESSION: SessionId = sessionId("session-1");
const OTHER: SessionId = sessionId("session-2");
const PROJECT = workspacePartition("/tmp/project");

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

/** A map-backed store whose reads and writes can be held or failed, to observe the outbox mid-write. */
function memoryStorage(seed: readonly PersistedOutboxRecordV1[] = []) {
  const stored = new Map(seed.map((record) => [record.key, record]));
  let holdLoad: Promise<void> | undefined;
  let holdPut: Promise<void> | undefined;
  let failLoad: Error | undefined;
  let failPut: Error | undefined;
  const gate = (): [Promise<void>, () => void] => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return [held, release];
  };
  const storage: OutboxStorage = {
    load: async () => {
      await holdLoad;
      if (failLoad !== undefined) throw failLoad;
      return [...stored.values()];
    },
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
    holdNextLoad: () => {
      const [held, release] = gate();
      holdLoad = held.then(() => {
        holdLoad = undefined;
      });
      return release;
    },
    holdPuts: () => {
      const [held, release] = gate();
      holdPut = held.then(() => {
        holdPut = undefined;
      });
      return release;
    },
    failLoadWith: (error: Error) => {
      failLoad = error;
    },
    failPutWith: (error: Error) => {
      failPut = error;
    },
  };
}

/** A bridge that answers each send by hand, and a clock the test advances by hand. */
function harness(seed: readonly PersistedOutboxRecordV1[] = []) {
  const sends: Deferred[] = [];
  const timers: Timer[] = [];
  const settled: { sessionId: SessionId; change: string }[] = [];
  const changes: OutboxRow[][] = [];
  const memory = memoryStorage(seed);
  let clock = 1_000;
  let keys = 0;
  const outbox: Outbox = createOutbox({
    storage: memory.storage,
    send: (input) =>
      new Promise<SendReceipt>((resolve, reject) => {
        sends.push({ input, resolve, reject });
      }),
    settled: (sessionId, change) => {
      settled.push({ sessionId, change });
      return Promise.resolve();
    },
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
  outbox.subscribe(() => changes.push([...outbox.rows()]));
  /** Move the clock and fire every timer that came due, in order. */
  const advance = (ms: number): void => {
    clock += ms;
    for (;;) {
      const next = timers
        .filter((timer) => !timer.fired && !timer.cancelled && timer.due <= clock)
        .sort((left, right) => left.due - right.due)[0];
      if (next === undefined) return;
      next.fired = true;
      next.run();
    }
  };
  const sentKeys = (): readonly (string | undefined)[] => sends.map((send) => send.input.key);
  return { outbox, sends, sentKeys, settled, changes, advance, ...memory };
}

/** Let the outbox observe a receipt or failure it was handed. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function record(
  key: string,
  workspace = HOME_WORKSPACE_PARTITION,
  overrides: Partial<PersistedOutboxRecordV1> = {},
): PersistedOutboxRecordV1 {
  return {
    version: 1,
    workspace,
    key,
    input: { sessionId: SESSION, content: key },
    createdAt: 1,
    failures: 0,
    nextAttemptAt: 1,
    ...overrides,
  };
}

describe("outbox", () => {
  test("draws the row as saving before the write lands, then submits under the minted key", async () => {
    const { outbox, sends, stored, holdPuts } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    const release = holdPuts();

    const submitted = outbox.submit({ sessionId: SESSION, content: "hello" });
    await tick();
    assert.deepEqual(outbox.rows(), [
      {
        key: "key-1",
        sessionId: SESSION,
        content: "hello",
        delivery: undefined,
        at: 1_000,
        state: { kind: "saving" },
      },
    ]);
    assert.equal(stored.has("key-1"), false);
    assert.equal(sends.length, 0);

    release();
    assert.equal(await submitted, "key-1");
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "sending" });
    assert.ok(stored.has("key-1"));
    assert.deepEqual(sends[0]?.input, { sessionId: SESSION, content: "hello", key: "key-1" });
  });

  test("refuses to submit before activation", async () => {
    const { outbox } = harness();

    await assert.rejects(outbox.submit({ sessionId: SESSION, content: "hello" }), /not ready/);
  });

  test("queued and duplicate both settle the row and forget the record", async () => {
    for (const receipt of [
      { kind: "queued", change: "c1" },
      { kind: "duplicate", change: "c1" },
    ] satisfies readonly SendReceipt[]) {
      const { outbox, sends, settled, stored } = harness();
      await outbox.activate(HOME_WORKSPACE_PARTITION);
      await outbox.submit({ sessionId: SESSION, content: "hello" });

      sends[0]?.resolve(receipt);
      await tick();

      assert.deepEqual(settled, [{ sessionId: SESSION, change: "c1" }], receipt.kind);
      assert.deepEqual(outbox.rows(), [], receipt.kind);
      assert.equal(stored.size, 0, receipt.kind);
    }
  });

  test("a failed send keeps the row, backs off, and retries with the same key", async () => {
    const { outbox, sends, sentKeys, stored, advance } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    await outbox.submit({ sessionId: SESSION, content: "hello" });

    sends[0]?.reject(new Error("bridge down"));
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "failed", reason: "bridge down" });
    assert.equal(stored.get("key-1")?.failures, 1);

    advance(499);
    assert.deepEqual(sentKeys(), ["key-1"]);
    advance(1);
    assert.deepEqual(sentKeys(), ["key-1", "key-1"]);

    sends[1]?.reject(new Error("still down"));
    await tick();
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "failed", reason: "still down" });
    advance(999);
    assert.equal(sends.length, 2);
    advance(1);
    assert.equal(sends.length, 3);

    sends[2]?.resolve({ kind: "duplicate", change: "c1" });
    await tick();
    assert.deepEqual(outbox.rows(), []);
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

  test("cancel drops the row and its record, and no retry follows", async () => {
    const { outbox, sends, changes, stored, advance } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    const key = await outbox.submit({ sessionId: SESSION, content: "hello" });
    sends[0]?.reject(new Error("bridge down"));
    await tick();

    outbox.cancel(key);
    advance(10_000);

    assert.deepEqual(outbox.rows(), []);
    assert.deepEqual(changes.at(-1), []);
    assert.equal(stored.size, 0);
    assert.equal(sends.length, 1);
  });

  test("cancel of an unknown key changes nothing", async () => {
    const { outbox, changes, stored } = harness([record("home")]);
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    const before = changes.length;

    outbox.cancel("nope");

    assert.equal(changes.length, before);
    assert.ok(stored.has("home"));
  });

  test("a cancel while a send is in flight does not resurrect the row on its receipt", async () => {
    for (const receipt of [
      { kind: "queued", change: "c1" },
      { kind: "duplicate", change: "c1" },
    ] satisfies readonly SendReceipt[]) {
      const { outbox, sends, settled } = harness();
      await outbox.activate(HOME_WORKSPACE_PARTITION);
      const key = await outbox.submit({ sessionId: SESSION, content: "hello" });

      outbox.cancel(key);
      sends[0]?.resolve(receipt);
      await tick();

      assert.deepEqual(outbox.rows(), [], receipt.kind);
      assert.deepEqual(settled, [], receipt.kind);
    }
  });

  test("a cancel while the row is still saving takes the write back once it lands", async () => {
    const { outbox, sends, stored, holdPuts } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    const release = holdPuts();
    const submitted = outbox.submit({ sessionId: SESSION, content: "hello" });
    await tick();

    outbox.cancel("key-1");
    release();
    await submitted;

    assert.deepEqual(outbox.rows(), []);
    assert.equal(stored.size, 0);
    assert.equal(sends.length, 0);
  });

  test("a failed write drops the row and surfaces the error", async () => {
    const { outbox, failPutWith } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    failPutWith(new Error("quota"));

    await assert.rejects(outbox.submit({ sessionId: SESSION, content: "hello" }), /quota/);
    assert.deepEqual(outbox.rows(), []);
  });

  test("a failed reload after a receipt still releases the row", async () => {
    const outbox = createOutbox({
      storage: memoryStorage().storage,
      send: () => Promise.resolve({ kind: "queued", change: "c1" }),
      settled: () => Promise.reject(new Error("snapshot unavailable")),
      mintKey: () => "k",
    });
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    await outbox.submit({ sessionId: SESSION, content: "hello" });

    await tick();

    assert.deepEqual(outbox.rows(), []);
  });

  test("activation shows and retries only the active partition's persisted rows", async () => {
    const { outbox, sentKeys, advance } = harness([record("home"), record("project", PROJECT)]);

    await outbox.activate(HOME_WORKSPACE_PARTITION);
    assert.deepEqual(
      outbox.rows().map((row) => row.key),
      ["home"],
    );
    advance(10_000);
    assert.deepEqual(sentKeys(), ["home"]);

    await outbox.activate(PROJECT);
    assert.deepEqual(
      outbox.rows().map((row) => row.key),
      ["project"],
    );
    advance(10_000);
    assert.deepEqual(sentKeys(), ["home", "project"]);
  });

  test("a hydrated row honors its stored backoff", async () => {
    const { outbox, sentKeys, advance } = harness([
      record("later", HOME_WORKSPACE_PARTITION, { nextAttemptAt: 1_300 }),
      record("overdue", HOME_WORKSPACE_PARTITION, { nextAttemptAt: 900 }),
    ]);

    await outbox.activate(HOME_WORKSPACE_PARTITION);
    advance(0);
    assert.deepEqual(sentKeys(), ["overdue"]);
    advance(299);
    assert.deepEqual(sentKeys(), ["overdue"]);
    advance(1);
    assert.deepEqual(sentKeys(), ["overdue", "later"]);
  });

  test("a receipt for a row whose partition left the screen leaves it stored until that partition returns", async () => {
    const { outbox, sends, sentKeys, settled, stored, advance } = harness([record("home")]);
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    advance(0);
    assert.deepEqual(sentKeys(), ["home"]);

    await outbox.activate(PROJECT);
    sends[0]?.resolve({ kind: "queued", change: "c1" });
    await tick();
    assert.deepEqual(settled, []);
    assert.ok(stored.has("home"));
    assert.deepEqual(outbox.rows(), []);

    await outbox.activate(HOME_WORKSPACE_PARTITION);
    assert.deepEqual(
      outbox.rows().map((row) => row.key),
      ["home"],
    );
    advance(0);
    assert.deepEqual(sentKeys(), ["home", "home"]);
    sends[1]?.resolve({ kind: "duplicate", change: "c1" });
    await tick();
    assert.deepEqual(settled, [{ sessionId: SESSION, change: "c1" }]);
    assert.deepEqual(outbox.rows(), []);
    assert.equal(stored.size, 0);
  });

  test("a failure for a row whose partition left the screen neither marks nor retries it", async () => {
    const { outbox, sends, stored, advance } = harness([record("home")]);
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    advance(0);

    await outbox.activate(PROJECT);
    sends[0]?.reject(new Error("bridge down"));
    await tick();
    advance(10_000);

    assert.equal(sends.length, 1);
    assert.equal(stored.get("home")?.failures, 0);
    await outbox.activate(HOME_WORKSPACE_PARTITION);
    assert.deepEqual(outbox.rows()[0]?.state, { kind: "sending" });
  });

  test("switching partitions mid-hydration shows the later partition and retries nothing stale", async () => {
    const { outbox, sentKeys, holdNextLoad, advance } = harness([
      record("home"),
      record("project", PROJECT),
    ]);
    const release = holdNextLoad();

    const first = outbox.activate(HOME_WORKSPACE_PARTITION);
    const second = outbox.activate(PROJECT);
    release();
    await Promise.all([first, second]);

    assert.deepEqual(
      outbox.rows().map((row) => row.key),
      ["project"],
    );
    advance(10_000);
    assert.deepEqual(sentKeys(), ["project"]);
  });

  test("a hydration failure refuses new rows", async () => {
    const { outbox, failLoadWith } = harness();
    failLoadWith(new Error("indexeddb closed"));
    await outbox.activate(HOME_WORKSPACE_PARTITION);

    await assert.rejects(
      outbox.submit({ sessionId: SESSION, content: "hello" }),
      /indexeddb closed/,
    );
  });

  test("rows keep submission order across sessions and subscribers see the latest rows", async () => {
    const { outbox, changes } = harness();
    await outbox.activate(HOME_WORKSPACE_PARTITION);

    await outbox.submit({ sessionId: SESSION, content: "one" });
    await outbox.submit({ sessionId: OTHER, content: "two" });
    await outbox.submit({ sessionId: SESSION, content: [{ type: "text", text: "three" }] });

    assert.deepEqual(
      outbox.rows().map((row) => [row.sessionId, row.key]),
      [
        [SESSION, "key-1"],
        [OTHER, "key-2"],
        [SESSION, "key-3"],
      ],
    );
    assert.deepEqual(changes.at(-1), outbox.rows());
  });
});
