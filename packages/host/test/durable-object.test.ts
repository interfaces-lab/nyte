import { STORE_VERSION, envelope } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { durableObjectStore } from "../src/durable-object.ts";
import { doSqlStub } from "./do-sql-stub.ts";
import { storeConformance } from "./store-conformance.ts";

async function fresh() {
  return durableObjectStore(doSqlStub());
}

storeConformance("durableObjectStore over the node:sqlite stand-in (§43i)", fresh);

describe("durableObjectStore migrations", () => {
  it.each(["activity", "sort_at"])(
    "migrates a version 3 %s index without changing canonical records and reopens unchanged",
    async (column) => {
      const storage = doSqlStub();
      const store = durableObjectStore(storage);

      const records = [
        ...[
          { id: "older", parent: null, lastActivityAt: 10 },
          { id: "newer", parent: null, lastActivityAt: 30 },
          { id: "child", parent: "older", lastActivityAt: 20 },
        ].map(({ id, parent, lastActivityAt }) => ({
          name: `sessions/${id}`,
          object: envelope(
            "session",
            {
              id,
              name: id,
              parent,
              origin: null,
              workspace: "w",
              pinned: false,
              archived: id === "older",
              createdAt: 1,
              lastActivityAt,
              heads: [],
              prompt: null,
            },
            1,
          ),
        })),
        {
          name: "sessions/older/receipts/pending",
          object: envelope(
            "receipt",
            { id: "pending", kind: "move", digest: "d", outcome: null },
            1,
          ),
        },
        {
          name: "sessions/newer/receipts/settled",
          object: envelope(
            "receipt",
            {
              id: "settled",
              kind: "move",
              digest: "d",
              outcome: { kind: "summary-failed", reason: "done" },
            },
            1,
          ),
        },
      ];

      try {
        for (const statement of [
          "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)",
          "CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
          "CREATE TABLE log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
          "CREATE TABLE store_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)",
          "INSERT INTO store_meta VALUES (1, 3)",
          `CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, ${column} REAL NOT NULL, version TEXT NOT NULL)`,
          `CREATE INDEX session_index_activity ON session_index(${column}, session)`,
          `CREATE INDEX session_index_parent_activity ON session_index(parent, ${column}, session)`,
          "CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL)",
          "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
          "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
          "INSERT INTO session_index VALUES ('sessions/older', 'older', NULL, 999, 'stale')",
          "INSERT INTO pending_work VALUES ('sessions/newer/receipts/settled', 'newer', 'receipt')",
        ])
          storage.sql.exec(statement);

        for (const [index, record] of records.entries()) {
          storage.sql.exec(
            "INSERT INTO objects (id, body) VALUES (?, ?)",
            `object-${index}`,
            JSON.stringify(record.object),
          );
          storage.sql.exec(
            "INSERT INTO refs VALUES (?, ?, ?)",
            record.name,
            `object-${index}`,
            `revision-${index}`,
          );
        }

        const refs = records
          .map((record, index) => ({
            name: record.name,
            target: `object-${index}`,
            revision: `revision-${index}`,
          }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        const connection = await store.open();
        const directory = await connection.sessions.list({ parents: { kind: "all" }, limit: 10 });
        expect(directory.map((row) => row.ref.name)).toEqual([
          "sessions/newer",
          "sessions/child",
          "sessions/older",
        ]);
        expect(
          (
            await connection.sessions.list({
              parents: { kind: "roots" },
              after: { at: 30, id: asId("newer") },
              limit: 10,
            })
          ).map((row) => row.ref.name),
        ).toEqual(["sessions/older"]);
        expect(
          (
            await connection.sessions.list({
              parents: { kind: "children", session: asId("older") },
              limit: 10,
            })
          ).map((row) => row.ref.name),
        ).toEqual(["sessions/child"]);
        expect((await connection.sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
          "sessions/older",
        ]);
        expect(
          (await connection.sessions.pending({ kind: "receipt" })).map((ref) => ref.name),
        ).toEqual(["sessions/older/receipts/pending"]);
        expect(await connection.refs.list("")).toEqual(refs);

        for (const [index, record] of records.entries())
          expect(await connection.objects.get(asId(`object-${index}`))).toEqual(record.object);
        await store.close();
        const reopened = await store.open();
        expect(await reopened.sessions.list({ parents: { kind: "all" }, limit: 10 })).toEqual(
          directory,
        );
        expect(await reopened.refs.list("")).toEqual(refs);
        expect((await reopened.sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
          "sessions/older",
        ]);
        expect(storage.sql.exec("SELECT version FROM store_meta WHERE id = 1").toArray()).toEqual([
          { version: STORE_VERSION },
        ]);
        expect(storage.sql.exec("SELECT COUNT(*) AS count FROM objects").toArray()).toEqual([
          { count: 5 },
        ]);
      } finally {
        await store.close();
        storage.database.close();
      }
    },
  );
});

describe("durableObjectStore limits (§42k)", () => {
  it("answers invalid for an object or a blob past 2 MB and writes nothing", async () => {
    const connection = await (await fresh()).open();
    const large = "x".repeat(2_000_001);

    await expect(connection.objects.put({ large })).rejects.toMatchObject({ code: "invalid" });
    await expect(
      connection.objects.putBlob(
        (async function* () {
          yield new Uint8Array(2_000_001);
        })(),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await connection.refs.list("")).toEqual([]);
  });
});
