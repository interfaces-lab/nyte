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
import { message, openSession, openStore, sleep, storePath, user } from "./helpers.ts";

const say = (text: string) => message(user(text));

test("invalid heads, string or not, cannot write objects, refs, or events, including receipt retries", async () => {
  const session = await openSession();
  const first = await submit(session, { head: "main", lane: "now", body: say("seed"), key: "k" });
  const state = async () => ({
    objects: await session.objects.list(),
    refs: await session.refs.list(""),
    cursor: await session.events.last(),
  });
  const before = await state();
  for (const head of ["a/b", "", ".hidden", "x.", "x..y", "x@{y", "@", "x.lock", "x y", "x\n"]) {
    for (const key of [undefined, "k"]) {
      await assert.rejects(
        submit(session, { head, lane: "now", body: say("bad"), key }),
        TypeError,
      );
    }
    await assert.rejects(
      redeliver(session, { head, lane: "later", change: first.change }),
      TypeError,
    );
    assert.deepEqual(await state(), before);
  }
  for (const head of [123, ["main"], { toString: () => "main" }]) {
    for (const key of [undefined, "k"]) {
      await assert.rejects(
        // @ts-expect-error Exercise invalid JavaScript input at the admission boundary.
        submit(session, { head, lane: "now", body: say("bad"), key }),
        TypeError,
      );
    }
    assert.deepEqual(await state(), before);
  }
});

test.each(["日本語", "é+😀", "a!#$%&'()+,;=]{}", "a\u2028.b", "a.\u2029"])(
  "unusual valid head %s remains discoverable",
  async (head) => {
    const session = await openSession();
    const sent = await submit(session, { head, lane: "now", body: say("hello") });
    assert.deepEqual(await listLanes(session, head), ["now"]);
    assert.deepEqual(
      (await pending(session, head)).map((item) => item.oid),
      [sent.change],
    );
  },
);

function messageText(item: PendingChange | undefined): string {
  const body = item?.change.body;
  const content = body?.kind === "message" ? body.message.content : undefined;
  return content !== undefined && !Array.isArray(content) ? content : "";
}

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

test("a change carries its submission key, and a redelivered copy keeps it under a new id", async () => {
  const session = await openSession();
  const keyed = await submit(session, { head: "main", lane: "now", body: say("hi"), key: "k1" });
  const bare = await submit(session, { head: "main", lane: "now", body: say("hi") });
  const keyOf = async (change: string) =>
    (await pending(session, "main")).find((item) => item.oid === change)?.change.key;
  assert.equal(await keyOf(keyed.change), "k1");
  assert.equal(await keyOf(bare.change), undefined);

  const moved = await redeliver(session, { head: "main", change: keyed.change, lane: "later" });
  assert.equal(moved.kind, "redelivered");
  if (moved.kind !== "redelivered") return;
  assert.notEqual(moved.change, keyed.change);
  const items = await pending(session, "main");
  const byLane = (lane: string) =>
    items.filter((item) => item.lane === lane).map((item) => [item.oid, item.change.key]);
  assert.deepEqual(byLane("later"), [[moved.change, "k1"]]);
  assert.deepEqual(byLane("now"), [[bare.change, undefined]]);
  assert.equal(items.length, 2);
  // The receipt ref still answers the key with the original submission.
  assert.deepEqual(
    await submit(session, { head: "main", lane: "now", body: say("hi"), key: "k1" }),
    { kind: "duplicate", change: keyed.change },
  );
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
  const cursor = await session.events.last();
  assert.deepEqual(await cancel(session, { head: "main", change: second.change }), {
    kind: "landed",
  });
  assert.deepEqual(
    await redeliver(session, { head: "main", change: second.change, lane: "later" }),
    { kind: "landed" },
  );
  assert.deepEqual(
    await redeliver(session, {
      head: "main",
      lane: "now",
      change: second.change,
      content: "too late",
    }),
    { kind: "landed" },
  );
  assert.deepEqual(await pending(session, "main"), []);
  assert.equal(await session.events.last(), cursor);
});

test("moving a change between lanes is one atomic update that keeps it pending", async () => {
  const session = await openSession();
  const parked = await submit(session, { head: "main", body: say("later"), lane: "later" });
  const moved = await redeliver(session, { head: "main", change: parked.change, lane: "now" });
  assert.equal(moved.kind, "redelivered");
  if (moved.kind !== "redelivered") return;
  const items = await pending(session, "main");
  assert.deepEqual(
    items.map((item) => [item.oid, item.lane]),
    [[moved.change, "now"]],
  );
  assert.equal(messageText(items[0]), "later");

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

test("editing a queued message preserves its position and the untouched prefix", async () => {
  const path = storePath();
  const session = await openStore(path).create({ id: "edit" });
  const observer = await openStore(path).open("edit");
  const first = await submit(session, { head: "main", lane: "later", body: say("first") });
  const middle = await submit(session, { head: "main", lane: "later", body: say("middle") });
  await submit(session, { head: "main", lane: "later", body: say("last") });
  const outcome = await redeliver(session, {
    head: "main",
    lane: "later",
    change: middle.change,
    content: "edited middle",
  });
  assert.equal(outcome.kind, "redelivered");
  const items = await pending(observer, "main");
  assert.deepEqual(items.map(messageText), ["first", "edited middle", "last"]);
  assert.equal(items[0]?.oid, first.change);
  assert.equal((await nextToLand(observer, { head: "main", lanes: ["later"] }))?.oid, first.change);
  await cancel(observer, { head: "main", change: first.change });
  assert.equal(
    messageText(await nextToLand(observer, { head: "main", lanes: ["later"] })),
    "edited middle",
  );
});

test("reordering uses queue order even when the moved message is newer", async () => {
  const session = await openSession();
  const first = await submit(session, { head: "main", lane: "later", body: say("first") });
  await submit(session, { head: "main", lane: "later", body: say("second") });
  const last = await submit(session, { head: "main", lane: "later", body: say("last") });
  const moved = await redeliver(session, {
    head: "main",
    lane: "later",
    change: last.change,
    before: first.change,
  });
  assert.equal(moved.kind, "redelivered");
  assert.deepEqual((await pending(session, "main")).map(messageText), ["last", "first", "second"]);
  assert.equal(messageText(await nextToLand(session, { head: "main", lanes: ["later"] })), "last");
  if (moved.kind !== "redelivered") assert.fail("Expected redelivery");
  await redeliver(session, { head: "main", lane: "later", change: moved.change, before: null });
  assert.deepEqual((await pending(session, "main")).map(messageText), ["first", "second", "last"]);
});

test("an edit racing cancellation cannot restore the cancelled original or duplicate it", async () => {
  const path = storePath();
  const session = await openStore(path).create({ id: "race" });
  const observer = await openStore(path).open("race");
  const submitted = await submit(session, { head: "main", lane: "later", body: say("original") });
  const [edited] = await Promise.all([
    redeliver(session, {
      head: "main",
      lane: "later",
      change: submitted.change,
      content: "edited",
    }),
    cancel(observer, { head: "main", change: submitted.change }),
  ]);
  const contents = (await pending(observer, "main")).map(messageText);
  assert.deepEqual(contents, edited.kind === "redelivered" ? ["edited"] : []);
});
