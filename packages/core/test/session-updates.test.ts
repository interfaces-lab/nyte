import { asId, asSeq } from "@nyte-ai/schema";
import type { SessionInfo, SessionsChange } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { readSessions } from "../src/api/session.ts";
import { sessionChanges } from "../src/api/session-changes.ts";
import { pollStore } from "../src/fold/watch.ts";
import { envelope, headRef, memoryStore, seenRef, sessionRef } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";
import { main, setup } from "../src/harness.ts";

it("keeps the revision and log for unchanged session updates, and publishes changed fields", async () => {
  const store = memoryStore();
  await using host = await open(fakeModels(), { store });
  const { session } = await host.sessions.start({ name: "SQLite review", content: "Hi." });
  const connection = await store.open();
  const before = await connection.refs.get(sessionRef(session.id));
  const tail = await connection.refs.tail(session.id);

  expect(await session.update({ name: "SQLite review", pinned: false, archived: false })).toEqual({
    kind: "updated",
  });
  expect(await session.update({})).toEqual({ kind: "updated" });
  expect(await connection.refs.get(sessionRef(session.id))).toEqual(before);
  expect(await connection.refs.tail(session.id)).toBe(tail);

  expect(await session.update({ name: null, pinned: true, archived: true })).toEqual({
    kind: "updated",
  });
  expect(await session.info()).toMatchObject({ name: null, pinned: true, archived: true });
  expect(await connection.refs.tail(session.id)).toBe(asSeq(tail + 1));
  expect((await connection.refs.get(sessionRef(session.id)))?.revision).not.toBe(before?.revision);
});

it("updates directory rows from another host while keeping unread state specific to each principal", async () => {
  const store = await memoryStore().open();
  const writer = await setup({ store });
  const reader = await setup({ store, poll: 5 });
  const unpoll = pollStore(reader.kernel);
  const { session } = await writer.host.sessions.start({ name: "Shared", content: "Hi." });
  const local = sessionChanges(reader.kernel, asId("local"))[Symbol.asyncIterator]();
  const other = sessionChanges(reader.kernel, asId("other"))[Symbol.asyncIterator]();
  const shared = (rows: readonly SessionInfo[]) => rows.filter((row) => row.id === session.id);

  try {
    await Promise.all([local.next(), other.next()]);
    expect((await readSessions(reader.kernel, asId("local"))).rows).toMatchObject([
      { name: "Shared", archived: false },
    ]);
    await session.update({ archived: true });
    expect(shared(await changed(local, (row) => row.archived))).toMatchObject([
      { name: "Shared", archived: true },
    ]);
    expect(shared(await changed(other, (row) => row.archived))).toMatchObject([{ archived: true }]);
    const root = await store.refs.get(sessionRef(session.id));
    const commit = await store.objects.put({ message: "A new tip" });
    await store.refs.set([{ name: headRef(session.id, main), target: commit }]);
    expect(shared(await changed(local, (row) => row.heads[0]?.unread === true))).toMatchObject([
      { heads: [{ unread: true }] },
    ]);
    expect(shared(await changed(other, (row) => row.heads[0]?.unread === true))).toMatchObject([
      { heads: [{ unread: true }] },
    ]);
    await store.refs.set([
      {
        name: seenRef(session.id, asId("local"), main),
        target: await store.objects.put(envelope("seen", { commit }, 1)),
      },
    ]);
    expect(shared(await changed(local, (row) => row.heads[0]?.unread === false))).toMatchObject([
      { heads: [{ unread: false }] },
    ]);
    expect(await store.refs.get(sessionRef(session.id))).toEqual(root);
    const { session: newSession } = await writer.host.sessions.start({
      name: "Second",
      content: "Hi.",
    });

    const added = await changed(other, (row) => row.id === newSession.id);

    expect(added.find((row) => row.id === newSession.id)?.name).toBe("Second");
    expect(
      (await readSessions(reader.kernel, asId("other"))).rows.find((row) => row.id === session.id)
        ?.heads[0]?.unread,
    ).toBe(true);
  } finally {
    unpoll();
    await local.return?.();
    await other.return?.();
  }
});

async function changed(
  feed: AsyncIterator<SessionsChange>,
  accept: (row: SessionInfo) => boolean,
): Promise<readonly SessionInfo[]> {
  for (;;) {
    const next = await feed.next();
    assert(!next.done);
    const rows = next.value.tables.sessions?.upsert ?? [];

    if (rows.some(accept)) return rows;
  }
}
