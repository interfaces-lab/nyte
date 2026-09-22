import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { canonicalJson } from "@nyte-ai/client";
import { openStore, storePath } from "./helpers.ts";

test("a matching content hash does not make an incomplete stored object valid", async () => {
  const path = storePath();
  const session = await openStore(path).create({ id: "corrupt" });
  const db = new DatabaseSync(path);
  try {
    for (const kind of ["commit", "change", "run", "effect", "stack", "blob"]) {
      const body = canonicalJson({ kind });
      const oid = createHash("sha256").update(body).digest("hex");
      db.prepare(
        "INSERT INTO objects (session_id, oid, kind, body, at) VALUES (?, ?, ?, ?, ?)",
      ).run(session.id, oid, kind, body, 0);
      await assert.rejects(session.objects.get(oid), /is not a known object/);
    }
  } finally {
    db.close();
  }
});

test("invalid serialized writes leave object and event batches untouched", async () => {
  const session = await openStore(storePath()).create({ id: "invalid-writes" });
  for (const timestamp of [NaN, Infinity, -Infinity]) {
    await assert.rejects(
      session.objects.put([
        { kind: "blob", value: "must not be saved" },
        {
          kind: "commit",
          parent: null,
          body: { kind: "message", message: { role: "user", content: "test", timestamp } },
          start: { kind: "none" },
          at: 0,
        },
      ]),
    );
    assert.deepEqual(await session.objects.list(), []);
    await assert.rejects(
      session.events.append([
        { kind: "notice", level: "info", owner: "test", message: "must not be saved" },
        { kind: "delta", runId: "run", attempt: 0, index: timestamp, part: "text", delta: "x" },
      ]),
    );
    assert.equal(await session.events.last(), 0);
    assert.deepEqual(await session.events.read({ afterSeq: 0 }), []);
  }
  await session.events.append([{ kind: "notice", level: "info", owner: "test", message: "ok" }]);
  assert.equal(await session.events.last(), 1);
});

test("stored events reject malformed payloads before replay", async () => {
  const path = storePath();
  const session = await openStore(path).create({ id: "events" });
  await session.events.append([{ kind: "notice", level: "info", owner: "test", message: "ok" }]);
  const db = new DatabaseSync(path);
  try {
    db.prepare("UPDATE events SET body = ? WHERE session_id = ?").run(
      JSON.stringify({ kind: "progress", runId: "run", callId: "call", progress: { text: 1 } }),
      session.id,
    );
    await assert.rejects(session.events.read({ afterSeq: 0 }), /not a known event body/);
  } finally {
    db.close();
  }
});
