import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";

/**
 * One-off compaction of a local Nyte store. Run it with Nyte quit:
 *
 *   node scripts/compact-store.ts [store] [--apply] [--blob-limit <MiB>]
 *
 * Without `--apply` it only reports. With it, it deletes in one write transaction
 * the objects of these kinds that no ref targets and no migration backup
 * (`<store dir>/backups/store-*.json`) names, since core reads such a record only
 * through a ref's current target, and every blob over `--blob-limit` (default
 * 32 MiB), which a message or tool result then shows as "no longer stored".
 * Commits stay: heads, parents, positions and moves name them by id. Then it
 * runs VACUUM.
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

/** Version 15 holds `2026-10-16-ended-run-records`, the only migration that reads objects no ref targets. */
const OLDEST_VERSION = 15;

const NEWEST_VERSION = 24;

// Two of the host's 5 s presence beats, plus slack.
const PRESENCE_WAIT_MS = 11_000;

const BATCH = 5_000;

const MIB = 1024 * 1024;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    "blob-limit": { type: "string", default: "32" },
  },
});

const path = positionals[0] ?? process.env["NYTE_DB"] ?? join(homedir(), ".nyte", "nyte.db");

const blobLimit = Number(values["blob-limit"]) * MIB;

const apply = values.apply;

if (!existsSync(path)) fail(`${path} does not exist.`);

if (!Number.isFinite(blobLimit) || blobLimit <= 0) fail("--blob-limit takes a size in MiB.");

const database = new DatabaseSync(path, { readOnly: !apply, timeout: 5_000 });

const version = Number(
  database.prepare("SELECT version FROM store_meta WHERE id = 1").get()?.version,
);

if (!(version >= OLDEST_VERSION && version <= NEWEST_VERSION))
  fail(
    `${path} is at store version ${version}; this script handles ${OLDEST_VERSION} to ${NEWEST_VERSION}.`,
  );

const sizeBefore = storeSize(path);

console.log(`${path}: ${megabytes(sizeBefore)} on disk, store version ${version}.`);

console.log("Checking that no Nyte host is using the store…");

const beats = processBeats();

await setTimeout(PRESENCE_WAIT_MS);

const moved = changedBeats(beats);

if (moved.length > 0) {
  const message = `A Nyte host is using this store (${moved.join(", ")}). Quit Nyte and run this again.`;

  if (apply) fail(message);
  console.log(`Warning: ${message} The report below is a snapshot.`);
}

if (beats.size > 0 && moved.length === 0)
  console.log(`${beats.size} process refs are left from hosts that are no longer running.`);

const backups = migrationBackups(join(dirname(path), "backups"));

database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");

if (apply && changedBeats(beats).length > 0) {
  database.exec("ROLLBACK");
  fail("A Nyte host started while this ran. Quit Nyte and run this again.");
}

database.exec("CREATE TEMP TABLE kept (id TEXT PRIMARY KEY) WITHOUT ROWID");

database.exec("INSERT OR IGNORE INTO kept SELECT target FROM refs WHERE target IS NOT NULL");

const keep = database.prepare(
  "INSERT OR IGNORE INTO kept SELECT json_extract(value, '$.target') FROM json_each(?, '$.refs') WHERE json_extract(value, '$.target') IS NOT NULL",
);

for (const backup of backups) keep.run(backup);

database.exec(
  "CREATE TEMP TABLE doomed (n INTEGER PRIMARY KEY, id TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL)",
);

database
  .prepare(
    `INSERT INTO doomed (id, kind, size)
     SELECT id, kind, size FROM (
       SELECT id, json_extract(body, '$.kind') AS kind, length(CAST(body AS BLOB)) AS size
       FROM objects WHERE body IS NOT NULL AND bytes IS NULL
     )
     WHERE kind IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT id FROM kept)`,
  )
  .run(JSON.stringify(SUPERSEDED_KINDS));

database
  .prepare(
    `INSERT INTO doomed (id, kind, size)
     SELECT id, 'blob', length(bytes) FROM objects
     WHERE body IS NULL AND length(bytes) > ? AND id NOT IN (SELECT id FROM kept)`,
  )
  .run(blobLimit);

const summary = database
  .prepare(
    "SELECT kind, COUNT(*) AS count, SUM(size) AS size FROM doomed GROUP BY kind ORDER BY size DESC",
  )
  .all();

console.log(apply ? "Deleting:" : "Would delete:");

for (const row of summary)
  console.log(
    `  ${String(row.kind).padEnd(10)} ${String(row.count).padStart(8)}  ${megabytes(Number(row.size))}`,
  );

for (const row of database
  .prepare(
    "SELECT doomed.id, doomed.size, CAST(substr(objects.bytes, 1, 80) AS TEXT) AS head FROM doomed JOIN objects ON objects.id = doomed.id WHERE doomed.kind = 'blob'",
  )
  .all())
  console.log(
    `  blob ${String(row.id)} (${megabytes(Number(row.size))}): ${JSON.stringify(String(row.head))}`,
  );

const total = database
  .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS size FROM doomed")
  .get();

console.log(`  total      ${String(total?.count).padStart(8)}  ${megabytes(Number(total?.size))}`);

if (!apply) {
  database.exec("ROLLBACK");
  database.close();
  console.log(
    "Nothing changed. Run again with --apply, with Nyte quit, to delete these and VACUUM.",
  );
  process.exit(0);
}

const remove = database.prepare(
  "DELETE FROM objects WHERE id IN (SELECT id FROM doomed WHERE n > ? AND n <= ?)",
);

const last = Number(database.prepare("SELECT COALESCE(MAX(n), 0) AS n FROM doomed").get()?.n);

for (let from = 0; from < last; from += BATCH) remove.run(from, from + BATCH);

database.exec("COMMIT");

console.log("Deleted. Running VACUUM…");

database.exec("PRAGMA wal_checkpoint(TRUNCATE)");

database.exec("VACUUM");

database.exec("PRAGMA wal_checkpoint(TRUNCATE)");

database.close();

const sizeAfter = storeSize(path);

console.log(`${megabytes(sizeBefore)} → ${megabytes(sizeAfter)} on disk.`);

/** Each process ref's revision; a running host rewrites its own every 5 s. */
function processBeats(): Map<string, string> {
  return new Map(
    database
      .prepare("SELECT name, revision FROM refs WHERE name >= 'processes/' AND name < 'processes0'")
      .all()
      .map((row) => [String(row.name), String(row.revision)]),
  );
}

function changedBeats(before: ReadonlyMap<string, string>): readonly string[] {
  return [...processBeats()].flatMap(([name, revision]) =>
    before.get(name) === revision ? [] : [name],
  );
}

/** The host's migration backups, whose `refs` name the targets restoring one needs. */
function migrationBackups(folder: string): readonly string[] {
  if (!existsSync(folder)) return [];

  return readdirSync(folder)
    .filter((file) => /^store-.+-v\d+-v\d+\.json$/u.test(file))
    .map((file) => readFileSync(join(folder, file), "utf8"));
}

function storeSize(file: string): number {
  return ["", "-wal", "-shm"].reduce(
    (total, suffix) => total + (existsSync(file + suffix) ? statSync(file + suffix).size : 0),
    0,
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
