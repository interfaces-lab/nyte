import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, test } from "vitest";
import { hashObject } from "../src/kernel/hash.ts";
import { CursorExpired, type Commit, type Event, type EventBody } from "../src/kernel/model.ts";
import { UnknownSession } from "../src/kernel/store.ts";
import { PostgresStore, type PostgresDatabase } from "../src/postgres.ts";

const notice = (message: string): EventBody => ({
  kind: "notice",
  level: "info",
  owner: "test",
  message,
});
let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create();
}, 20_000);

afterAll(async () => {
  await database.close();
});

function connection(pg: PGlite): PostgresDatabase {
  return {
    query: async (text, values = []) =>
      (await pg.query<Record<string, unknown>>(text, [...values])).rows,
    transaction: (run) =>
      pg.transaction(async (transaction) =>
        run({
          query: async (text, values = []) =>
            (await transaction.query<Record<string, unknown>>(text, [...values])).rows,
        }),
      ),
    // These handles share an engine; the fixture owns its lifetime.
    close: async () => {},
  };
}

async function sessions() {
  const firstStore = new PostgresStore(connection(database), { watchPollIntervalMs: 5 });
  const secondStore = new PostgresStore(connection(database), { watchPollIntervalMs: 5 });
  const first = await firstStore.create({ id: `postgres-test-${randomUUID()}` });
  const second = await secondStore.open(first.id);
  return { firstStore, secondStore, first, second };
}

async function nextEvent(iterator: AsyncIterator<Event>): Promise<Event> {
  const result = await iterator.next();
  assert.equal(result.done, false);
  assert.ok(result.value);
  return result.value;
}

test("independent PostgreSQL stores see canonical objects, chains, refs, and session lifecycle", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  const object = { kind: "blob", value: { x: 1, y: 2 } } satisfies Parameters<
    typeof first.objects.put
  >[0][number];
  const oid = hashObject(object);
  assert.deepEqual(await first.objects.put([object]), [oid]);
  assert.deepEqual(await second.objects.put([{ kind: "blob", value: { y: 2, x: 1 } }]), [oid]);
  assert.deepEqual(await second.objects.get(oid), object);
  assert.equal((await first.objects.list()).length, 1);
  await first.refs.update([{ name: "refs/facts/a", from: null, to: oid }], { reason: "publish" });
  assert.equal(await second.refs.read("refs/facts/a"), oid);
  assert.ok((await secondStore.list()).some((item) => item.id === first.id));
  await assert.rejects(firstStore.create({ id: first.id }), /Session already exists/);

  const root: Commit = {
    kind: "commit",
    parent: null,
    body: { kind: "note", type: "root" },
    at: 1,
  };
  const rootOid = hashObject(root);
  const child: Commit = {
    kind: "commit",
    parent: rootOid,
    body: { kind: "note", type: "child" },
    at: 2,
  };
  const childOid = hashObject(child);
  await first.objects.put([child, root]);
  assert.deepEqual(await second.objects.chain(childOid, { limit: 3 }), [
    { oid: childOid, object: child },
    { oid: rootOid, object: root },
  ]);
  assert.deepEqual(
    (await second.objects.chain(childOid, { limit: 1 })).map((item) => item.oid),
    [childOid],
  );
  assert.deepEqual(
    (await second.objects.commits()).map((item) => item.oid),
    [rootOid, childOid],
  );
  assert.equal(await second.objects.delete([rootOid, rootOid]), 1);
  assert.equal(await first.objects.get(rootOid), undefined);

  await second.close();
  await assert.rejects(second.refs.read("refs/facts/a"), /Session is closed/);
  assert.equal(await first.refs.read("refs/facts/a"), oid);
  await secondStore.delete(first.id);
  await assert.rejects(firstStore.open(first.id), UnknownSession);
  await assert.rejects(first.events.last(), UnknownSession);
  await assert.rejects(first.objects.put([object]), UnknownSession);
  await firstStore.close();
  await secondStore.close();
});

