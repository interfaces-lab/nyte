import { asId, asSeq } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { watchSessions } from "../src/api/session.ts";
import { pollStore } from "../src/fold/watch.ts";
import { envelope, headRef, memoryStore, seenRef, sessionRef } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";
import { main, setup } from "./harness.ts";

it("keeps the revision and log for unchanged session updates, and publishes changed fields", async () => {
  const store = memoryStore();
  await using host = await open(fakeModels(), { store });
  const session = await host.sessions.create({ name: "SQLite review" });
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
  const session = await writer.host.sessions.create({ name: "Shared" });
  const local = watchSessions(reader.kernel, asId("local"))[Symbol.asyncIterator]();
  const other = watchSessions(reader.kernel, asId("other"))[Symbol.asyncIterator]();

  try {
    expect((await local.next()).value).toMatchObject([{ name: "Shared", archived: false }]);
    expect((await other.next()).value).toMatchObject([{ name: "Shared", archived: false }]);
    const archived = local.next();
    await session.update({ archived: true });
    expect((await archived).value).toMatchObject([{ name: "Shared", archived: true }]);
    expect((await other.next()).value).toMatchObject([{ archived: true }]);
    const root = await store.refs.get(sessionRef(session.id));
    const commit = await store.objects.put({ message: "A new tip" });
    const unread = local.next();
    await store.refs.set([{ name: headRef(session.id, main), target: commit }]);
    expect((await unread).value).toMatchObject([{ heads: [{ unread: true }] }]);
    expect((await other.next()).value).toMatchObject([{ heads: [{ unread: true }] }]);
    const read = local.next();
    await store.refs.set([
      {
        name: seenRef(session.id, asId("local"), main),
        target: await store.objects.put(envelope("seen", { commit }, 1)),
      },
    ]);
    expect((await read).value).toMatchObject([{ heads: [{ unread: false }] }]);
    expect(await store.refs.get(sessionRef(session.id))).toEqual(root);
    const newSession = await writer.host.sessions.create({ name: "Second" });
    const changed = await other.next();
    assert(!changed.done);
    expect(changed.value.find((row) => row.id === session.id)?.heads[0]?.unread).toBe(true);
    expect(changed.value.find((row) => row.id === newSession.id)?.name).toBe("Second");
  } finally {
    unpoll();
    await local.return?.();
    await other.return?.();
  }
});
