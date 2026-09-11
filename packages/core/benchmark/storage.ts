import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Event, Obj } from "../src/kernel/model.ts";
import { SqliteStore } from "../src/kernel/sqlite.ts";
import { hashObject } from "../src/kernel/hash.ts";
import { SEED, TEXT } from "./fixtures.ts";
import { summarize, timed, type Repetitions } from "./measure.ts";

export async function sqliteObjects(count: number, repetitions: Repetitions) {
  const rows = [];
  const objects: Obj[] = Array.from({ length: count }, (_, index) => ({
    kind: "blob",
    value: { seed: SEED, index, text: TEXT },
  }));
  const expectedOids = objects.map(hashObject);
  for (const mode of ["memory", "file-wal-full"] as const) {
    const puts = [];
    const gets = [];
    for (let index = -repetitions.warmups; index < repetitions.samples; index++) {
      const directory = await mkdtemp("/tmp/nyte-benchmark-");
      let store: SqliteStore | undefined;
      try {
        store = new SqliteStore(mode === "memory" ? ":memory:" : join(directory, "store.db"));
        const session = await store.create({ id: SEED });
        assert.equal((await session.objects.list()).length, 0);
        const put = await timed(() => session.objects.put(objects));
        assert.deepEqual(put.result, expectedOids);
        assert.equal((await session.objects.list()).length, count);
        // Prime the existing statement cache outside the measured get batch.
        const firstOid = expectedOids[0];
        assert.ok(firstOid);
        assert.deepEqual(await session.objects.get(firstOid), objects[0]);
        const get = await timed(async () => {
          const found = [];
          for (const oid of expectedOids) found.push(await session.objects.get(oid));
          return found;
        });
        assert.deepEqual(get.result, objects);
        assert.equal((await session.objects.list()).length, count);
        if (index >= 0) {
          puts.push(put.measurement);
          gets.push(get.measurement);
        }
      } finally {
        try {
          await store?.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
    const fixture = {
      seed: SEED,
      objects: count,
      textCharacters: TEXT.length,
      uniqueObjects: count,
    };
    const metadata = {
      fixture,
      memoryMode: mode,
      synchronous: "FULL",
      journal: mode === "memory" ? "memory" : "WAL",
      warmups: repetitions.warmups,
    };
    rows.push({ operation: "objects.put batch", ...metadata, ...summarize(puts) });
    rows.push({
      operation: "objects.get sequential batch, prepared statement primed",
      ...metadata,
      ...summarize(gets),
    });
  }
  return rows;
}

export async function watchReplay(count: number, repetitions: Repetitions) {
  const rows = [];
  for (const slow of [false, true]) {
    const samples = [];
    for (let index = -repetitions.warmups; index < repetitions.samples; index++) {
      const store = new SqliteStore(":memory:");
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
      let iterator: AsyncIterator<Event> | undefined;
      try {
        const session = await store.create({ id: SEED });
        const notices = Array.from({ length: count }, (_, notice) => ({
          kind: "notice" as const,
          level: "info" as const,
          owner: SEED,
          message: `${String(notice).padStart(6, "0")}:${TEXT}`.slice(0, 256),
        }));
        if (slow) {
          assert.equal((await session.events.append(notices.slice(0, 1))).ok, true);
          iterator = session.events
            .watch({ afterSeq: 0, signal: controller.signal })
            [Symbol.asyncIterator]();
          const first = await iterator.next();
          assert.ok(!first.done);
          assert.equal(first.value.seq, 1);
          assert.deepEqual(first.value, { ...notices[0], at: first.value.at, seq: 1 });
          // The consumer is paused at a yield while a durable burst accumulates.
          assert.equal((await session.events.append(notices.slice(1))).ok, true);
        } else {
          assert.equal((await session.events.append(notices)).ok, true);
          iterator = session.events
            .watch({ afterSeq: 0, signal: controller.signal })
            [Symbol.asyncIterator]();
        }
        const expected = await session.events.read({ afterSeq: slow ? 1 : 0 });
        assert.equal(await session.events.last(), count);
        assert.deepEqual(
          expected.map((event) => event.seq),
          Array.from({ length: count - (slow ? 1 : 0) }, (_, offset) => offset + (slow ? 2 : 1)),
        );
        for (const event of expected) {
          const notice = notices[event.seq - 1];
          assert.deepEqual(event, { ...notice, at: event.at, seq: event.seq });
        }
        const active = iterator;
        const consumed = await timed(async () => {
          const events: Event[] = [];
          let injectedDelayMs = 0;
          for (let offset = 0; offset < expected.length; offset++) {
            if (slow && offset % 32 === 0) {
              const start = performance.now();
              await setTimeout(1);
              injectedDelayMs += performance.now() - start;
            }
            const next = await active.next();
            if (next.done) break;
            events.push(next.value);
          }
          return { events, injectedDelayMs };
        });
        assert.deepEqual(consumed.result.events, expected);
        assert.equal(
          new Set(consumed.result.events.map((event) => event.seq)).size,
          expected.length,
        );
        const pending = iterator.next();
        controller.abort();
        assert.equal((await pending).done, true);
        if (index >= 0)
          samples.push({
            ...consumed.measurement,
            injectedDelayMs: consumed.result.injectedDelayMs,
          });
      } finally {
        controller.abort();
        clearTimeout(timeout);
        try {
          await iterator?.return?.();
        } finally {
          await store.close();
        }
      }
    }
    rows.push({
      operation: slow
        ? "events.watch paused consumer, durable burst, delayed drain"
        : "events.watch durable replay",
      fixture: {
        seed: SEED,
        durableNotices: count,
        measuredEvents: count - (slow ? 1 : 0),
        textCharacters: 256,
      },
      memoryMode: "memory",
      warmups: repetitions.warmups,
      requestedDelayMsPer32Events: slow ? 1 : 0,
      injectedDelayMs: samples.map((sample) => sample.injectedDelayMs),
      ...summarize(samples),
    });
  }
  return rows;
}