test("competing CAS has one winner, with all refs and extra events committed atomically", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  const outcomes = await Promise.all([
    first.refs.update(
      [
        { name: "refs/heads/main", from: null, to: "a" },
        { name: "refs/facts/winner", from: null, to: "a" },
      ],
      { reason: "a", actor: { userId: "a" }, events: [notice("a")] },
    ),
    second.refs.update(
      [
        { name: "refs/heads/main", from: null, to: "b" },
        { name: "refs/facts/winner", from: null, to: "b" },
      ],
      { reason: "b", actor: { userId: "b" }, events: [notice("b")] },
    ),
  ]);
  assert.equal(outcomes.filter((result) => result.ok).length, 1);
  const winner = await first.refs.read("refs/heads/main");
  assert.equal(await second.refs.read("refs/facts/winner"), winner);
  const events = await second.events.read({ afterSeq: 0 });
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    ["ref", "ref", "notice"],
  );
  assert.equal(events[2]?.kind === "notice" ? events[2].message : undefined, winner);

  assert.deepEqual(
    await first.refs.update(
      [
        { name: "refs/facts/absent", from: null, to: "orphan" },
        { name: "refs/heads/main", from: "stale", to: "orphan" },
      ],
      { reason: "stale", events: [notice("must not appear")] },
    ),
    {
      ok: false,
      reason: "conflict",
      name: "refs/heads/main",
      actual: winner,
    },
  );
  assert.equal(await second.refs.read("refs/facts/absent"), null);
  await first.refs.update([{ name: "refs/heads/main", from: winner, to: winner }], {
    reason: "assert",
  });
  assert.equal(await second.events.last(), 3);
  await firstStore.close();
  await secondStore.close();
});

test("a failure appending events rolls back both refs and event sequence", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  await database.query(
    "ALTER TABLE nyte_events ADD CONSTRAINT reject_test_notice CHECK (body NOT LIKE '%reject-this-event%')",
  );
  try {
    await assert.rejects(
      first.refs.update([{ name: "refs/heads/main", from: null, to: "candidate" }], {
        reason: "publish",
        events: [notice("reject-this-event")],
      }),
    );
    assert.equal(await second.refs.read("refs/heads/main"), null);
    assert.equal(await second.events.last(), 0);
    assert.deepEqual(await second.events.read({ afterSeq: 0 }), []);
  } finally {
    await database.query("ALTER TABLE nyte_events DROP CONSTRAINT reject_test_notice");
  }
  assert.deepEqual(await second.events.append([notice("accepted")]), { ok: true, seq: 1 });
  await firstStore.close();
  await secondStore.close();
});

test("lease takeover fences stale refs, deltas, renewals, and release across stores", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  const acquired = await first.leases.acquire("runner", 20);
  assert.ok(acquired.ok);
  const occupied = await second.leases.acquire("runner", 20);
  assert.equal(occupied.ok, false);
  await setTimeout(25);
  assert.equal(await second.leases.read("runner"), undefined);
  const successor = await second.leases.acquire("runner", 10_000);
  assert.ok(successor.ok);
  assert.equal(successor.lease.fence, acquired.lease.fence + 1);
  assert.deepEqual(
    await first.refs.update([{ name: "refs/heads/main", from: null, to: "stale" }], {
      reason: "stale",
      lease: acquired.lease,
    }),
    { ok: false, reason: "fenced" },
  );
  assert.deepEqual(await first.events.append([notice("stale")], { lease: acquired.lease }), {
    ok: false,
    reason: "fenced",
  });
  assert.equal(await first.leases.renew(acquired.lease, 10_000), false);
  assert.equal(await first.leases.release(acquired.lease), false);
  assert.deepEqual(await second.events.append([notice("successor")], { lease: successor.lease }), {
    ok: true,
    seq: 1,
  });
  assert.equal(await second.leases.renew(successor.lease, 10_000), true);
  assert.equal(await second.leases.release(successor.lease), true);
  assert.equal(await first.leases.read("runner"), undefined);
  await firstStore.close();
  await secondStore.close();
});

