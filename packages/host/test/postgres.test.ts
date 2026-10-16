import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { STORE_VERSION, envelope } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { postgresStore } from "../src/index.ts";
import type { PostgresClient, PostgresPool } from "../src/index.ts";
import { storeConformance } from "./store-conformance.ts";

function pglitePool(): PostgresPool & { readonly lent: () => number } {
  const database = new PGlite();
  let queue: Promise<void> = Promise.resolve();
  let lent = 0;

  return {
    lent: () => lent,
    connect() {
      const previous = queue;
      let release = (): void => undefined;
      queue = new Promise((resolve) => {
        release = resolve;
      });

      return previous.then((): PostgresClient => {
        lent += 1;
        let released = false;

        return {
          async query(text, values) {
            const { rows } = await database.query<Record<string, unknown>>(
              text,
              values === undefined ? undefined : [...values],
            );

            return { rows };
          },
          release() {
            if (released) return;
            released = true;
            release();
          },
        };
      });
    },
    end: () => database.close(),
  };
}

storeConformance("postgresStore over pglite", async () => {
  const pool = pglitePool();
  const store = postgresStore({ pool });

  return {
    open: () => store.open(),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
});

describe("postgresStore", () => {
  it.each(["activity", "sort_at"])(
    "migrates a version 3 %s index without changing canonical records and reopens unchanged",
    async (column) => {
      const pool = pglitePool();
      const store = postgresStore({ pool });

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
        const seed = await pool.connect();

        try {
          for (const statement of [
            "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BYTEA NULL)",
            'CREATE TABLE refs (name TEXT COLLATE "C" PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)',
            "CREATE TABLE log (session TEXT NOT NULL, seq BIGINT NOT NULL, at BIGINT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
            "CREATE TABLE store_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)",
            "INSERT INTO store_meta VALUES (1, 3)",
            `CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, ${column} DOUBLE PRECISION NOT NULL, version TEXT NOT NULL)`,
            `CREATE INDEX session_index_activity ON session_index(${column}, session)`,
            `CREATE INDEX session_index_parent_activity ON session_index(parent, ${column}, session)`,
            "CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL)",
            "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
            "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
            "INSERT INTO session_index VALUES ('sessions/older', 'older', NULL, 999, 'stale')",
            "INSERT INTO pending_work VALUES ('sessions/newer/receipts/settled', 'newer', 'receipt')",
          ])
            await seed.query(statement);

          for (const [index, record] of records.entries()) {
            await seed.query("INSERT INTO objects (id, body) VALUES ($1, $2)", [
              `object-${index}`,
              JSON.stringify(record.object),
            ]);
            await seed.query("INSERT INTO refs VALUES ($1, $2, $3)", [
              record.name,
              `object-${index}`,
              `revision-${index}`,
            ]);
          }
        } finally {
          seed.release();
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
        const inspect = await pool.connect();

        try {
          expect((await inspect.query("SELECT version FROM store_meta WHERE id = 1")).rows).toEqual(
            [{ version: STORE_VERSION }],
          );
          expect(
            (await inspect.query("SELECT COUNT(*)::integer AS count FROM objects")).rows,
          ).toEqual([{ count: 5 }]);
        } finally {
          inspect.release();
        }
      } finally {
        await store.close();
        await pool.end();
      }
    },
  );

  it("publishes opposite-order session batches and leaves both index versions unchanged after a failed compare-and-set", async () => {
    const pool = pglitePool();
    const firstStore = postgresStore({ pool });
    const secondStore = postgresStore({ pool });

    try {
      const first = await firstStore.open();
      const second = await secondStore.open();

      for (const id of ["a", "b"]) {
        const target = await first.objects.put(
          envelope(
            "session",
            {
              id,
              name: id,
              parent: null,
              origin: null,
              workspace: "w",
              pinned: false,
              archived: false,
              createdAt: 1,
              lastActivityAt: 1,
              heads: [],
              prompt: null,
            },
            1,
          ),
        );
        await first.refs.set([{ name: `sessions/${id}`, target }]);
      }
      const before = await first.sessions.list({ parents: { kind: "all" }, limit: 10 });
      const target = await first.objects.put({ marker: "tip" });
      const outcomes = await Promise.all([
        first.refs.set([
          { name: "sessions/a/heads/one", target },
          { name: "sessions/b/heads/one", target },
        ]),
        second.refs.set([
          { name: "sessions/b/heads/two", target },
          { name: "sessions/a/heads/two", target },
        ]),
      ]);
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["set", "set"]);
      expect((await first.refs.list("sessions/")).map((ref) => ref.name)).toEqual([
        "sessions/a",
        "sessions/a/heads/one",
        "sessions/a/heads/two",
        "sessions/b",
        "sessions/b/heads/one",
        "sessions/b/heads/two",
      ]);
      const current = await first.sessions.list({ parents: { kind: "all" }, limit: 10 });
      expect(current.map((row) => row.ref)).toEqual(before.map((row) => row.ref));
      expect(current[0]?.version).not.toBe(before[0]?.version);
      expect(current[1]?.version).not.toBe(before[1]?.version);
      expect(
        await second.refs.set([
          { name: "sessions/a/heads/three", target },
          { name: "sessions/b/heads/one", target, expect: "absent" },
        ]),
      ).toMatchObject({ kind: "stale", name: "sessions/b/heads/one" });
      expect(await first.refs.get("sessions/a/heads/three")).toBeNull();
      expect(await first.sessions.list({ parents: { kind: "all" }, limit: 10 })).toEqual(current);
    } finally {
      await firstStore.close();
      await secondStore.close();
      await pool.end();
    }
  });

  it("takes pg's Pool as its pool type", () => {
    const fits: Pool extends PostgresPool ? true : false = true;

    expect(fits).toBe(true);
  });

  it("leaves the caller's pool open on close and creates its tables once", async () => {
    const pool = pglitePool();
    const store = postgresStore({ pool });
    const first = await store.open();
    const second = await store.open();

    expect(second).toBe(first);
    await store.close();
    const reopened = await postgresStore({ pool }).open();
    const target = await reopened.objects.put({ again: true });

    expect(await reopened.objects.get(target)).toEqual({ again: true });
    expect(pool.lent()).toBeGreaterThan(0);
    await pool.end();
  });
});
