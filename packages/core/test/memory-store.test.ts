import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { memoryStore, objectId } from "../src/index.ts";
import { attempt, STALE } from "../src/store/session.ts";

const session: SessionId = asId("s1");

const other: SessionId = asId("s2");

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const moved: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "moved" };

const removed: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "removed" };

describe("memoryStore", () => {
  it("puts an object once per content, whatever its key order", async () => {
    const { objects } = await memoryStore().open();
    const value = { b: [1, { d: true, c: "x" }], a: null };
    const id = await objects.put(value);

    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await objects.put({ a: null, b: [1, { c: "x", d: true }] })).toBe(id);
    expect(await objects.get(id)).toEqual(value);
    expect(await objects.put({ a: null, b: [{ c: "x", d: true }, 1] })).not.toBe(id);
  });

  it("puts an object under its shared content id", async () => {
    const { objects } = await memoryStore().open();
    const value = { b: [1, { d: true, c: "x" }], a: null };

    expect(await objects.put(value)).toBe(await objectId(value));
  });

  it("returns null for an unknown object or blob", async () => {
    const { objects } = await memoryStore().open();

    expect(await objects.get(asId("missing"))).toBeNull();
    expect(await objects.blob(asId("missing"))).toBeNull();
  });

  it("applies a batch and returns a revision per entry", async () => {
    const { objects, refs } = await memoryStore().open();
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
    const { objects, refs } = await memoryStore().open();
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
    const { objects, refs } = await memoryStore().open();
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
    const { objects, refs } = await memoryStore().open();
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

  it("lists names by code point, as the SQL stores do", async () => {
    const { objects, refs } = await memoryStore().open();
    const target = await objects.put(1);
    await refs.set([
      { name: "kv/\u{1F600}", target },
      { name: "kv/\uFFFF", target },
    ]);

    expect((await refs.list("kv/")).map((ref) => ref.name)).toEqual(["kv/\uFFFF", "kv/\u{1F600}"]);
  });

  it("logs events in entry order with a seq per session", async () => {
    const { objects, refs } = await memoryStore().open();
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

  it("round-trips a blob under its content hash", async () => {
    const { objects } = await memoryStore().open();
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
    expect(chunks.map((chunk) => new TextDecoder().decode(chunk))).toEqual(["hello"]);
  });
});

describe("attempt", () => {
  it("retries a lost write until it lands, and fails stale once it keeps losing", async () => {
    let lost = 2;

    expect(await attempt("Landing", async () => (lost-- > 0 ? STALE : "landed"))).toBe("landed");

    let tries = 0;

    await expect(
      attempt("Racing", async () => {
        tries += 1;

        return STALE;
      }),
    ).rejects.toMatchObject({ code: "stale", message: "Racing lost to concurrent writes 8 times." });
    expect(tries).toBe(8);
  });
});
