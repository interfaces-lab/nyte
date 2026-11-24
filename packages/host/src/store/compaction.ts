import type { DatabaseSync } from "node:sqlite";
import { setImmediate, setTimeout } from "node:timers/promises";
import { dev } from "@nyte-ai/core";
import { BLOB_LIMIT } from "@nyte-ai/core/store";
import { parseText } from "./rows.ts";

const SUPERSEDED_KINDS = [
  "call",
  "changes",
  "inbox",
  "job",
  "kv",
  "lease",
  "message",
  "part",
  "process",
  "receipt",
  "run",
  "seen",
  "session",
  "workspace",
];

const START_DELAY_MS = 30_000;

const WORKING_MS = 60 * 60_000;

const BATCH_ROWS = 1000;

const REMOVE_BATCH = `DELETE FROM objects WHERE rowid > ?1 AND rowid <= ?2
  AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.target = objects.id)
  AND (
    (bytes IS NULL AND json_extract(body, '$.at') < ?3
      AND json_extract(body, '$.kind') IN (${SUPERSEDED_KINDS.map((kind) => `'${kind}'`).join(", ")}))
    OR (body IS NULL AND length(bytes) > ${BLOB_LIMIT})
  )`;

const FIRST_RECENT =
  "SELECT min(rowid) AS recent FROM objects WHERE rowid > ?1 AND rowid <= ?2 AND json_extract(body, '$.at') >= ?3";

type WriteLock = <T>(attempt: () => T) => T | Promise<T>;

const FREE_PAGES_BATCH = 256;

const REMOVED_SESSIONS = `SELECT t.session FROM (SELECT session, MAX(seq) AS seq FROM log GROUP BY session) t
  JOIN log l ON l.session = t.session AND l.seq = t.seq
  WHERE l.at < ?1 AND NOT ${ownsRefs("t.session")}`;

const PURGE_BATCH = `DELETE FROM log WHERE session = ?1
  AND seq IN (SELECT seq FROM log WHERE session = ?1 ORDER BY seq LIMIT ${String(BATCH_ROWS)})
  AND (SELECT at FROM log WHERE session = ?1 ORDER BY seq DESC LIMIT 1) < ?2
  AND NOT ${ownsRefs("?1")}`;

const DROP_CHECKPOINTS = `DELETE FROM fold_checkpoints
  WHERE NOT EXISTS (SELECT 1 FROM log WHERE log.session = fold_checkpoints.session)
  AND NOT ${ownsRefs("fold_checkpoints.session")}`;

export async function compactStore(
  database: DatabaseSync,
  signal: AbortSignal,
  lock: WriteLock,
  written: () => void,
): Promise<void> {
  await setTimeout(START_DELAY_MS, undefined, { signal });
  const remove = database.prepare(REMOVE_BATCH);
  const firstRecent = database.prepare(FIRST_RECENT);
  const readLast = database.prepare("SELECT COALESCE(MAX(rowid), 0) AS last FROM objects");
  const dropCheckpoints = database.prepare(DROP_CHECKPOINTS);

  for (;;) {
    const cutoff = Date.now() - WORKING_MS;
    const start = Number(database.prepare("PRAGMA user_version").get()?.user_version);
    const last = Number(readLast.get()?.last);
    let through = start;
    let removed = 0;

    while (through < last) {
      const from = through;
      const to = Math.min(from + BATCH_ROWS, last);
      removed += Number((await lock(() => remove.run(from, to, cutoff))).changes);
      written();
      const recent = firstRecent.get(from, to, cutoff)?.recent;

      if (recent !== null && recent !== undefined) {
        through = Number(recent) - 1;
        break;
      }

      through = to;
      await setImmediate(undefined, { signal });
    }

    const watermark = Math.min(through, Number(readLast.get()?.last));

    if (watermark !== start) {
      await lock(() => database.exec(`PRAGMA user_version = ${String(watermark)}`));
    }
    const purged = await purgeRemovedSessions(database, signal, lock, written, cutoff);
    const checkpoints = Number((await lock(() => dropCheckpoints.run())).changes);
    written();
    const released = await releaseFreePages(database, signal, lock, written);
    dev("sqlite", "compacted", { removed, through: watermark, purged, checkpoints, released });
    await setTimeout(WORKING_MS, undefined, { signal, ref: false });
  }
}

async function purgeRemovedSessions(
  database: DatabaseSync,
  signal: AbortSignal,
  lock: WriteLock,
  written: () => void,
  cutoff: number,
): Promise<number> {
  const purge = database.prepare(PURGE_BATCH);

  const sessions = database
    .prepare(REMOVED_SESSIONS)
    .all(cutoff)
    .flatMap((row) => parseText(row.session) ?? []);

  let purged = 0;

  for (const session of sessions) {
    for (;;) {
      const changes = Number((await lock(() => purge.run(session, cutoff))).changes);
      written();

      if (changes === 0) break;
      purged += changes;
      await setImmediate(undefined, { signal });
    }
  }

  return purged;
}

async function releaseFreePages(
  database: DatabaseSync,
  signal: AbortSignal,
  lock: WriteLock,
  written: () => void,
): Promise<number> {
  if (Number(database.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum) !== 2) return 0;
  const readFree = database.prepare("PRAGMA freelist_count");
  const free = (): number => Number(readFree.get()?.freelist_count);
  const before = free();

  for (
    let batches = Math.ceil(before / FREE_PAGES_BATCH);
    batches > 0 && free() > 0;
    batches -= 1
  ) {
    await lock(() => database.exec(`PRAGMA incremental_vacuum(${String(FREE_PAGES_BATCH)})`));
    written();
    await setImmediate(undefined, { signal });
  }

  return before - free();
}

function ownsRefs(session: string): string {
  return `EXISTS (SELECT 1 FROM refs WHERE name = 'sessions/' || ${session}
    OR (name >= 'sessions/' || ${session} || '/' AND name < 'sessions/' || ${session} || '0'))`;
}
