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

const COMPACTED = 1;

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

export async function compactStore(
  database: DatabaseSync,
  signal: AbortSignal,
  written: () => void,
): Promise<void> {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= COMPACTED) return;
  await setTimeout(START_DELAY_MS, undefined, { signal });

  const cutoff = Date.now() - WORKING_MS;

  const last = Number(
    database.prepare("SELECT COALESCE(MAX(rowid), 0) AS last FROM objects").get()?.last,
  );

  const remove = database.prepare(REMOVE_BATCH);
  let removed = 0;

  for (let from = 0; from < last; from += BATCH_ROWS) {
    removed += Number(remove.run(from, from + BATCH_ROWS, cutoff).changes);
    written();
    await setImmediate(undefined, { signal });
  }

  database.exec(`PRAGMA user_version = ${COMPACTED}`);
  dev("sqlite", "compacted", { removed });
}
