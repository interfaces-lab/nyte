import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Change } from "../../src/kernel/model.ts";
import { headRef } from "../../src/kernel/names.ts";
import { moveHead } from "../../src/kernel/stacks.ts";
import type { Session } from "../../src/kernel/store.ts";
import {
  driveToIdle,
  gateRefUpdate,
  openAcceptanceNyte,
  scripted,
  transcriptUsers,
} from "./acceptance-helpers.ts";
import { assistant, openStore, sleep, storePath, within } from "./helpers.ts";

async function readChange(session: Session, oid: string): Promise<Change> {
  const object = await session.objects.get(oid);
  assert.ok(object !== undefined && "type" in object && object.type === "change");
  return object;
}

test("100 concurrent submitters form one chain per delivery with no lost change", async () => {
  const store = openStore();
  const nyte = await openAcceptanceNyte(
    store,
    scripted(() => assistant("all received")),
  );
  try {
    const { sessionId } = await nyte.sessions.create();
    const receipts = await Promise.all(
      Array.from({ length: 100 }, (_, index) => {
        const delivery = index % 2 === 0 ? "steer" : "next";
        return nyte.messages.send({ sessionId, delivery, content: `${delivery}-${String(index)}` });
      }),
    );
    const pending = await nyte.messages.pending({ sessionId });
    assert.equal(pending.length, 100);
    assert.equal(new Set(pending.map((item) => item.change)).size, 100);
    assert.deepEqual(
      new Set(pending.map((item) => item.change)),
      new Set(receipts.map((receipt) => receipt.change)),
    );

    const session = await store.open(sessionId);
    for (const delivery of ["steer", "next"] as const) {
      const items = pending.filter((item) => item.delivery === delivery);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        assert.ok(item);
        const change = await readChange(session, item.change);
        assert.equal(change.previous, items[index - 1]?.change ?? null);
      }
    }

    const expected = new Map(
      ["steer", "next"].map((delivery) => [
        delivery,
        pending.filter((item) => item.delivery === delivery).map((item) => item.content),
      ]),
    );
    await driveToIdle(nyte, sessionId);
    assert.deepEqual(await nyte.messages.pending({ sessionId }), []);
    const users = await transcriptUsers(nyte, sessionId);
    assert.equal(users.length, 100);
    for (const delivery of ["steer", "next"] as const) {
      assert.deepEqual(
        users.filter((content) => content.startsWith(`${delivery}-`)),
        expected.get(delivery),
      );
    }
  } finally {
    await nyte.close();
  }
}, 15_000);

test("A submit during a streaming response is still pending after that publish", async () => {
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let requests = 0;
  const nyte = await openAcceptanceNyte(
    openStore(),
    scripted(async () => {
      requests += 1;
      if (requests === 1) {
        started.resolve();
        await released.promise;
      }
      return assistant(`answer ${String(requests)}`);
    }),
  );
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "first" });
    assert.deepEqual(await nyte.advance({ sessionId }), { kind: "continue" });
    const publishing = nyte.advance({ sessionId });
    await within(started.promise);
    const during = await nyte.messages.send({ sessionId, delivery: "steer", content: "during" });
    released.resolve();
    assert.deepEqual(await within(publishing), { kind: "finished" });
    assert.deepEqual(
      (await nyte.messages.pending({ sessionId })).map((item) => item.change),
      [during.change],
    );
    assert.deepEqual(await nyte.advance({ sessionId }), { kind: "continue" });
    assert.deepEqual(await nyte.messages.pending({ sessionId }), []);
    assert.deepEqual(await transcriptUsers(nyte, sessionId), ["first", "during"]);
  } finally {
    released.resolve();
    await nyte.close();
  }
});

