import type { DatabaseSync } from "node:sqlite";
import { setImmediate, setTimeout } from "node:timers/promises";
import { dev } from "@nyte-ai/core";
import { BLOB_LIMIT } from "@nyte-ai/core/store";

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

const BATCH_ROWS = 1_000;

const REMOVE_BATCH = `DELETE FROM objects WHERE rowid > ?1 AND rowid <= ?2
  AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.target = objects.id)
  AND (
    (bytes IS NULL AND json_extract(body, '$.at') < ?3
      AND json_extract(body, '$.kind') IN (${SUPERSEDED_KINDS.map((kind) => `'${kind}'`).join(", ")}))
    OR (body IS NULL AND length(bytes) > ${BLOB_LIMIT})
  )`;

const FIRST_RECENT =
  "SELECT min(rowid) AS recent FROM objects WHERE rowid > ?1 AND rowid <= ?2 AND json_extract(body, '$.at') >= ?3";

export async function compactStore(
  database: DatabaseSync,
  signal: AbortSignal,
  lock: <T>(attempt: () => T) => T | Promise<T>,
  written: () => void,
): Promise<void> {
  await setTimeout(START_DELAY_MS, undefined, { signal });
  const remove = database.prepare(REMOVE_BATCH);
  const firstRecent = database.prepare(FIRST_RECENT);
  const readLast = database.prepare("SELECT COALESCE(MAX(rowid), 0) AS last FROM objects");

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

    if (watermark !== start)
      await lock(() => database.exec(`PRAGMA user_version = ${String(watermark)}`));
    dev("sqlite", "compacted", { removed, through: watermark });
    await setTimeout(WORKING_MS, undefined, { signal, ref: false });
  }
}
