import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { CursorExpired } from "@nyte-ai/protocol";
import { type Event, type EventBody } from "../../src/kernel/model.ts";
import { nextEvent, openSession, openStore, sleep, storePath, within } from "./helpers.ts";

function notices(first: number, count: number): EventBody[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "notice",
    level: "info",
    owner: "replay",
    message: String(first + index),
  }));
}

async function collect(iterator: AsyncIterator<Event>, count: number): Promise<Event[]> {
  const events: Event[] = [];
  for (let index = 0; index < count; index++) events.push(await nextEvent(iterator));
  return events;
}

// Backlogs that end on, just past, and well beyond a replay page.
for (const count of [256, 257, 513]) {
  test(`replays ${count} existing events from any cursor without another write`, async () => {
    const session = await openSession();
    await session.events.append(notices(1, count));
    for (const afterSeq of [0, 255, 256, 512].filter((cursor) => cursor <= count)) {
      const controller = new AbortController();
      const iterator = session.events
        .watch({ afterSeq, signal: controller.signal })
        [Symbol.asyncIterator]();
      try {
        const events = await collect(iterator, count - afterSeq);
        assert.deepEqual(
          events.map((event) => event.seq),
          Array.from({ length: count - afterSeq }, (_, index) => afterSeq + index + 1),
        );
        assert.deepEqual(
          events.map(({ seq: _seq, at: _at, ...body }) => body),
          notices(afterSeq + 1, count - afterSeq),
        );
        const pending = iterator.next();
        await sleep(0);
        controller.abort();
        assert.deepEqual(await within(pending), { done: true, value: undefined });
      } finally {
        controller.abort();
      }
    }
  });
}

for (const connection of ["local", "peer"]) {
  test(`${connection} appends reach a slow consumer during replay and after it becomes idle`, async () => {
    const path = storePath();
    const store = openStore(path);
    const session = await store.create({ id: "replay" });
    const writer = connection === "local" ? session : await openStore(path).open(session.id);
    await session.events.append(notices(1, 513));
    const controller = new AbortController();
    const iterator = session.events
      .watch({ afterSeq: 0, signal: controller.signal })
      [Symbol.asyncIterator]();
    try {
      const seen: Event[] = [];
      let newest = 513;
      for (let received = 1; received <= 513; received++) {
        seen.push(await nextEvent(iterator));
        if ([1, 255, 256, 257, 512, 513].includes(received)) {
          // The consumer requests nothing while the writer commits more events.
          await sleep(10);
          newest += 1;
          await writer.events.append(notices(newest, 1));
        }
      }
      seen.push(...(await collect(iterator, newest - seen.length)));
      assert.deepEqual(seen, await session.events.read({ afterSeq: 0 }));

      // Let the pending next reach its empty read before the external write.
      const pending = iterator.next();
      await sleep(0);
      await writer.events.append(notices(newest + 1, 1));
      const result = await within(pending);
      assert.equal(result.done, false);
      assert.deepEqual(result.value, (await session.events.read({ afterSeq: newest }))[0]);
      controller.abort();
      assert.deepEqual(await within(iterator.next()), { done: true, value: undefined });
    } finally {
      controller.abort();
    }
  });
}

test("read honors its limit and refuses one that is not a whole number", async () => {
  const session = await openSession();
  await session.events.append(notices(1, 600));
  for (const limit of [undefined, 0, 3, 256, 300, 1_000]) {
    const events = await session.events.read({ afterSeq: 1, limit });
    assert.deepEqual(
      events.map((event) => event.seq),
      Array.from({ length: Math.min(limit ?? 599, 599) }, (_, index) => index + 2),
    );
  }
  for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(session.events.read({ afterSeq: 0, limit }), RangeError);
  }
});

