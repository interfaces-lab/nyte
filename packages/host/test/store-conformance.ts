import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { objectId } from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";

const session: SessionId = asId("s1");

const other: SessionId = asId("s2");

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const moved: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "moved" };

const removed: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "removed" };

/** Registers the store conformance suite under `name`, each case against a fresh store from `open` (closed after): core's memory-store cases (ids shared with `objectId` whatever the key order, null for an unknown object or blob, a revision per entry, `absent` and revision mismatches answering `stale` with nothing written, deletion by a null target, prefix listing in name order, the log's per-session seq in entry order with `after` and `limit`, blobs round-tripped under their content hash), comparing objects by value rather than identity; repeated names in one batch (every `expect` checked against the refs before the batch, the last entry winning, a revision per entry, every event logged); and two concurrent sets under one `expect`, exactly one of them `set`. */
export function storeConformance(name: string, open: () => Promise<Store>): void {
  describe(name, () => {
    const stores: Store[] = [];

    const connect = async (): Promise<StoreConnection> => {
      const store = await open();
      stores.push(store);

      return store.open();
    };

    afterEach(async () => {
      for (const store of stores.splice(0)) await store.close();
    });

    it("puts an object once per content, whatever its key order", async () => {
      const { objects } = await connect();
      const value = { b: [1, { d: true, c: "x" }], a: null };
      const id = await objects.put(value);

      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(await objects.put({ a: null, b: [1, { c: "x", d: true }] })).toBe(id);
      expect(await objects.get(id)).toEqual(value);
      expect(await objects.put({ a: null, b: [{ c: "x", d: true }, 1] })).not.toBe(id);
    });

    it("puts an object under its shared content id", async () => {
      const { objects } = await connect();
      const value = { b: [1, { d: true, c: "x" }], a: null };

      expect(await objects.put(value)).toBe(await objectId(value));
    });

    it("returns null for an unknown object or blob", async () => {
      const { objects } = await connect();

      expect(await objects.get(asId("missing"))).toBeNull();
      expect(await objects.blob(asId("missing"))).toBeNull();
    });

    it("applies a batch and returns a revision per entry", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({ n: 1 });

      const outcome = await refs.set([
        { name: "sessions/s1/heads/main", target },
        { name: "sessions/s1/inbox/main", target },
      ]);

      assert(outcome.kind === "set");

      expect(outcome.seq).toBe(0);
      expect(outcome.revisions).toHaveLength(2);
      expect(outcome.revisions[0]).not.toBe(outcome.revisions[1]);
      expect(await refs.get("sessions/s1/heads/main")).toEqual({
        name: "sessions/s1/heads/main",
        target,
        revision: outcome.revisions[0],
      });
      expect(await refs.get("sessions/s1/inbox/main")).toEqual({
        name: "sessions/s1/inbox/main",
        target,
        revision: outcome.revisions[1],
      });
    });

    it("answers stale when an absent expect meets an existing ref", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put("value");
      const first = await refs.set([{ name: "kv/host/core/key", target, expect: "absent" }]);
      assert(first.kind === "set");

      expect(await refs.set([{ name: "kv/host/core/key", target, expect: "absent" }])).toEqual({
        kind: "stale",
        name: "kv/host/core/key",
        revision: first.revisions[0],
      });
    });

    it("answers stale on a revision mismatch and writes nothing when a later entry fails", async () => {
      const { objects, refs } = await connect();
      const before = await objects.put("before");
      const after = await objects.put("after");

      const first = await refs.set([
        { name: "sessions/s1/heads/main", target: before },
        { name: "sessions/s1/runs/r1", target: before },
      ]);

      assert(first.kind === "set");
      const [head, run] = first.revisions;

      const outcome = await refs.set([
        { name: "sessions/s1/heads/main", target: after, expect: head, event: moved },
        { name: "sessions/s1/runs/r1", target: null, expect: head },
      ]);

      expect(outcome).toEqual({ kind: "stale", name: "sessions/s1/runs/r1", revision: run });
      expect(await refs.get("sessions/s1/heads/main")).toEqual({
        name: "sessions/s1/heads/main",
        target: before,
        revision: head,
      });
      expect(await refs.get("sessions/s1/runs/r1")).toEqual({
        name: "sessions/s1/runs/r1",
        target: before,
        revision: run,
      });
      expect(await refs.tail(session)).toBe(0);
    });

    it("deletes a ref when the target is null", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put(1);
      await refs.set([
        { name: "sessions/s1/parts/b", target },
        { name: "sessions/s1/parts/a", target },
        { name: "sessions/s2/parts/c", target },
      ]);

      expect((await refs.list("sessions/s1/parts/")).map((ref) => ref.name)).toEqual([
        "sessions/s1/parts/a",
        "sessions/s1/parts/b",
      ]);

      await refs.set([{ name: "sessions/s1/parts/a", target: null }]);

      expect(await refs.get("sessions/s1/parts/a")).toBeNull();
      expect((await refs.list("sessions/s1/parts/")).map((ref) => ref.name)).toEqual([
        "sessions/s1/parts/b",
      ]);
    });

    it("lists by prefix as a range: everything for the empty prefix, nothing past it", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put(2);
      await refs.set([
        { name: "kv/a", target },
        { name: "kv/a/b", target },
        { name: "kv/a0", target },
        { name: "kv/b", target },
        { name: "kv", target },
      ]);

      expect((await refs.list("kv/a")).map((ref) => ref.name)).toEqual(["kv/a", "kv/a/b", "kv/a0"]);
      expect((await refs.list("")).map((ref) => ref.name)).toEqual([
        "kv",
        "kv/a",
        "kv/a/b",
        "kv/a0",
        "kv/b",
      ]);
      expect(await refs.list("kv/c")).toEqual([]);
    });

    it("logs events in entry order with a seq per session", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({});

      const first = await refs.set([
        { name: "sessions/s1/heads/main", target, event: created },
        { name: "sessions/s1/inbox/main", target },
        { name: "sessions/s2/heads/main", target, event: created },
        { name: "sessions/s1/runs/r1", target, event: moved },
      ]);

      const second = await refs.set([
        { name: "sessions/s1/heads/main", target: null, event: removed },
      ]);

      expect(first).toMatchObject({ kind: "set", seq: 2 });
      expect(second).toMatchObject({ kind: "set", seq: 3 });
      expect(await refs.log(session, asSeq(0), 10)).toMatchObject([
        { seq: 1, at: expect.any(Number), kind: "head", reason: "created" },
        { seq: 2, kind: "head", reason: "moved" },
        { seq: 3, kind: "head", reason: "removed" },
      ]);
      expect(await refs.tail(session)).toBe(3);
      expect(await refs.log(other, asSeq(0), 10)).toMatchObject([{ seq: 1, reason: "created" }]);
      expect(await refs.tail(other)).toBe(1);
      expect((await refs.log(session, asSeq(1), 10)).map((event) => event.seq)).toEqual([2, 3]);
      expect((await refs.log(session, asSeq(0), 2)).map((event) => event.seq)).toEqual([1, 2]);
      expect(await refs.log(session, asSeq(3), 10)).toEqual([]);
    });

    it("answers a set without events with the tail of the first session it names", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({ tail: true });
      await refs.set([{ name: "sessions/s1/heads/main", target, event: created }]);

      expect(
        await refs.set([
          { name: "kv/host/core/x", target },
          { name: "sessions/s1/parts/p", target },
        ]),
      ).toMatchObject({ kind: "set", seq: 1 });
    });

    it("throws for an event outside a session and writes nothing", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({ outside: true });

      await expect(
        refs.set([
          { name: "sessions/s1/heads/main", target, event: created },
          { name: "kv/host/core/x", target, event: moved },
        ]),
      ).rejects.toMatchObject({ code: "internal" });
      expect(await refs.get("sessions/s1/heads/main")).toBeNull();
      expect(await refs.tail(session)).toBe(0);
    });

    it("round-trips a blob under its content hash", async () => {
      const { objects } = await connect();
      const encoder = new TextEncoder();

      const id = await objects.putBlob(
        (async function* () {
          yield encoder.encode("hel");
          yield encoder.encode("lo");
        })(),
      );

      expect(id).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
      expect(
        await objects.putBlob(
          (async function* () {
            yield encoder.encode("hello");
          })(),
        ),
      ).toBe(id);

      const reader = await objects.blob(id);
      assert(reader);
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.chunks()) chunks.push(chunk);

      expect(reader.size).toBe(5);
      expect(reader.mime).toBeNull();
      expect(chunks.map((chunk) => new TextDecoder().decode(chunk)).join("")).toBe("hello");
    });

    it("keeps an object and a blob that share an id in one row", async () => {
      const { objects } = await connect();
      const value = { shared: 1 };
      const id = await objects.put(value);

      const blob = await objects.putBlob(
        (async function* () {
          yield new TextEncoder().encode('{"shared":1}');
        })(),
      );

      expect(blob).toBe(id);
      expect(await objects.get(id)).toEqual(value);
      expect((await objects.blob(blob))?.size).toBe(12);
    });

    it("checks every expect in a batch against the refs before it and applies repeated names in order", async () => {
      const { objects, refs } = await connect();
      const one = await objects.put("one");
      const two = await objects.put("two");
      const three = await objects.put("three");
      const first = await refs.set([{ name: "sessions/s1/heads/main", target: one }]);
      assert(first.kind === "set");
      const [revision] = first.revisions;

      const outcome = await refs.set([
        { name: "sessions/s1/heads/main", target: two, expect: revision, event: moved },
        { name: "sessions/s1/heads/main", target: three, expect: revision, event: moved },
        { name: "sessions/s1/parts/p", target: one, expect: "absent" },
        { name: "sessions/s1/parts/p", target: two, expect: "absent", event: created },
      ]);

      assert(outcome.kind === "set");
      expect(new Set(outcome.revisions).size).toBe(4);
      expect(outcome.seq).toBe(3);
      expect(await refs.get("sessions/s1/heads/main")).toEqual({
        name: "sessions/s1/heads/main",
        target: three,
        revision: outcome.revisions[1],
      });
      expect(await refs.get("sessions/s1/parts/p")).toEqual({
        name: "sessions/s1/parts/p",
        target: two,
        revision: outcome.revisions[3],
      });
      expect((await refs.log(session, asSeq(0), 10)).map((event) => event.seq)).toEqual([1, 2, 3]);

      const deleted = await refs.set([
        { name: "sessions/s1/parts/p", target: null },
        { name: "sessions/s1/parts/p", target: one },
      ]);

      assert(deleted.kind === "set");
      expect((await refs.get("sessions/s1/parts/p"))?.target).toBe(one);

      const recreated = await refs.set([
        { name: "sessions/s1/parts/q", target: one },
        { name: "sessions/s1/parts/q", target: null },
      ]);

      assert(recreated.kind === "set");
      expect(await refs.get("sessions/s1/parts/q")).toBeNull();
    });

    it("never reuses a revision, even for a ref deleted and set again", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put("again");
      const seen = new Set<string>();

      for (let round = 0; round < 3; round += 1) {
        const set = await refs.set([{ name: "kv/a", target }]);
        const unset = await refs.set([{ name: "kv/a", target: null }]);
        assert(set.kind === "set" && unset.kind === "set");

        for (const revision of [...set.revisions, ...unset.revisions]) seen.add(revision);
      }

      expect(seen.size).toBe(6);
    });

    it("lets exactly one of two concurrent sets under one expect win", async () => {
      const { objects, refs } = await connect();
      const base = await objects.put("base");
      const first = await refs.set([{ name: "sessions/s1/heads/main", target: base }]);
      assert(first.kind === "set");
      const [revision] = first.revisions;

      const outcomes = await Promise.all(
        ["left", "right"].map(async (side) =>
          refs.set([
            {
              name: "sessions/s1/heads/main",
              target: await objects.put(side),
              expect: revision,
              event: moved,
            },
          ]),
        ),
      );

      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["set", "stale"]);
      expect(await refs.tail(session)).toBe(1);

      const absent = await Promise.all(
        ["a", "b", "c"].map(async (side) =>
          refs.set([{ name: "kv/once", target: await objects.put(side), expect: "absent" }]),
        ),
      );

      expect(absent.filter((outcome) => outcome.kind === "set")).toHaveLength(1);
    });
  });
}
