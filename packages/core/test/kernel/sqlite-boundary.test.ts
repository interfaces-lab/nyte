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
