import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sessionId } from "@nyte-ai/core";
import type { PostgresDatabase, PostgresRow } from "@nyte-ai/core/postgres";
import { test, vi } from "vitest";
import { dispatchOutbox, reconcileDispatch } from "../src/outbox.ts";

function outboxFor(database: PGlite) {
  const connection: PostgresDatabase = {
    query: async (sql, values = []) => (await database.query<PostgresRow>(sql, [...values])).rows,
    transaction: (run) =>
      database.transaction(async (transaction) =>
        run({
          query: async (sql, values = []) =>
            (await transaction.query<PostgresRow>(sql, [...values])).rows,
        }),
      ),
    close: async () => {},
  };

  return dispatchOutbox(connection);
}

test("a crash before dispatch leaves a recoverable obligation across database reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-outbox-"));

  try {
    const first = await PGlite.create(directory);
    const writer = outboxFor(first);
    await writer.initialize();
    const target = { sessionId: sessionId("accepted"), head: "main" };
    await writer.record(target);
    await first.close();
    const second = await PGlite.create(directory);

    try {
      const recovered = outboxFor(second);
      await recovered.initialize();
      const wakes: (typeof target)[] = [];
      assert.deepEqual(
        await reconcileDispatch({
          outbox: recovered,
          graceMs: 0,
          wake: async (input) => {
            wakes.push({ ...input, head: input.head ?? "main" });
          },
        }),
        { dispatched: 1, failed: 0, settled: 0 },
      );
      assert.deepEqual(wakes, [target]);
      assert.equal((await recovered.claim(0)).length, 1);
    } finally {
      await second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconcile before a late admission never settles its only recovery record", async (context) => {
  const database = await PGlite.create();
  context.onTestFinished(() => database.close());
  const outbox = outboxFor(database);
  await outbox.initialize();
  const id = await outbox.record({ sessionId: sessionId("late-admission") });
  let committed = false;
  let driven = false;

  const wake = async () => {
    if (committed) driven = true;
  };

  await reconcileDispatch({ outbox, wake, graceMs: 0 });
  assert.equal(driven, false);
  committed = true;
  await reconcileDispatch({ outbox, wake, graceMs: 0 });
  assert.equal(driven, true);
  assert.equal((await outbox.claim(0)).length, 1);
  await outbox.settle(id);
  assert.equal((await outbox.claim(0)).length, 0);
});

test("bounded reconciliation rotates failures without blocking other obligations", async (context) => {
  const database = await PGlite.create();
  context.onTestFinished(() => database.close());
  const outbox = outboxFor(database);
  await outbox.initialize();
  await outbox.record({ sessionId: sessionId("a") });
  await outbox.record({ sessionId: sessionId("b") });
  const seen: string[] = [];

  const wake = async (input: { sessionId: string }) => {
    seen.push(input.sessionId);
    throw new Error("dispatch unavailable");
  };

  assert.deepEqual(await reconcileDispatch({ outbox, wake, graceMs: 0, limit: 1 }), {
    dispatched: 0,
    failed: 1,
    settled: 0,
  });
  await reconcileDispatch({ outbox, wake, graceMs: 0, limit: 1 });
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal((await outbox.claim(0)).length, 2);
});

test("overlapping reconcilers dispatch each obligation once", async (context) => {
  const database = await PGlite.create();
  context.onTestFinished(() => database.close());
  vi.useFakeTimers({ toFake: ["Date"] });
  context.onTestFinished(() => {
    vi.useRealTimers();
  });
  const outbox = outboxFor(database);
  await outbox.initialize();
  await outbox.record({ sessionId: sessionId("a") });
  await outbox.record({ sessionId: sessionId("b") });
  vi.advanceTimersByTime(120_000);
  const seen: string[] = [];

  const wake = async (input: { sessionId: string }) => {
    seen.push(input.sessionId);
  };

  await Promise.all([reconcileDispatch({ outbox, wake }), reconcileDispatch({ outbox, wake })]);
  assert.deepEqual(seen.toSorted(), ["a", "b"]);
});

test("aged obligations settle only after a successful wake", async (context) => {
  const database = await PGlite.create();
  context.onTestFinished(() => database.close());
  const outbox = outboxFor(database);
  await outbox.initialize();
  await outbox.record({ sessionId: sessionId("orphan") });
  let available = false;

  const wake = async () => {
    if (!available) throw new Error("dispatch unavailable");
  };

  assert.deepEqual(await reconcileDispatch({ outbox, wake, graceMs: 0, settleAfterMs: 0 }), {
    dispatched: 0,
    failed: 1,
    settled: 0,
  });
  available = true;
  assert.deepEqual(await reconcileDispatch({ outbox, wake, graceMs: 0, settleAfterMs: 60_000 }), {
    dispatched: 1,
    failed: 0,
    settled: 0,
  });
  assert.deepEqual(await reconcileDispatch({ outbox, wake, graceMs: 0, settleAfterMs: 0 }), {
    dispatched: 1,
    failed: 0,
    settled: 1,
  });
  assert.deepEqual(await reconcileDispatch({ outbox, wake, graceMs: 0 }), {
    dispatched: 0,
    failed: 0,
    settled: 0,
  });
});
