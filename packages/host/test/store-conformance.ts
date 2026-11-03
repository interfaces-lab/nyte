import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { envelope, objectId } from "@nyte-ai/core/store";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";

const session: SessionId = asId("s1");

const other: SessionId = asId("s2");

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const moved: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "moved" };

const removed: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "removed" };

const stopping: DurableEvent = {
  head: asId("main"),
  kind: "run",
  run: asId("r1"),
  change: "stopping",
};

const configured: DurableEvent = {
  head: null,
  kind: "configured",
  selected: null,
  effective: null,
};

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

    it("indexes current session roots with keyset pages and versions for every session write", async () => {
      const { objects, refs, sessions } = await connect();

      const body = {
        name: null,
        parent: null,
        origin: null,
        workspace: "w",
        pinned: false,
        archived: false,
        createdAt: 1,
        lastActivityAt: 10,
        heads: [],
        prompt: null,
      };

      const first = await objects.put(envelope("session", { ...body, id: "a" }, 1));
      const second = await objects.put(envelope("session", { ...body, id: "b" }, 1));

      const child = await objects.put(
        envelope("session", { ...body, id: "c", parent: "a", lastActivityAt: 20 }, 1),
      );

      await refs.set([
        { name: "sessions/a", target: first },
        { name: "sessions/b", target: second },
        { name: "sessions/c", target: child },
        { name: "sessions/a/parts/history", target: first },
      ]);
      const roots = await sessions.list({ parents: { kind: "roots" }, limit: 1 });
      expect(roots.map((row) => row.ref.name)).toEqual(["sessions/a"]);
      expect(
        (await sessions.list({ parents: { kind: "all" }, limit: 10 })).map((row) => row.ref.name),
      ).toEqual(["sessions/c", "sessions/a", "sessions/b"]);
      expect(
        (await sessions.list({ parents: { kind: "children", session: asId("a") }, limit: 10 })).map(
          (row) => row.ref.name,
        ),
      ).toEqual(["sessions/c"]);
      expect(
        (
          await sessions.list({
            parents: { kind: "roots" },
            after: { at: 10, id: asId("a") },
            limit: 10,
          })
        ).map((row) => row.ref.name),
      ).toEqual(["sessions/b"]);
      await refs.set([{ name: "sessions/a/seen/device/main", target: first }]);
      const changed = await sessions.list({ parents: { kind: "roots" }, limit: 1 });
      expect(changed[0]?.ref).toEqual(roots[0]?.ref);
      expect(changed[0]?.version).not.toBe(roots[0]?.version);
      expect(
        await refs.set([{ name: "sessions/a", target: second, expect: "absent" }]),
      ).toMatchObject({ kind: "stale" });
      expect(await sessions.list({ parents: { kind: "roots" }, limit: 1 })).toEqual(changed);
      await refs.set([{ name: "sessions/a", target: null }]);
      expect(
        (await sessions.list({ parents: { kind: "roots" }, limit: 10 })).map((row) => row.ref.name),
      ).toEqual(["sessions/b"]);
    });

    const root = async (
      connection: StoreConnection,
      id: string,
      at: number,
      parent: string | null = null,
    ) =>
      connection.objects.put(
        envelope(
          "session",
          {
            id,
            name: null,
            parent,
            origin: null,
            workspace: "w",
            pinned: false,
            archived: false,
            createdAt: 1,
            lastActivityAt: at,
            heads: [],
            prompt: null,
          },
          1,
        ),
      );

    const seqs = async (connection: StoreConnection) =>
      Object.fromEntries(
        (await connection.sessions.list({ parents: { kind: "all" }, limit: 10 })).map((row) => [
          row.ref.name,
          row.seq,
        ]),
      );

    it("stamps the directory rows a set changes with one host seq per set", async () => {
      const connection = await connect();
      const target = await connection.objects.put({});

      expect(
        await connection.refs.set([
          { name: "sessions/a", target: await root(connection, "a", 10) },
          { name: "sessions/b", target: await root(connection, "b", 20) },
        ]),
      ).toMatchObject({ kind: "set", host: { seq: 1, sessions: ["a", "b"] } });
      expect(await seqs(connection)).toEqual({ "sessions/a": 1, "sessions/b": 1 });
      expect(
        await connection.refs.set([
          { name: "sessions/a/heads/main", target, events: [created, moved] },
          { name: "sessions/b/heads/main", target, events: [created] },
          { name: "sessions/a/inbox/main", target },
        ]),
      ).toMatchObject({ host: { seq: 2, sessions: ["a", "b"] } });
      expect(
        await connection.refs.set([
          { name: "sessions/a/configured", target, events: [configured] },
          { name: "sessions/a/inbox/main", target: null },
          { name: "sessions/ghost/heads/main", target, events: [created] },
        ]),
      ).toMatchObject({ kind: "set", host: null });
      expect(
        await connection.refs.set([{ name: "sessions/a/seen/device/main", target }]),
      ).toMatchObject({ host: { seq: 3, sessions: ["a"] } });
      expect(
        await connection.refs.set([
          { name: "sessions/b/heads/main", target: null, events: [removed], expect: "absent" },
        ]),
      ).toMatchObject({ kind: "stale" });
      expect(
        await connection.refs.set([{ name: "sessions/b/notes", target, events: [moved] }]),
      ).toMatchObject({ host: { seq: 4, sessions: ["b"] } });
      expect(await seqs(connection)).toEqual({ "sessions/a": 3, "sessions/b": 4 });
    });

    it("restamps a child's parent when the child's run or root changes, and names a dropped root", async () => {
      const connection = await connect();
      const target = await connection.objects.put({});

      await connection.refs.set([
        { name: "sessions/p", target: await root(connection, "p", 10) },
        { name: "sessions/c", target: await root(connection, "c", 20, "p") },
        { name: "sessions/o", target: await root(connection, "o", 30) },
      ]);

      expect(
        await connection.refs.set([{ name: "sessions/c/runs/r1", target, events: [stopping] }]),
      ).toMatchObject({ host: { seq: 2, sessions: ["c", "p"] } });
      expect(await seqs(connection)).toEqual({
        "sessions/c": 2,
        "sessions/o": 1,
        "sessions/p": 2,
      });

      expect(await connection.refs.set([{ name: "sessions/c", target: null }])).toMatchObject({
        host: { seq: 3, sessions: ["c", "p"] },
      });
      expect(await seqs(connection)).toEqual({ "sessions/o": 1, "sessions/p": 3 });
    });

    it("answers the host seq, the ids a filter selects, and exactly the rows written since a seq", async () => {
      const connection = await connect();
      const target = await connection.objects.put({});

      expect(
        await connection.sessions.changed({ since: 0, parents: { kind: "all" }, limit: 10 }),
      ).toEqual({ seq: 0, ids: [], rows: [] });

      await connection.refs.set([
        { name: "sessions/a", target: await root(connection, "a", 10) },
        { name: "sessions/b", target: await root(connection, "b", 20) },
        { name: "sessions/c", target: await root(connection, "c", 30, "a") },
      ]);
      await connection.refs.set([{ name: "sessions/b/heads/main", target, events: [created] }]);
      await connection.refs.set([{ name: "sessions/a/heads/main", target, events: [created] }]);

      const all = await connection.sessions.changed({
        since: 0,
        parents: { kind: "all" },
        limit: 10,
      });
      expect(all.seq).toBe(3);
      expect(all.ids).toEqual(["c", "b", "a"]);
      expect(all.rows).toEqual(
        await connection.sessions.list({ parents: { kind: "all" }, limit: 10 }),
      );

      const since = await connection.sessions.changed({
        since: 1,
        parents: { kind: "all" },
        limit: 10,
      });
      expect(since.ids).toEqual(["c", "b", "a"]);
      expect(since.rows.map((row) => [row.ref.name, row.seq])).toEqual([
        ["sessions/b", 2],
        ["sessions/a", 3],
      ]);
      expect(
        await connection.sessions.changed({ since: 1, parents: { kind: "roots" }, limit: 1 }),
      ).toMatchObject({ seq: 3, ids: ["b"], rows: [{ ref: { name: "sessions/b" }, seq: 2 }] });
      expect(
        await connection.sessions.changed({ since: 3, parents: { kind: "all" }, limit: 10 }),
      ).toEqual({ seq: 3, ids: ["c", "b", "a"], rows: [] });
    });

    it("finds only outstanding work, including archived sessions, and removes settled receipts atomically", async () => {
      const { objects, refs, sessions } = await connect();

      for (const id of ["a", "b", "idle"]) {
        const target = await objects.put(
          envelope(
            "session",
            {
              id,
              name: null,
              parent: null,
              origin: null,
              workspace: "w",
              pinned: false,
              archived: id === "a",
              createdAt: 1,
              lastActivityAt: 1,
              heads: [],
              prompt: null,
            },
            1,
          ),
        );

        await refs.set([{ name: `sessions/${id}`, target }]);
      }

      const pending = await objects.put(
        envelope("receipt", { id: "r", digest: "d", kind: "move", outcome: null }, 1),
      );

      const settled = await objects.put(
        envelope(
          "receipt",
          {
            id: "r",
            digest: "d",
            kind: "move",
            outcome: { kind: "summary-failed", reason: "done" },
          },
          1,
        ),
      );

      await refs.set([
        { name: "sessions/a/receipts/r", target: pending },
        { name: "sessions/b/receipts/r", target: pending },
        { name: "sessions/idle/receipts/r", target: settled },
      ]);
      expect((await sessions.work({ limit: 1 })).map((ref) => ref.name)).toEqual(["sessions/a"]);
      expect((await sessions.work({ after: asId("a"), limit: 10 })).map((ref) => ref.name)).toEqual(
        ["sessions/b"],
      );
      expect(
        (await sessions.pending({ kind: "receipt", sessions: [asId("a")] })).map((ref) => ref.name),
      ).toEqual(["sessions/a/receipts/r"]);
      expect(
        await refs.set([{ name: "sessions/a/receipts/r", target: settled, expect: "absent" }]),
      ).toMatchObject({ kind: "stale" });
      expect((await sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
        "sessions/a",
        "sessions/b",
      ]);
      await refs.set([{ name: "sessions/a/receipts/r", target: settled }]);
      expect((await sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual(["sessions/b"]);
      expect(await sessions.pending({ kind: "receipt", sessions: [asId("a")] })).toEqual([]);
      await refs.set([{ name: "sessions/b", target: null }]);
      expect(await sessions.work({ limit: 10 })).toEqual([]);
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

      expect(outcome.logged).toEqual([]);
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
        { name: "sessions/s1/heads/main", target: after, expect: head, events: [moved] },
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

    it("lands a set only while its fence refs exist, and answers fenced, writing nothing, once one is gone", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put("value");
      const live = "sessions/s1/live/r1";
      await refs.set([{ name: live, target }]);
      const part = { name: "sessions/s1/parts/p1", target, fences: [live], events: [moved] };

      expect((await refs.set([part])).kind).toBe("set");
      await refs.set([{ name: live, target: null }]);

      expect(await refs.set([{ ...part, name: "sessions/s1/parts/p2" }])).toEqual({
        kind: "fenced",
        name: live,
      });
      expect(await refs.get("sessions/s1/parts/p2")).toBeNull();
      expect(await refs.tail(session)).toBe(1);
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

    it("lists a prefix that ends in U+FFFF", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put(2);
      await refs.set([
        { name: "kv/\uFFFF", target },
        { name: "kv/\uFFFF/a", target },
        { name: "kv/\u{10000}", target },
      ]);

      expect((await refs.list("kv/\uFFFF")).map((ref) => ref.name)).toEqual([
        "kv/\uFFFF",
        "kv/\uFFFF/a",
      ]);
    });

    it("logs events in entry order with a seq per session", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({});

      const first = await refs.set([
        { name: "sessions/s1/heads/main", target, events: [created] },
        { name: "sessions/s1/inbox/main", target },
        { name: "sessions/s2/heads/main", target, events: [created] },
        { name: "sessions/s1/runs/r1", target, events: [moved] },
      ]);

      const second = await refs.set([
        { name: "sessions/s1/heads/main", target: null, events: [removed] },
      ]);

      expect(first).toMatchObject({ kind: "set", logged: [1, 1, 2] });
      expect(second).toMatchObject({ kind: "set", logged: [3] });
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

    it("keeps one fold checkpoint per session, a later seq replacing it, and sizes the log past a seq", async () => {
      const { objects, refs, checkpoints } = await connect();

      if (checkpoints === undefined) return;
      const target = await objects.put({});
      await refs.set([{ name: "sessions/s1/heads/main", target, events: [created, moved] }]);
      await checkpoints.write(session, { seq: asSeq(2), body: "second" });
      await checkpoints.write(session, { seq: asSeq(1), body: "first" });

      expect(await checkpoints.read(session)).toEqual({ seq: 2, body: "second" });
      expect(await checkpoints.read(other)).toBeNull();

      await checkpoints.write(session, { seq: asSeq(2), body: "again" });

      expect(await checkpoints.read(session)).toEqual({ seq: 2, body: "again" });
      expect(await checkpoints.gap(session, asSeq(1))).toEqual({
        events: 1,
        bytes: new TextEncoder().encode(JSON.stringify(moved)).byteLength,
      });
      expect(await checkpoints.gap(session, asSeq(2))).toEqual({ events: 0, bytes: 0 });
    });

    it("throws for an event outside a session and writes nothing", async () => {
      const { objects, refs } = await connect();
      const target = await objects.put({ outside: true });

      await expect(
        refs.set([
          { name: "sessions/s1/heads/main", target, events: [created] },
          { name: "kv/host/core/x", target, events: [moved] },
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
        { name: "sessions/s1/heads/main", target: two, expect: revision, events: [moved] },
        { name: "sessions/s1/heads/main", target: three, expect: revision, events: [moved] },
        { name: "sessions/s1/parts/p", target: one, expect: "absent" },
        { name: "sessions/s1/parts/p", target: two, expect: "absent", events: [created] },
      ]);

      assert(outcome.kind === "set");
      expect(new Set(outcome.revisions).size).toBe(4);
      expect(outcome.logged).toEqual([1, 2, 3]);
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
      expect(await objects.get(one)).toBeNull();
      expect(await objects.put("one")).toBe(one);

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
        await objects.put("again");
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
              events: [moved],
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
