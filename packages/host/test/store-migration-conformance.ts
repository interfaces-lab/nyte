import { asId } from "@nyte-ai/schema";
import type { DurableEvent } from "@nyte-ai/schema";
import { STORE_VERSION, envelope } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core";
import { describe, expect, it } from "vitest";

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

export interface MigrationBackend {
  readonly dialect: "sqlite" | "postgres";
  readonly store: Store;
  exec(sql: string, values?: readonly (string | number)[]): Promise<void>;
  rows(sql: string): Promise<readonly unknown[]>;
  backups?(): Promise<readonly string[]>;
  close(): Promise<void>;
}

export function storeMigrationConformance(
  name: string,
  open: () => Promise<MigrationBackend>,
): void {
  describe(name, () => {
    it.each(["activity", "sort_at"])(
      "upgrades a version-3 %s index without changing canonical records, without a backup, and reopens unchanged",
      async (column) => {
        const backend = await open();
        const postgres = backend.dialect === "postgres";
        const slot = (index: number) => (postgres ? `$${index}` : "?");

        const types = postgres
          ? {
              bytes: "BYTEA",
              integer: "BIGINT",
              real: "DOUBLE PRECISION",
              name: 'TEXT COLLATE "C"',
            }
          : { bytes: "BLOB", integer: "INTEGER", real: "REAL", name: "TEXT" };

        const records = [
          ...[
            { id: "older", parent: null, lastActivityAt: 10 },
            { id: "newer", parent: null, lastActivityAt: 30 },
            { id: "child", parent: "older", lastActivityAt: 30 },
          ].map((row) => ({
            name: `sessions/${row.id}`,
            object: envelope(
              "session",
              {
                id: row.id,
                name: row.id,
                parent: row.parent,
                origin: null,
                workspace: "w",
                pinned: row.id === "newer",
                archived: row.id === "older",
                createdAt: 1,
                lastActivityAt: row.lastActivityAt,
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

        const canonical = async () => ({
          objects: await backend.rows("SELECT id, body FROM objects ORDER BY id"),
          refs: await backend.rows("SELECT name, target, revision FROM refs ORDER BY name"),
          log: await backend.rows("SELECT session, seq, at, event FROM log ORDER BY session, seq"),
        });

        try {
          for (const statement of [
            `CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes ${types.bytes} NULL)`,
            `CREATE TABLE refs (name ${types.name} PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)`,
            `CREATE TABLE log (session TEXT NOT NULL, seq ${types.integer} NOT NULL, at ${types.integer} NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))`,
            "CREATE TABLE store_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)",
            "INSERT INTO store_meta VALUES (1, 3)",
            `CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, ${column} ${types.real} NOT NULL, version TEXT NOT NULL)`,
            `CREATE INDEX session_index_activity ON session_index(${column}, session)`,
            `CREATE INDEX session_index_parent_activity ON session_index(parent, ${column}, session)`,
            "CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL)",
            "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
            "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
            "INSERT INTO session_index VALUES ('sessions/older', 'older', NULL, 999, 'stale'), ('sessions/ghost', 'ghost', NULL, 0, 'ghost-version')",
            "INSERT INTO pending_work VALUES ('sessions/newer/receipts/settled', 'newer', 'receipt'), ('sessions/ghost/receipts/gone', 'ghost', 'receipt')",
          ]) {
            await backend.exec(statement);
          }

          for (const [index, record] of records.entries()) {
            await backend.exec(`INSERT INTO objects (id, body) VALUES (${slot(1)}, ${slot(2)})`, [
              `object-${index}`,
              JSON.stringify(record.object),
            ]);
            await backend.exec(`INSERT INTO refs VALUES (${slot(1)}, ${slot(2)}, ${slot(3)})`, [
              record.name,
              `object-${index}`,
              `revision-${index}`,
            ]);
          }

          await backend.exec(
            `INSERT INTO log VALUES (${slot(1)}, ${slot(2)}, ${slot(3)}, ${slot(4)})`,
            ["older", 1, 2, JSON.stringify(created)],
          );
          const before = await canonical();

          const refs = records
            .map((record, index) => ({
              name: record.name,
              target: `object-${index}`,
              revision: `revision-${index}`,
            }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

          const connection = await backend.store.open();
          const directory = await connection.sessions.list({ parents: { kind: "all" }, limit: 10 });
          expect(directory.map((row) => row.ref.name)).toEqual([
            "sessions/child",
            "sessions/newer",
            "sessions/older",
          ]);
          expect(
            (
              await connection.sessions.list({
                parents: { kind: "all" },
                after: { at: 30, id: asId("child") },
                limit: 10,
              })
            ).map((row) => row.ref.name),
          ).toEqual(["sessions/newer", "sessions/older"]);
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
            (
              await connection.sessions.changed({
                since: 0,
                parents: { kind: "all" },
                pinned: true,
                limit: 10,
              })
            ).ids,
          ).toEqual(["newer"]);
          expect(
            (
              await connection.sessions.changed({
                since: 0,
                parents: { kind: "all" },
                query: "OLD",
                limit: 10,
              })
            ).ids,
          ).toEqual(["older"]);
          expect(
            (await connection.sessions.pending({ kind: "receipt" })).map((ref) => ref.name),
          ).toEqual(["sessions/older/receipts/pending"]);
          expect(await connection.refs.list("")).toEqual(refs);

          for (const [index, record] of records.entries()) {
            expect(await connection.objects.get(asId(`object-${index}`))).toEqual(record.object);
          }
          await backend.store.close();
          const reopened = await backend.store.open();
          expect(await reopened.sessions.list({ parents: { kind: "all" }, limit: 10 })).toEqual(
            directory,
          );
          expect(await reopened.refs.list("")).toEqual(refs);
          expect((await reopened.sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
            "sessions/older",
          ]);
          expect(await backend.rows("SELECT version FROM store_meta WHERE id = 1")).toEqual([
            { version: STORE_VERSION },
          ]);
          expect(await canonical()).toEqual(before);
          expect((await backend.backups?.()) ?? []).toEqual([]);
        } finally {
          await backend.close();
        }
      },
    );
  });
}