test("an already aborted watch does not replay its backlog", async () => {
  const session = await openSession();
  await session.events.append(notices(1, 513));
  const controller = new AbortController();
  controller.abort();
  const iterator = session.events
    .watch({ afterSeq: 0, signal: controller.signal })
    [Symbol.asyncIterator]();
  assert.deepEqual(await within(iterator.next()), { done: true, value: undefined });
});

for (const stop of ["abort", "session close", "store close"]) {
  for (const phase of ["reading", "buffered", "idle"]) {
    test(`${stop} ends ${phase} replay and pending next calls`, async () => {
      const store = openStore();
      const session = await store.create();
      await session.events.append(notices(1, 513));
      const controller = new AbortController();
      const iterator = session.events
        .watch({ afterSeq: 0, signal: controller.signal })
        [Symbol.asyncIterator]();
      try {
        if (phase === "buffered") assert.equal((await nextEvent(iterator)).seq, 1);
        if (phase === "idle") await collect(iterator, 513);
        // For "reading", stop before the first query's await resumes. For
        // "buffered", stop while the generator is suspended at its first yield.
        const pending = phase === "buffered" ? undefined : iterator.next();
        if (phase === "idle") await sleep(0);
        if (stop === "abort") controller.abort();
        if (stop === "session close") await session.close();
        if (stop === "store close") await store.close();
        assert.deepEqual(await within(pending ?? iterator.next()), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(await within(iterator.next()), { done: true, value: undefined });
      } finally {
        controller.abort();
      }
    });
  }
}

test("returning from buffered replay ends that iterator and allows a fresh watch", async () => {
  const session = await openSession();
  await session.events.append(notices(1, 513));
  const iterator = session.events.watch({ afterSeq: 0 })[Symbol.asyncIterator]();
  assert.equal((await nextEvent(iterator)).seq, 1);
  assert.ok(iterator.return !== undefined);
  assert.deepEqual(await within(iterator.return()), { done: true, value: undefined });
  await session.events.append(notices(514, 1));
  assert.deepEqual(await within(iterator.next()), { done: true, value: undefined });
  const fresh = session.events.watch({ afterSeq: 512 })[Symbol.asyncIterator]();
  assert.deepEqual(await collect(fresh, 2), await session.events.read({ afterSeq: 512 }));
  assert.ok(fresh.return !== undefined);
  await within(fresh.return());
});

test("a slow replay expires when trimming overtakes its unread backlog", async () => {
  const session = await openSession();
  await session.events.append(notices(1, 1_024));
  const controller = new AbortController();
  const iterator = session.events
    .watch({ afterSeq: 0, signal: controller.signal })
    [Symbol.asyncIterator]();
  try {
    assert.equal((await nextEvent(iterator)).seq, 1);
    await session.events.trim(1_023);
    await assert.rejects(
      within(
        (async () => {
          while (!(await iterator.next()).done) {
            // Already buffered events may finish before the next read checks the floor.
          }
        })(),
      ),
      CursorExpired,
    );
    const resumed = session.events.watch({ afterSeq: 1_023 })[Symbol.asyncIterator]();
    assert.equal((await nextEvent(resumed)).seq, 1_024);
    assert.ok(resumed.return !== undefined);
    await within(resumed.return());
  } finally {
    controller.abort();
  }
});

test("replay rejects a malformed event beyond the first page", async () => {
  const path = storePath();
  const session = await openStore(path).create();
  await session.events.append(notices(1, 513));
  const db = new DatabaseSync(path);
  try {
    db.prepare("UPDATE events SET body = ? WHERE session_id = ? AND seq = ?").run(
      JSON.stringify({ kind: "notice", message: 42 }),
      session.id,
      513,
    );
    const controller = new AbortController();
    try {
      await assert.rejects(
        within(
          (async () => {
            for await (const _event of session.events.watch({
              afterSeq: 0,
              signal: controller.signal,
            })) {
              // Validation must still run when replay advances to later stored rows.
            }
          })(),
        ),
        /not a known event body/,
      );
    } finally {
      controller.abort();
    }
  } finally {
    db.close();
  }
});
