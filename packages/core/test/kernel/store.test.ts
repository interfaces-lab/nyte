/**
 * The store contract, by outcome: what reads return after writes, what the
 * event stream carries, when a write is refused. Nothing here looks at the
 * database file.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { CursorExpired } from "@nyte-ai/protocol";
import { type Change, type Event, type Obj } from "../../src/kernel/model.ts";
import { SqliteStore } from "../../src/kernel/sqlite.ts";
import { UnknownSession } from "../../src/kernel/store.ts";
import {
  granted,
  lease,
  nextEvent,
  openSession,
  openStore,
  only,
  reflog,
  sleep,
  storePath,
  within,
} from "./helpers.ts";

const blob = (value: string): Obj => ({ kind: "blob", value: { value } });

test("an object reads back as it was written and has one id whatever the key order", async () => {
  const session = await openSession();
  const [a] = await session.objects.put([
    { kind: "blob", value: { x: 1, y: [2, { b: 1, a: 2 }] } },
  ]);
  const [b] = await session.objects.put([
    { kind: "blob", value: { y: [2, { a: 2, b: 1 }], x: 1 } },
  ]);
  assert.equal(a, b);
  assert.deepEqual(await session.objects.get(only([a ?? ""])), {
    kind: "blob",
    value: { x: 1, y: [2, { b: 1, a: 2 }] },
  });
  assert.equal((await session.objects.list()).length, 1);
  assert.equal(await session.objects.get("0".repeat(64)), undefined);

  assert.equal(await session.objects.delete([a ?? ""]), 1);
  assert.equal(await session.objects.get(a ?? ""), undefined);
});

test("refs move only by compare-and-swap and report what they actually hold", async () => {
  const session = await openSession();
  const [one, two] = await session.objects.put([blob("one"), blob("two")]);
  assert.equal(await session.refs.read("refs/heads/a"), null);

  const created = await session.refs.update([{ name: "refs/heads/a", from: null, to: one ?? "" }], {
    reason: "create",
  });
  assert.equal(created.ok, true);
  assert.equal(await session.refs.read("refs/heads/a"), one);

  const stale = await session.refs.update([{ name: "refs/heads/a", from: null, to: two ?? "" }], {
    reason: "create",
  });
  assert.deepEqual(stale, { ok: false, reason: "conflict", name: "refs/heads/a", actual: one });
  assert.equal(await session.refs.read("refs/heads/a"), one);

  const deleted = await session.refs.update([{ name: "refs/heads/a", from: one ?? "", to: null }], {
    reason: "delete",
  });
  assert.equal(deleted.ok, true);
  assert.equal(await session.refs.read("refs/heads/a"), null);
});

test("a batch of ref updates applies whole or not at all", async () => {
  const session = await openSession();
  const [one] = await session.objects.put([blob("one")]);
  await session.refs.update([{ name: "refs/heads/a", from: null, to: one ?? "" }], {
    reason: "seed",
  });

  const outcome = await session.refs.update(
    [
      { name: "refs/heads/b", from: null, to: one ?? "" },
      { name: "refs/heads/a", from: null, to: one ?? "" },
    ],
    { reason: "batch" },
  );
  assert.equal(outcome.ok, false);
  assert.equal(await session.refs.read("refs/heads/b"), null);
});

test("an update whose to equals from is a check that writes and logs nothing", async () => {
  const session = await openSession();
  const [one, two] = await session.objects.put([blob("one"), blob("two")]);
  await session.refs.update([{ name: "refs/heads/a", from: null, to: one ?? "" }], {
    reason: "seed",
  });
  const before = await session.events.last();

  const held = await session.refs.update(
    [
      { name: "refs/heads/a", from: one ?? "", to: one ?? "" },
      { name: "refs/deleted", from: null, to: null },
      { name: "refs/heads/b", from: null, to: two ?? "" },
    ],
    { reason: "publish" },
  );
  assert.equal(held.ok, true);
  assert.deepEqual(reflog(await session.events.read({ afterSeq: before })), [
    `refs/heads/b - > ${two} (publish)`,
  ]);

  const failed = await session.refs.update(
    [
      { name: "refs/heads/a", from: two ?? "", to: two ?? "" },
      { name: "refs/heads/b", from: two ?? "", to: null },
    ],
    { reason: "publish" },
  );
  assert.deepEqual(failed, { ok: false, reason: "conflict", name: "refs/heads/a", actual: one });
  assert.equal(await session.refs.read("refs/heads/b"), two);
});

test("refs list by prefix in name order", async () => {
  const session = await openSession();
  const [one] = await session.objects.put([blob("one")]);
  for (const name of ["refs/heads/z", "refs/heads/a", "refs/stacks/a"]) {
    await session.refs.update([{ name, from: null, to: one ?? "" }], { reason: "seed" });
  }
  assert.deepEqual(
    (await session.refs.list("refs/heads/")).map((ref) => ref.name),
    ["refs/heads/a", "refs/heads/z"],
  );
});

test("every ref move is a reflog line with its cause and actor, in write order", async () => {
  const session = await openSession();
  const [one, two] = await session.objects.put([blob("one"), blob("two")]);
  await session.refs.update(
    [
      { name: "refs/heads/a", from: null, to: one ?? "" },
      { name: "refs/heads/b", from: null, to: two ?? "" },
    ],
    {
      reason: "seed",
      actor: { userId: "u1" },
      events: [{ kind: "notice", level: "info", owner: "test", message: "hello" }],
    },
  );
  await session.refs.update([{ name: "refs/heads/a", from: one ?? "", to: two ?? "" }], {
    reason: "move",
  });

  const events = await session.events.read({ afterSeq: 0 });
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(reflog(events), [
    `refs/heads/a - > ${one} (seed)`,
    `refs/heads/b - > ${two} (seed)`,
    `refs/heads/a ${one} > ${two} (move)`,
  ]);
  const first = events[0];
  assert.ok(first?.kind === "ref" && first.actor?.userId === "u1");
  assert.equal(events[2]?.kind, "notice");
  assert.equal(await session.events.last(), 4);
  assert.deepEqual(
    (await session.events.read({ afterSeq: 2, limit: 1 })).map((event) => event.seq),
    [3],
  );
});

test("a trimmed stream refuses old cursors and never trims past its newest event", async () => {
  const session = await openSession();
  const [one, two] = await session.objects.put([blob("one"), blob("two")]);
  await session.refs.update([{ name: "refs/heads/a", from: null, to: one ?? "" }], {
    reason: "seed",
  });
  await session.refs.update([{ name: "refs/heads/a", from: one ?? "", to: two ?? "" }], {
    reason: "move",
  });
  assert.equal(await session.events.floor(), 0);

  await session.events.trim(1);
  assert.equal(await session.events.floor(), 1);
  await assert.rejects(session.events.read({ afterSeq: 0 }), CursorExpired);
  assert.deepEqual(
    (await session.events.read({ afterSeq: 1 })).map((event) => event.seq),
    [2],
  );

  await session.events.trim(1_000);
  assert.equal(await session.events.floor(), 2);
  await session.refs.update([{ name: "refs/heads/a", from: two ?? "", to: null }], {
    reason: "delete",
  });
  assert.equal((await session.events.read({ afterSeq: 2 })).length, 1);
});

test("a lease is exclusive until it expires, and a takeover outranks the old holder", async () => {
  const session = await openSession();
  const first = await lease(session, "main", 30_000);
  const busy = await session.leases.acquire("refs/heads/main", 30_000);
  assert.ok(!busy.ok && busy.holder.owner === first.owner);
  assert.equal(await session.leases.renew(first, 30_000), true);
  assert.equal(await session.leases.release(first), true);
  assert.equal(await session.leases.release(first), false);

  const short = await lease(session, "main", 1);
  await sleep(5);
  assert.equal(await session.leases.read("refs/heads/main"), undefined);
  const successor = granted(await session.leases.acquire("refs/heads/main", 30_000));
  assert.ok(successor.fence > short.fence);
  assert.equal(await session.leases.renew(short, 30_000), false);
  assert.equal(await session.leases.release(short), false);
  assert.equal((await session.leases.read("refs/heads/main"))?.owner, successor.owner);
});

test("a fenced-out holder can neither move a ref nor append an event", async () => {
  const session = await openSession();
  const [one] = await session.objects.put([blob("one")]);
  const old = await lease(session, "main", 1);
  await sleep(5);
  const successor = granted(await session.leases.acquire("refs/heads/main", 30_000));
  const before = await session.events.last();

  assert.deepEqual(
    await session.refs.update([{ name: "refs/heads/main", from: null, to: one ?? "" }], {
      reason: "respond",
      lease: old,
    }),
    { ok: false, reason: "fenced" },
  );
  assert.deepEqual(
    await session.events.append([{ kind: "notice", level: "info", owner: "old", message: "x" }], {
      lease: old,
    }),
    { ok: false, reason: "fenced" },
  );
  assert.equal(await session.refs.read("refs/heads/main"), null);
  assert.equal(await session.events.last(), before);

  const fresh = await session.refs.update(
    [{ name: "refs/heads/main", from: null, to: one ?? "" }],
    { reason: "respond", lease: successor },
  );
  assert.equal(fresh.ok, true);
});

test("a watcher replays from its cursor, then receives every later event once, in order", async () => {
  const path = storePath();
  const session = await openStore(path).create({ id: "w" });
  const peer = await openStore(path).open("w");
  const [one, two, three] = await session.objects.put([blob("1"), blob("2"), blob("3")]);
  await session.refs.update([{ name: "refs/heads/a", from: null, to: one ?? "" }], {
    reason: "seed",
  });

  const controller = new AbortController();
  const mine = session.events
    .watch({ afterSeq: 0, signal: controller.signal })
    [Symbol.asyncIterator]();
  const theirs = peer.events
    .watch({ afterSeq: 0, signal: controller.signal })
    [Symbol.asyncIterator]();
  const seen: Event[] = [];
  const peerSeen: Event[] = [];
  seen.push(await nextEvent(mine));
  peerSeen.push(await nextEvent(theirs));

  await session.refs.update([{ name: "refs/heads/a", from: one ?? "", to: two ?? "" }], {
    reason: "move",
  });
  await peer.refs.update([{ name: "refs/heads/a", from: two ?? "", to: three ?? "" }], {
    reason: "move",
  });
  for (let index = 0; index < 2; index++) {
    seen.push(await nextEvent(mine));
    peerSeen.push(await nextEvent(theirs));
  }
  assert.deepEqual(
    seen.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.deepEqual(reflog(seen), reflog(peerSeen));

  controller.abort();
  assert.deepEqual(await within(mine.next()), { value: undefined, done: true });

  await session.events.trim(2);
  await assert.rejects(
    (async () => {
      for await (const _event of session.events.watch({ afterSeq: 1 })) break;
    })(),
    CursorExpired,
  );
});

test("sessions are created, listed, reopened, and deleted with everything they own", async () => {
  const path = storePath();
  const store = openStore(path);
  const session = await store.create({ id: "one" });
  const [oid] = await session.objects.put([blob("x")]);
  await session.refs.update([{ name: "refs/heads/main", from: null, to: oid ?? "" }], {
    reason: "seed",
  });
  await session.leases.acquire("refs/heads/main", 30_000);
  assert.deepEqual(
    (await store.list()).map((info) => info.id),
    ["one"],
  );

  const again = await openStore(path).open("one");
  assert.equal(await again.refs.read("refs/heads/main"), oid);
  await assert.rejects(store.open("missing"), UnknownSession);

  await store.delete("one");
  await store.delete("one");
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.open("one"), UnknownSession);
  const reborn = await store.create({ id: "one" });
  assert.equal(await reborn.refs.read("refs/heads/main"), null);
  assert.equal(await reborn.events.last(), 0);
  assert.equal(await reborn.leases.read("refs/heads/main"), undefined);
  assert.equal(await reborn.objects.get(oid ?? ""), undefined);
});

test("one hundred concurrent compare-and-swap writers all land in one chain", async () => {
  const session = await openSession();
  const tipRef = "refs/queues/main/steer/tip";
  await Promise.all(
    Array.from({ length: 100 }, async (_, index) => {
      for (;;) {
        const tip = await session.refs.read(tipRef);
        const change: Change = {
          kind: "change",
          previous: tip,
          body: { kind: "note", type: "n", data: index },
          at: index,
        };
        const [oid] = await session.objects.put([change]);
        const outcome = await session.refs.update([{ name: tipRef, from: tip, to: oid ?? "" }], {
          reason: "submit",
        });
        if (outcome.ok) return;
      }
    }),
  );
  let length = 0;
  let cursor = await session.refs.read(tipRef);
  while (cursor !== null) {
    const object = await session.objects.get(cursor);
    if (object?.kind !== "change") assert.fail("chain must hold changes");
    length += 1;
    cursor = object.previous;
  }
  assert.equal(length, 100);
});

test("a store another schema wrote is refused with a message, never read", async () => {
  const path = storePath();
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    next_seq INTEGER NOT NULL
  ) WITHOUT ROWID`);
  legacy.close();
  assert.throws(() => new SqliteStore(path), /Delete it to start over/u);

  const written = storePath();
  await openStore(written).list();
  await openStore(written).list();
});

test("creates the store directory when it does not exist yet", async () => {
  const root = mkdtempSync(join(tmpdir(), "nyte-store-"));
  const path = join(root, "project", ".nyte", "sessions.db");
  try {
    const store = new SqliteStore(path);
    try {
      assert.ok(existsSync(path));
      const session = await store.create();
      await session.close();
    } finally {
      await store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two connections may create the same store at the same moment", async () => {
  const path = storePath();
  const [first, second] = await Promise.all([
    Promise.resolve().then(() => openStore(path)),
    Promise.resolve().then(() => openStore(path)),
  ]);
  await first.create({ id: "a" });
  await second.create({ id: "b" });
  assert.deepEqual((await first.list()).map((item) => item.id).toSorted(), ["a", "b"]);
});
