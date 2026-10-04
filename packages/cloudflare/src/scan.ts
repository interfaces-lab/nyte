import { sessionId, type Nyte } from "@nyte-ai/core";
import type { SqliteConnection } from "@nyte-ai/core/store";

export function sqlScan(db: SqliteConnection) {
  db.exec(`CREATE TABLE IF NOT EXISTS nyte_alarm_scan (
    id INTEGER PRIMARY KEY CHECK (id = 1), session TEXT NOT NULL, head TEXT NOT NULL, due REAL
  ); INSERT OR IGNORE INTO nyte_alarm_scan VALUES (1, '', '', NULL);`);

  return {
    load() {
      const row = db.all("SELECT session, head, due FROM nyte_alarm_scan WHERE id = 1", [])[0];

      if (
        !row ||
        typeof row.session !== "string" ||
        typeof row.head !== "string" ||
        (row.due !== null && typeof row.due !== "number")
      )
        throw new TypeError("Invalid Nyte alarm cursor");

      return { session: row.session, head: row.head, due: row.due ?? undefined };
    },
    save(cursor: { session: string; head: string; due: number | undefined }) {
      db.run("UPDATE nyte_alarm_scan SET session = ?, head = ?, due = ? WHERE id = 1", [
        cursor.session,
        cursor.head,
        cursor.due ?? null,
      ]);
    },
    next(cursor: { session: string; head: string }): Parameters<Nyte["advance"]>[0] | undefined {
      const head = db.all(
        `SELECT head FROM (
        SELECT 'main' AS head
        UNION SELECT substr(name, 12) AS head FROM
          (SELECT name FROM refs WHERE session_id = ? AND name > ? AND name < 'refs/heads0' ORDER BY name LIMIT 1)
        UNION SELECT substr(name, 13) AS head FROM
          (SELECT name FROM refs WHERE session_id = ? AND name > ? AND name < 'refs/stacks0' ORDER BY name LIMIT 1)
        UNION SELECT substr(name, 12, instr(substr(name, 12), '/') - 1) AS head FROM refs
          WHERE session_id = ? AND name > 'refs/inbox/' AND name < 'refs/inbox0'
      ) WHERE head > ? ORDER BY head LIMIT 1`,
        [
          cursor.session,
          `refs/heads/${cursor.head}`,
          cursor.session,
          `refs/stacks/${cursor.head}`,
          cursor.session,
          cursor.head,
        ],
      )[0]?.head;

      if (cursor.session !== "" && typeof head === "string")
        return { sessionId: sessionId(cursor.session), head };

      const session = db.all("SELECT id FROM sessions WHERE id > ? ORDER BY id LIMIT 1", [
        cursor.session,
      ])[0]?.id;

      if (typeof session !== "string") return undefined;

      return this.next({ session, head: "" });
    },
  };
}