test("watch replays paged history and follows independent writes without gaps or duplicates", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  const controller = new AbortController();
  await first.events.append(Array.from({ length: 300 }, (_, index) => notice(String(index))));
  const iterator = second.events
    .watch({ afterSeq: 0, signal: controller.signal })
    [Symbol.asyncIterator]();
  const received: number[] = [];
  for (let index = 0; index < 300; index += 1) received.push((await nextEvent(iterator)).seq);
  const waiting = nextEvent(iterator);
  await first.events.append([notice("live")]);
  received.push((await waiting).seq);
  assert.deepEqual(
    received,
    Array.from({ length: 301 }, (_, index) => index + 1),
  );
  controller.abort();
  assert.equal((await iterator.next()).done, true);
  await firstStore.close();
  await secondStore.close();
});

test("trim expires old readers and watchers, and closing the store ends idle watches", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  await first.events.append([notice("one"), notice("two")]);
  await first.events.trim(1);
  await assert.rejects(second.events.read({ afterSeq: 0 }), CursorExpired);
  const expired = second.events.watch({ afterSeq: 0 })[Symbol.asyncIterator]();
  await assert.rejects(expired.next(), CursorExpired);
  assert.deepEqual(
    (await second.events.read({ afterSeq: 1 })).map((event) => event.seq),
    [2],
  );
  assert.deepEqual(await second.events.read({ afterSeq: 2, limit: 0 }), []);
  await first.events.trim(100);
  assert.equal(await second.events.floor(), 2);
  await first.events.trim(0);
  assert.equal(await second.events.floor(), 2);
  assert.deepEqual(await second.events.append([notice("three")]), { ok: true, seq: 3 });
  const watcher = second.events.watch({ afterSeq: 3 })[Symbol.asyncIterator]();
  const pending = watcher.next();
  await setTimeout(10);
  await secondStore.close();
  assert.equal((await pending).done, true);
  await firstStore.close();
});

test("database objects and events are validated before returning them to core", async () => {
  const { firstStore, secondStore, first, second } = await sessions();
  const [oid] = await first.objects.put([{ kind: "blob", value: "original" }]);
  assert.ok(oid);
  await database.query("UPDATE nyte_objects SET body = $3 WHERE session_id = $1 AND oid = $2", [
    first.id,
    oid,
    '{"kind":"blob","value":"tampered"}',
  ]);
  await assert.rejects(second.objects.get(oid), /does not match its hash/);
  await first.events.append([notice("valid")]);
  await database.query("UPDATE nyte_events SET body = $2 WHERE session_id = $1", [
    first.id,
    '{"kind":"unknown"}',
  ]);
  await assert.rejects(second.events.read({ afterSeq: 0 }), /not a known event body/);
  await firstStore.close();
  await secondStore.close();
});

test("sessions, refs, leases, and events survive closing and reopening the PostgreSQL engine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-postgres-"));
  try {
    const firstDatabase = await PGlite.create(directory);
    const firstStore = new PostgresStore(connection(firstDatabase));
    const session = await firstStore.create({ id: "durable" });
    const object = { kind: "blob", value: "survives-restart" } satisfies Parameters<
      typeof session.objects.put
    >[0][number];
    const [oid] = await session.objects.put([object]);
    assert.ok(oid);
    await session.refs.update([{ name: "refs/facts/durable", from: null, to: oid }], {
      reason: "persist",
    });
    const lease = await session.leases.acquire("runner", 60_000);
    assert.ok(lease.ok);
    await firstStore.close();
    await firstDatabase.close();

    const secondDatabase = await PGlite.create(directory);
    const secondStore = new PostgresStore(connection(secondDatabase));
    try {
      const restored = await secondStore.open("durable");
      assert.equal(await restored.refs.read("refs/facts/durable"), oid);
      assert.deepEqual(await restored.objects.get(oid), object);
      assert.equal(await restored.events.last(), 1);
      assert.deepEqual(
        (await restored.events.read({ afterSeq: 0 })).map((event) => event.kind),
        ["ref"],
      );
      assert.deepEqual(await restored.leases.read("runner"), lease.lease);
    } finally {
      await secondStore.close();
      await secondDatabase.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
