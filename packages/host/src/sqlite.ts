import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asSeq } from "@nyte-ai/schema";
import type { Ref, Seq, SessionId } from "@nyte-ai/schema";
import { blobId, objectId, STORE_MIGRATIONS } from "@nyte-ai/core";
import type { Store, StoreConnection, StoreMigration } from "@nyte-ai/core";
import {
  admits,
  collect,
  decodeEvent,
  decodeObject,
  eventsOf,
  memoryReader,
  mintRevision,
  numberOf,
  prefixEnd,
  refOf,
  sessionOf,
  textOf,
} from "./store-rows.ts";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)",
  "CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
  "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at INTEGER NOT NULL, rewritten INTEGER NOT NULL)",
];

const BUSY_TIMEOUT_MS = 5_000;

/** Returns a `Store` (`kind: "sqlite"`) over one `node:sqlite` `DatabaseSync`: a file at `path` (WAL mode, a busy timeout so a second process waits rather than fails) or an in-memory database, its tables created on first `open()`: `objects(id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)`, `refs(name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)`, `log(session TEXT, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY (session, seq))` and `migrations(name TEXT PRIMARY KEY, at INTEGER, rewritten INTEGER)`. Then each of core's `STORE_MIGRATIONS` the table does not list runs once, in one transaction: every ref's object the migration rewrites is stored under its new id and the ref repointed with a fresh revision, and the name is recorded with the count; a file store is first copied to `backups/<name>-<time>.db` beside it, before the first migration that applies. `put` ids the value with core's `objectId` and stores its JSON once; `putBlob` buffers the stream, ids it with `blobId` and stores the bytes once; an object and a blob that share an id share the row, each column filled once (§41f); `blob` reads the bytes back with their size and a null mime. `refs.set` is one `BEGIN IMMEDIATE` transaction: every `expect` is checked against the refs as they stood before the batch, as the memory store does, and the first that fails answers `stale { name, revision }` with nothing written; then the entries apply in order (a repeated name ends at its last entry; each entry mints a fresh random revision that is never reused; a null target deletes the row) and each event is appended to its session's log at the next seq under one `at`, an event on a ref outside `sessions/` throwing `SdkError("internal")` before anything is written; `seq` is the last one appended, else the tail of the first session named, else 0. `list(prefix)` reads the name range from `prefix` in name order; `log` returns the events after `after` in seq order up to `limit`, each validated as a `SessionEvent`; `tail` is the session's last seq, or 0. Every `open()` returns a connection over the one database; `close()` closes the database. */
export function sqliteStore(input: { readonly path: string } | { readonly memory: true }): Store {
  let database: DatabaseSync | null = null;
  let opening: Promise<StoreConnection> | null = null;

  const open = async (): Promise<StoreConnection> => {
    const created = new DatabaseSync("path" in input ? input.path : ":memory:", {
      timeout: BUSY_TIMEOUT_MS,
    });

    if ("path" in input) created.exec("PRAGMA journal_mode = WAL");
    created.exec("PRAGMA synchronous = NORMAL");

    for (const statement of SCHEMA) created.exec(statement);
    await migrate(created, "path" in input ? input.path : null);
    database = created;

    return connect(created);
  };

  return {
    kind: "sqlite",
    open() {
      opening ??= open();

      return opening;
    },
    async close() {
      database?.close();
      database = null;
      opening = null;
    },
  };
}

/** Applies each of core's store migrations the `migrations` table does not list, in order; a file store is backed up beside itself before the first that runs. */
async function migrate(database: DatabaseSync, path: string | null): Promise<void> {
  const applied = new Set(
    database
      .prepare("SELECT name FROM migrations")
      .all()
      .map((row) => textOf(row.name)),
  );

  const pending = STORE_MIGRATIONS.filter((migration) => !applied.has(migration.name));

  if (pending.length === 0) return;
  const empty = database.prepare("SELECT 1 FROM refs LIMIT 1").get() === undefined;

  if (path !== null && !empty) {
    const backups = join(dirname(path), "backups");
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    database.prepare("VACUUM INTO ?").run(join(backups, `${pending[0]?.name}-${stamp}.db`));
  }

  for (const migration of pending) await apply(database, migration);
}

/** Runs one migration over every ref's object in one transaction and records it. */
async function apply(database: DatabaseSync, migration: StoreMigration): Promise<void> {
  const refs = database.prepare("SELECT name, target FROM refs WHERE target IS NOT NULL").all();
  const getBody = database.prepare("SELECT body FROM objects WHERE id = ?");

  const putBody = database.prepare(
    "INSERT INTO objects (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
  );

  const repoint = database.prepare("UPDATE refs SET target = ?, revision = ? WHERE name = ?");
  const record = database.prepare("INSERT INTO migrations (name, at, rewritten) VALUES (?, ?, ?)");

  database.exec("BEGIN IMMEDIATE");

  try {
    let rewritten = 0;

    for (const row of refs) {
      const body = textOf(getBody.get(row.target)?.body);

      if (body === null) continue;
      const next = migration.rewrite(decodeObject(body));

      if (next === null) continue;
      const id = await objectId(next);
      putBody.run(id, JSON.stringify(next));
      repoint.run(id, mintRevision(), row.name);
      rewritten += 1;
    }

    record.run(migration.name, Date.now(), rewritten);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");

    throw error;
  }
}

