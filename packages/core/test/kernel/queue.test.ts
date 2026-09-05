/** The change stack: what is pending, in what order, and what lands next. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { queueBaseRef } from "../../src/kernel/names.ts";
import {
  cancel,
  listLanes,
  nextToLand,
  pending,
  pendingIn,
  redeliver,
  submit,
} from "../../src/kernel/queue.ts";
import type { PendingChange } from "../../src/kernel/queue.ts";
import { message, openSession, openStore, reflog, sleep, storePath, user } from "./helpers.ts";

const say = (text: string) => message(user(text));

function messageText(item: PendingChange | undefined): string {
  const body = item?.change.body;
  const content = body?.kind === "message" ? body.message.content : undefined;
  return content !== undefined && !Array.isArray(content) ? content : "";
}

test("a submission is pending until it lands, in the order it arrived", async () => {
  const session = await openSession();
  const first = await submit(session, { head: "main", lane: "now", body: say("one") });
  const second = await submit(session, { head: "main", lane: "now", body: say("two") });
  assert.equal(first.kind, "queued");
  const items = await pending(session, "main");
  assert.deepEqual(
    items.map((item) => [item.oid, item.lane, messageText(item)]),
    [
      [first.change, "now", "one"],
      [second.change, "now", "two"],
    ],
  );
  assert.equal((await nextToLand(session, { head: "main", lanes: ["now"] }))?.oid, first.change);
});

test("one hundred concurrent submitters lose nothing and keep one order", async () => {
  const session = await openSession();
  const outcomes = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      submit(session, { head: "main", lane: "now", body: say(String(index)) }),
    ),
  );
  const items = await pendingIn(session, { head: "main", lane: "now" });
  assert.equal(items.length, 100);
  assert.deepEqual(
    new Set(items.map((item) => item.oid)),
    new Set(outcomes.map((outcome) => outcome.change)),
  );
  for (let index = 1; index < items.length; index++) {
    assert.equal(items[index]?.change.previous, items[index - 1]?.oid);
  }
});

test("two connections submitting at once still form one chain", async () => {
  const path = storePath();
  const a = await openStore(path).create({ id: "q" });
  const b = await openStore(path).open("q");
  await Promise.all([
    ...Array.from({ length: 20 }, (_, i) =>
      submit(a, { head: "main", lane: "now", body: say(`a${i}`) }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      submit(b, { head: "main", lane: "now", body: say(`b${i}`) }),
    ),
  ]);
  assert.equal((await pending(a, "main")).length, 40);
});

test("a retried submission with the same key is the first one, not a second message", async () => {
  const session = await openSession();
  const first = await submit(session, { head: "main", lane: "now", body: say("hi"), key: "k1" });
  const before = await session.events.last();
  const retry = await submit(session, { head: "main", lane: "now", body: say("hi"), key: "k1" });
  assert.deepEqual(retry, { kind: "duplicate", change: first.change });
  assert.equal((await pending(session, "main")).length, 1);
  assert.equal(await session.events.last(), before);
});

test("lanes are independent chains, consulted in whatever order the caller names them", async () => {
  const session = await openSession();
  const later = await submit(session, { head: "main", body: say("after"), lane: "later" });
  await sleep(2);
  const now = await submit(session, { head: "main", lane: "now", body: say("now") });
  assert.deepEqual(
    (await pending(session, "main")).map((item) => [item.oid, item.lane]),
    [
      [later.change, "later"],
      [now.change, "now"],
    ],
  );
  const live = { head: "main", lanes: ["now"] as const };
  const idle = { head: "main", lanes: ["now", "later"] as const };
  assert.equal((await nextToLand(session, live))?.oid, now.change);
  assert.equal((await nextToLand(session, idle))?.oid, now.change);
  await cancel(session, { head: "main", change: now.change });
  assert.equal(await nextToLand(session, live), undefined);
  assert.equal((await nextToLand(session, idle))?.oid, later.change);
});

test("a cancelled change leaves the pending list and its neighbours keep their ids", async () => {
  const session = await openSession();
  const outcomes = await Promise.all([
    submit(session, { head: "main", lane: "now", body: say("a") }),
    submit(session, { head: "main", lane: "now", body: say("b") }),
    submit(session, { head: "main", lane: "now", body: say("c") }),
  ]);
  const before = (await pendingIn(session, { head: "main", lane: "now" })).map((i) => i.oid);
  const middle = before[1] ?? "";
  assert.deepEqual(await cancel(session, { head: "main", change: middle }), { kind: "cancelled" });
  assert.deepEqual(await cancel(session, { head: "main", change: middle }), { kind: "cancelled" });
  assert.deepEqual(
    (await pendingIn(session, { head: "main", lane: "now" })).map((item) => item.oid),
    before.filter((oid) => oid !== middle),
  );
  assert.equal((await pending(session, "main")).length, 2);
  assert.deepEqual(await cancel(session, { head: "main", change: "0".repeat(64) }), {
    kind: "not_found",
  });
  assert.equal(new Set(outcomes.map((outcome) => outcome.change)).size, 3);
});

test("landing skips cancelled changes, and a landed change can no longer be cancelled", async () => {
  const session = await openSession();
  const first = await submit(session, { head: "main", lane: "now", body: say("first") });
  const second = await submit(session, { head: "main", lane: "now", body: say("second") });
  await cancel(session, { head: "main", change: first.change });
  const next = await nextToLand(session, { head: "main", lanes: ["now"] });
  assert.equal(next?.oid, second.change);
  assert.deepEqual(next?.skipped, [first.change]);

  const landed = await session.refs.update(
    [{ name: queueBaseRef("main", "now"), from: null, to: second.change }],
    { reason: "land" },
  );
  assert.equal(landed.ok, true);
  assert.deepEqual(await pending(session, "main"), []);
  assert.deepEqual(await cancel(session, { head: "main", change: second.change }), {
    kind: "landed",
  });
  assert.deepEqual(
    await redeliver(session, { head: "main", change: second.change, lane: "later" }),
    { kind: "landed" },
  );
});

test("moving a change between lanes is one atomic update that keeps it pending", async () => {
  const session = await openSession();
  const parked = await submit(session, { head: "main", body: say("later"), lane: "later" });
  const before = await session.events.last();
  const moved = await redeliver(session, { head: "main", change: parked.change, lane: "now" });
  assert.equal(moved.kind, "redelivered");
  if (moved.kind !== "redelivered") return;
  const items = await pending(session, "main");
  assert.deepEqual(
    items.map((item) => [item.oid, item.lane]),
    [[moved.change, "now"]],
  );
  assert.equal(messageText(items[0]), "later");
  const lines = reflog(await session.events.read({ afterSeq: before }));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => line.endsWith("(redeliver)")));

  assert.deepEqual(await redeliver(session, { head: "main", change: moved.change, lane: "now" }), {
    kind: "unchanged",
  });
  assert.deepEqual(
    await redeliver(session, { head: "main", change: "0".repeat(64), lane: "now" }),
    { kind: "not_found" },
  );

  // A lane is a name: the first change moved into one the head never used creates it.
  const parkedAgain = await redeliver(session, {
    head: "main",
    change: moved.change,
    lane: "urgent",
  });
  assert.equal(parkedAgain.kind, "redelivered");
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["urgent"],
  );
  assert.deepEqual(await listLanes(session, "main"), ["later", "now", "urgent"]);
  await assert.rejects(submit(session, { head: "main", lane: "a/b", body: say("x") }), TypeError);
});
