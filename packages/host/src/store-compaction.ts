import type { DatabaseSync } from "node:sqlite";
import { setImmediate, setTimeout } from "node:timers/promises";
import { dev } from "@nyte-ai/core";
import { BLOB_LIMIT } from "@nyte-ai/core/store";

/**
 * Record kinds core reads only through a ref's current target. Releases before
 * `refs.set` dropped the record a ref moved off kept every copy; a copy of
 * these kinds that no ref targets is one of those. Commits stay: heads,
 * parents, positions and moves name them by id.
 */
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

/** `PRAGMA user_version` once this store's copies are gone. SQLite stores start at 0. */
const COMPACTED = 1;

/** Leaves startup reads alone. */
const START_DELAY_MS = 30_000;

/** A record this recent may belong to a chat that is working now, between writing it and pointing a ref at it. */
const WORKING_MS = 60 * 60_000;

/** Rows per delete, so another process's write waits on one short statement. */
const BATCH_ROWS = 1_000;

const REMOVE_BATCH = `DELETE FROM objects WHERE rowid > ?1 AND rowid <= ?2
  AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.target = objects.id)
  AND (
    (bytes IS NULL AND json_extract(body, '$.at') < ?3
      AND json_extract(body, '$.kind') IN (${SUPERSEDED_KINDS.map((kind) => `'${kind}'`).join(", ")}))
    OR (body IS NULL AND length(bytes) > ${BLOB_LIMIT})
  )`;

/**
 * Deletes, once per store and in the background, the record copies no ref
 * targets and the files over `BLOB_LIMIT`, which `putBlob` now refuses and no
 * reader returns. Each batch is its own statement, and records written in the
 * last hour stay, so chats keep working while it runs. An interrupted run
 * starts over at the next open. Freed pages are reused; the file keeps its size.
 */
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
