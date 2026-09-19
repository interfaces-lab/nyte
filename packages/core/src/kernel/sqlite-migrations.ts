/**
 * Forward migrations for a `node:sqlite` store, keyed by the schema version
 * each upgrades from.
 */
import { stampRunFailure } from "./migrations.ts";
import { numberColumn, sql, stringColumn, type SqliteConnection } from "./sql.ts";

function stampRunFailures(db: SqliteConnection): void {
  const rows = sql`SELECT session_id, oid, body, at FROM objects
    WHERE kind = 'run' AND json_type(body, '$.phase.error') = 'text'`.all(db);
  for (const row of rows) {
    const sessionId = stringColumn(row, "session_id");
    const oid = stringColumn(row, "oid");
    const next = stampRunFailure(oid, stringColumn(row, "body"));
    sql`INSERT OR IGNORE INTO objects (session_id, oid, kind, body, at)
      VALUES (${sessionId}, ${next.oid}, 'run', ${next.body}, ${numberColumn(row, "at")})`.run(db);
    sql`UPDATE refs SET oid = ${next.oid} WHERE session_id = ${sessionId} AND oid = ${oid}`.run(db);
    sql`DELETE FROM objects WHERE session_id = ${sessionId} AND oid = ${oid}`.run(db);
  }
}

export const MIGRATIONS: ReadonlyMap<number, (db: SqliteConnection) => void> = new Map([
  [2, stampRunFailures],
]);
