/**
 * `objects.chain`: the parent walk as one store query, and batched deletes.
 * Runs against the in-process backend and, under `NYTE_TEST_STORE=worker`,
 * the worker bridge.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { history } from "../../src/kernel/graph.ts";
import type { Commit, Obj, Oid } from "../../src/kernel/model.ts";
import { chain, commit, message, openStore, storePath, user } from "./helpers.ts";

test("a chain of commits comes back newest first in one query", async () => {
  const session = await openStore().create();
  const oids = await chain(
    session,
    null,
    Array.from({ length: 10 }, (_, index) => message(user(`m${index}`))),
  );
  const tip = oids.at(-1);
  assert.ok(tip);

  const full = await session.objects.chain(tip, { limit: 100 });
  assert.deepEqual(
    full.map((item) => item.oid),
    [...oids].reverse(),
  );
  assert.ok(full.every((item) => item.object.kind === "commit"));

  const limited = await session.objects.chain(tip, { limit: 3 });
  assert.deepEqual(
    limited.map((item) => item.oid),
    [...oids].reverse().slice(0, 3),
  );
  assert.deepEqual(await session.objects.chain(tip, { limit: 0 }), []);
  assert.deepEqual(await session.objects.chain("0".repeat(64), { limit: 5 }), []);
});

test("a missing parent ends the chain and the graph reports it by id", async () => {
  const session = await openStore().create();
  const [root, second, third] = await chain(session, null, [
    message(user("a")),
    message(user("b")),
    message(user("c")),
  ]);
  assert.ok(root && second && third);
  assert.equal(await session.objects.delete([root]), 1);

  const page = await session.objects.chain(third, { limit: 10 });
  assert.deepEqual(
    page.map((item) => item.oid),
    [third, second],
  );

  const walked: Oid[] = [];
  await assert.rejects(
    async () => {
      for await (const entry of history(session.objects, third)) walked.push(entry.oid);
    },
    { message: `Corrupt commit graph at ${root}: missing or non-commit object` },
  );
  assert.deepEqual(walked, [third, second]);
});

test("a chain stops at an object without a parent", async () => {
  const session = await openStore().create();
  const [blob] = await session.objects.put([{ kind: "blob", value: 1 }]);
  assert.ok(blob);
  const page = await session.objects.chain(blob, { limit: 10 });
  assert.deepEqual(
    page.map((item) => item.oid),
    [blob],
  );
  await assert.rejects(
    async () => {
      for await (const _entry of history(session.objects, blob)) {
        assert.fail("a blob tip must not yield");
      }
    },
    { message: `Corrupt commit graph at ${blob}: missing or non-commit object` },
  );
});

test("a stored parent loop terminates at the limit", async () => {
  const path = storePath();
  const store = openStore(path);
  const session = await store.create();
  // Content addressing forbids a real cycle, so forge rows the way corruption would.
  const first = commit("second-oid", message(user("first")));
  const second = commit("first-oid", message(user("second")));
  const db = new DatabaseSync(path);
  try {
    const insert = db.prepare(
      "INSERT INTO objects (session_id, oid, kind, body, at) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(session.id, "first-oid", "commit", JSON.stringify(first), 1);
    insert.run(session.id, "second-oid", "commit", JSON.stringify(second), 1);
  } finally {
    db.close();
  }
  // The rows fail hash verification, which proves the query returned rather than looped.
  await assert.rejects(session.objects.chain("first-oid", { limit: 50 }), {
    name: "CorruptObject",
    message: /does not match its hash/,
  });
});

test("the graph walk reports a cycle the store hands it", async () => {
  const a = commit("b", message(user("a")));
  const b = commit("a", message(user("b")));
  const stored = new Map<Oid, Commit>([
    ["a", a],
    ["b", b],
  ]);
  const looping = {
    async chain(from: Oid, options: { readonly limit: number }) {
      const page: { oid: Oid; object: Obj }[] = [];
      let oid: Oid | null = from;
      while (oid !== null && page.length < options.limit) {
        const object = stored.get(oid);
        if (object === undefined) break;
        page.push({ oid, object });
        oid = object.parent;
      }
      return page;
    },
  };
  const walked: Oid[] = [];
  await assert.rejects(
    async () => {
      for await (const entry of history(looping, "a")) walked.push(entry.oid);
    },
    { message: "Commit graph cycle at a" },
  );
  assert.deepEqual(walked, ["a", "b"]);
});

test("delete removes a batch in one call and reports the count", async () => {
  const session = await openStore().create();
  const oids = await chain(
    session,
    null,
    Array.from({ length: 300 }, (_, index) => message(user(`m${index}`))),
  );
  assert.equal(await session.objects.delete([]), 0);
  assert.equal(await session.objects.delete([...oids.slice(0, 256), "0".repeat(64)]), 256);
  assert.equal((await session.objects.list()).length, 44);
  assert.equal(await session.objects.delete(oids.slice(0, 256)), 0);
});
