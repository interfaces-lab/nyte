import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionEvent } from "@nyte-ai/protocol";
import { collect } from "../../src/kernel/gc.ts";
import { moveHead } from "../../src/kernel/stacks.ts";
import { driveToIdle, gateRefUpdate, openAcceptanceNyte, scripted } from "./acceptance-helpers.ts";
import { assistant, openStore, storePath, within } from "./helpers.ts";

async function eventsThroughSync(
  events: AsyncIterable<SessionEvent>,
): Promise<readonly SessionEvent[]> {
  const seen: SessionEvent[] = [];
  for await (const event of events) {
    seen.push(event);
    if (event.kind === "synced") return seen;
  }
  assert.fail("watch ended before synced");
}

test("A branch is stale exactly when its stack base differs from its parent's tip", async () => {
  const nyte = await openAcceptanceNyte(openStore());
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "base" });
    await driveToIdle(nyte, sessionId);
    assert.equal(
      (
        await nyte.heads.create({
          sessionId,
          head: "review",
          from: { head: "main" },
        })
      ).kind,
      "created",
    );
    let review = (await nyte.heads.list({ sessionId })).find((head) => head.head === "review");
    assert.equal(review?.stack?.stale, false);
    const base = review?.stack?.base;
    assert.ok(base);

    await nyte.messages.send({ sessionId, head: "review", content: "child work" });
    await driveToIdle(nyte, sessionId, "review");
    const childTip = (await nyte.heads.list({ sessionId })).find(
      (head) => head.head === "review",
    )?.tip;
    assert.ok(childTip);

    await nyte.messages.send({ sessionId, content: "parent moved" });
    await driveToIdle(nyte, sessionId);
    review = (await nyte.heads.list({ sessionId })).find((head) => head.head === "review");
    assert.equal(review?.stack?.stale, true);
    assert.notEqual(review?.stack?.base, (await nyte.heads.list({ sessionId }))[0]?.tip);

    assert.equal((await nyte.heads.move({ sessionId, to: base })).kind, "moved");
    assert.deepEqual(await nyte.heads.merge({ sessionId, head: "review" }), {
      kind: "merged",
      tip: childTip,
    });
    review = (await nyte.heads.list({ sessionId })).find((head) => head.head === "review");
    assert.equal(review?.stack?.stale, false);
    assert.equal(review?.stack?.base, childTip);
  } finally {
    await nyte.close();
  }
});

test("A fast-forward merge is one atomic update", async () => {
  const baseStore = openStore();
  const gate = gateRefUpdate(baseStore);
  const nyte = await openAcceptanceNyte(gate.store);
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "base" });
    await driveToIdle(nyte, sessionId);
    await nyte.heads.create({ sessionId, head: "review", from: { head: "main" } });
    await nyte.messages.send({ sessionId, head: "review", content: "child" });
    await driveToIdle(nyte, sessionId, "review");
    const childTip = (await nyte.heads.list({ sessionId })).find(
      (head) => head.head === "review",
    )?.tip;
    assert.ok(childTip);
    const observer = await baseStore.open(sessionId);
    const before = await observer.events.last();

    const barrier = gate.arm();
    try {
      const merging = nyte.heads.merge({ sessionId, head: "review" });
      await within(barrier.entered);
      const concurrent = await nyte.messages.send({ sessionId, content: "during merge" });
      barrier.release();
      assert.deepEqual(await merging, { kind: "merged", tip: childTip });
      assert.deepEqual(
        (await nyte.messages.pending({ sessionId })).map((item) => item.change),
        [concurrent.change],
      );

      const events = await eventsThroughSync(nyte.watch({ sessionId, afterSeq: before }));
      const moves = events.filter((event) => event.kind === "head_moved" && event.head === "main");
      assert.equal(moves.length, 1);
      assert.equal(moves[0]?.kind === "head_moved" ? moves[0].to : undefined, childTip);
      assert.equal(
        (await nyte.heads.list({ sessionId })).find((head) => head.head === "main")?.tip,
        childTip,
      );
    } finally {
      barrier.release();
    }
  } finally {
    await nyte.close();
  }
});

test("Loose objects from a failed publish survive the grace period, then go", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const store = openStore(path);
  const nyte = await openAcceptanceNyte(
    store,
    scripted(async () => {
      started.resolve();
      await released.promise;
      return assistant("orphaned answer");
    }),
  );
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "conflict" });
    await nyte.advance({ sessionId });
    const publishing = nyte.advance({ sessionId });
    await within(started.promise);
    const participant = await openStore(path).open(sessionId);
    assert.equal((await moveHead(participant, { head: "main", to: null })).kind, "moved");
    const commitsBeforePublish = new Set(
      (await participant.objects.commits()).map((item) => item.oid),
    );
    released.resolve();
    await within(publishing);

    const looseCommits = (await participant.objects.commits()).filter(
      (item) => !commitsBeforePublish.has(item.oid),
    );
    assert.equal(looseCommits.length, 1);
    const loose = looseCommits[0];
    assert.ok(loose);
    const stored = (await participant.objects.list()).find((item) => item.oid === loose.oid);
    assert.ok(stored);
    const graceMs = 60_000;
    await collect(participant, { graceMs, now: stored.at + graceMs });
    assert.ok(await participant.objects.get(loose.oid));
    await collect(participant, { graceMs, now: stored.at + graceMs + 1 });
    assert.equal(await participant.objects.get(loose.oid), undefined);
  } finally {
    released.resolve();
    await nyte.close();
  }
});