function connect(database: DatabaseSync): StoreConnection {
  const putBody = database.prepare(
    "INSERT INTO objects (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
  );

  const putBytes = database.prepare(
    "INSERT INTO objects (id, bytes) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET bytes = excluded.bytes WHERE objects.bytes IS NULL",
  );

  const getBody = database.prepare("SELECT body FROM objects WHERE id = ?");
  const getBytes = database.prepare("SELECT bytes FROM objects WHERE id = ?");
  const getRef = database.prepare("SELECT name, target, revision FROM refs WHERE name = ?");
  const listAll = database.prepare("SELECT name, target, revision FROM refs ORDER BY name");

  const listRange = database.prepare(
    "SELECT name, target, revision FROM refs WHERE name >= ? AND name < ? ORDER BY name",
  );

  const putRef = database.prepare(
    "INSERT INTO refs (name, target, revision) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET target = excluded.target, revision = excluded.revision",
  );

  const deleteRef = database.prepare("DELETE FROM refs WHERE name = ?");
  const append = database.prepare("INSERT INTO log (session, seq, at, event) VALUES (?, ?, ?, ?)");

  const readLog = database.prepare(
    "SELECT seq, at, event FROM log WHERE session = ? AND seq > ? ORDER BY seq LIMIT ?",
  );

  const readTail = database.prepare("SELECT MAX(seq) AS tail FROM log WHERE session = ?");

  const tail = (session: SessionId): Seq => {
    const row = readTail.get(session);

    return asSeq(row?.tail === null || row?.tail === undefined ? 0 : numberOf(row.tail));
  };

  const ref = (name: string): Ref | null => {
    const row = getRef.get(name);

    return row === undefined ? null : refOf(row);
  };

  return {
    objects: {
      async put(object) {
        const id = await objectId(object);
        putBody.run(id, JSON.stringify(object));

        return id;
      },
      async get(id) {
        const body = textOf(getBody.get(id)?.body);

        return body === null ? null : decodeObject(body);
      },
      async putBlob(bytes) {
        const joined = await collect(bytes);
        const id = await blobId(joined);
        putBytes.run(id, joined);

        return id;
      },
      async blob(id) {
        const bytes = getBytes.get(id)?.bytes;

        return bytes instanceof Uint8Array ? memoryReader(bytes) : null;
      },
    },
    refs: {
      get: async (name) => ref(name),
      async list(prefix) {
        const end = prefixEnd(prefix);
        const rows = end === null ? listAll.all() : listRange.all(prefix, end);

        return rows.map(refOf);
      },
      async set(updates) {
        const logged = eventsOf(updates);

        database.exec("BEGIN IMMEDIATE");

        try {
          const before = new Map<string, Ref | undefined>();

          for (const update of updates)
            if (!before.has(update.name)) before.set(update.name, ref(update.name) ?? undefined);
          const stale = updates.find((update) => !admits(update, before.get(update.name)));

          if (stale !== undefined) {
            database.exec("ROLLBACK");

            return {
              kind: "stale",
              name: stale.name,
              revision: before.get(stale.name)?.revision ?? null,
            };
          }

          const revisions = updates.map((update) => {
            const revision = mintRevision();

            if (update.target === null) deleteRef.run(update.name);
            else putRef.run(update.name, update.target, revision);

            return revision;
          });

          const at = Date.now();
          const tails = new Map<SessionId, number>();

          const appended = logged.map(({ session, event }) => {
            const seq = (tails.get(session) ?? tail(session)) + 1;
            tails.set(session, seq);
            append.run(session, seq, at, JSON.stringify(event));

            return asSeq(seq);
          });

          const first = updates.map((update) => sessionOf(update.name)).find((id) => id !== null);
          const seq = appended.at(-1) ?? (first ? tail(first) : asSeq(0));
          database.exec("COMMIT");

          return { kind: "set", seq, revisions };
        } catch (error) {
          if (database.isTransaction) database.exec("ROLLBACK");

          throw error;
        }
      },
      async log(session, after, limit) {
        return readLog
          .all(session, after, limit)
          .map((row) => decodeEvent(numberOf(row.seq), numberOf(row.at), textOf(row.event) ?? ""));
      },
      tail: async (session) => tail(session),
    },
  };
}