test("A head move during a run makes the run's publish fail; the run ends, the head stays where the participant put it, and the queue is untouched", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const store = openStore(path);
  const nyte = await openAcceptanceNyte(
    store,
    scripted(async () => {
      started.resolve();
      await released.promise;
      return assistant("must stay loose");
    }),
  );
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "first" });
    await nyte.advance({ sessionId });
    const publishing = nyte.advance({ sessionId });
    await within(started.promise);
    await nyte.messages.send({ sessionId, content: "queued" });
    const pending = await nyte.messages.pending({ sessionId });
    const participant = await openStore(path).open(sessionId);
    const tipBeforeMove = (await nyte.heads.list({ sessionId }))[0]?.tip ?? null;
    assert.deepEqual(await moveHead(participant, { head: "main", to: null }), {
      kind: "moved",
      from: tipBeforeMove,
    });
    released.resolve();
    assert.deepEqual(await within(publishing), { kind: "finished" });
    assert.equal((await nyte.runs.current({ sessionId }))?.phase.kind, "aborted");
    assert.equal((await nyte.heads.list({ sessionId }))[0]?.tip, null);
    assert.deepEqual(await nyte.messages.pending({ sessionId }), pending);
    assert.deepEqual(await nyte.messages.list({ sessionId }), []);
  } finally {
    released.resolve();
    await nyte.close();
  }
});

test("A lease takeover fences every event and ref write from the former runner", async () => {
  const path = storePath();
  const firstStore = openStore(path);
  const secondStore = openStore(path);
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const firstStream = () => {
    const stream = createAssistantMessageEventStream();
    started.resolve();
    void released.promise.then(() => {
      const message = assistant("former runner");
      stream.push({ type: "start", partial: { ...message, content: [] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "former", partial: message });
      stream.push({ type: "done", reason: "stop", message });
    });
    return stream;
  };
  const first = await openAcceptanceNyte(firstStore, firstStream);
  const second = await openAcceptanceNyte(
    secondStore,
    scripted(() => assistant("successor runner")),
  );
  try {
    const { sessionId } = await first.sessions.create();
    await first.messages.send({ sessionId, content: "run" });
    await first.advance({ sessionId });
    const former = first.advance({ sessionId });
    await within(started.promise);

    const observer = await openStore(path).open(sessionId);
    const held = await observer.leases.read(headRef("main"));
    assert.ok(held);
    assert.equal(await observer.leases.renew(held, 1), true);
    await sleep(5);
    assert.equal(await observer.leases.read(headRef("main")), undefined);
    assert.deepEqual(await second.advance({ sessionId }), { kind: "finished" });
    const refs = await observer.refs.list("");
    const cursor = await observer.events.last();
    const transcript = await second.messages.list({ sessionId });

    released.resolve();
    assert.deepEqual(await within(former), { kind: "fenced" });
    assert.deepEqual(await observer.refs.list(""), refs);
    assert.equal(await observer.events.last(), cursor);
    assert.deepEqual(await second.messages.list({ sessionId }), transcript);
    assert.equal(
      transcript.some(
        (turn) =>
          turn.kind === "turn" &&
          turn.parts.some((part) => part.kind === "assistant" && part.text === "former runner"),
      ),
      false,
    );
  } finally {
    released.resolve();
    await first.close();
    await second.close();
  }
});

async function cancelDrainRace(gatedOperation: "cancel" | "land"): Promise<void> {
  const gate = gateRefUpdate(openStore());
  const nyte = await openAcceptanceNyte(gate.store);
  try {
    const { sessionId } = await nyte.sessions.create();
    const sent = await nyte.messages.send({ sessionId, content: gatedOperation });
    const barrier = gate.arm();
    let cancellation: Awaited<ReturnType<typeof nyte.messages.cancel>>;
    if (gatedOperation === "land") {
      const drain = nyte.advance({ sessionId });
      await within(barrier.entered);
      cancellation = await nyte.messages.cancel({ sessionId, change: sent.change });
      barrier.release();
      await drain;
    } else {
      const cancelling = nyte.messages.cancel({ sessionId, change: sent.change });
      await within(barrier.entered);
      await nyte.advance({ sessionId });
      barrier.release();
      cancellation = await cancelling;
    }
    const landed = (await transcriptUsers(nyte, sessionId)).includes(gatedOperation);
    const cancelled = cancellation.kind === "cancelled";
    assert.notEqual(cancelled, landed);
    assert.equal(cancelled || landed, true);
    assert.deepEqual(await nyte.messages.pending({ sessionId }), []);
  } finally {
    await nyte.close();
  }
}

test("A cancel racing a drain ends cancelled or landed, never both", async () => {
  await cancelDrainRace("land");
  await cancelDrainRace("cancel");
});
