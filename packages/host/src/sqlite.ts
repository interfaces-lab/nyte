import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { asSeq } from "@nyte-ai/schema";
import type { ObjectId, Ref, Revision, Seq, SessionId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import {
  admits,
  fenceNames,
  assertStoreVersion,
  blobId,
  decodeObject,
  collectSessionEvents,
  migrateStore,
  objectId,
  sessionIndexRef,
  parseSessionRef,
} from "@nyte-ai/core/store";
import type { Store, StoreConnection } from "@nyte-ai/core";
import type { MigrationTarget, Relog } from "@nyte-ai/core/store";
import {
  collect,
  decodeEvent,
  loggedRow,
  memoryReader,
  mintRevision,
  parseNumber,
  prefixEnd,
  parseRef,
  parseStoredObject,
  parseStoredRecord,
  parseText,
} from "./store-rows.ts";
import { sqliteWorkers } from "./sqlite-workers.ts";
import { sessionIndexChanges, sqlSessionIndex } from "./session-index.ts";
import { claimStore } from "./store-owner.ts";

const BUSY_TIMEOUT_MS = 5_000;

const BACKUPS_KEPT = 3;

const PUT_BODY =
  "INSERT INTO objects (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL";

/** Returns a `Store` over one `node:sqlite` `DatabaseSync`: a file at `path` (WAL mode, opened only by the process that `claimStore` makes its owner, so a second process rejects with `SdkError("unavailable")` before it reads or migrates the file) or an in-memory database. The first `open()` brings it to core's `STORE_VERSION` with `migrateStore` (core's `objects`, `refs`, `log` and `store_meta` tables; each commit one `BEGIN IMMEDIATE`), a file store whose migration rewrites records first saving those refs' rows (name, target, revision; objects are never deleted, so the rows restore them) to `backups/store-<time>-<pid>-<uuid>-v<from>-v<to>.json` beside it, keeping the newest three backups, and rejects with `SdkError("unavailable")` for a store a newer Nyte migrated; a `migrations` table an older Nyte left is kept and ignored. `put` ids the value with core's `objectId` and stores its JSON once; `putBlob` buffers the stream, ids it with `blobId` and stores the bytes once; an object and a blob that share an id share the row, each column filled once (§41f); `blob` reads the bytes back with their size and a null mime. `refs.set` is one `BEGIN IMMEDIATE` transaction with `RefStore.set`'s semantics, each revision a random UUID, that first rejects with `SdkError("unavailable")` when a newer Nyte has migrated the store since it opened. `list(prefix)` reads the name range from `prefix` in name order (BINARY, by code point); `log` returns the events after `after` in seq order up to `limit`, each validated as a `SessionEvent`; `tail` is the session's last seq, or 0; `commitMark` is the writer connection's `PRAGMA data_version`, which moves only for another connection's commit. `checkpoints` keeps one fold checkpoint per session in `fold_checkpoints`, a write at a lower seq leaving the kept one, and `gap` counts a session's events past a seq and sums their UTF-8 bytes. File stores run `list` and `log` on a read-only worker and WAL checkpoints on a separate worker, checking at 1,000 frames and after 100 ms idle with a 10,000-frame writer backstop; unavailable workers warn and fall back to the main connection. Checkpoints use fullfsync on macOS, WAL reuse retains at most 32 MiB, and opening refreshes planner statistics. Writes binding more than 64 KiB use uncached statements. Every `open()` returns a connection over the one writer; `close()` waits for opening and worker shutdown before closing it, and an open during close waits to reopen. */
export function sqliteStore(input: { readonly path: string } | { readonly memory: true }): Store {
  let database: DatabaseSync | null = null;
  let opening: Promise<StoreConnection> | null = null;
  let closing: Promise<void> | null = null;
  let workers: ReturnType<typeof sqliteWorkers> | null = null;
  let release: (() => void) | null = null;

  const open = async (): Promise<StoreConnection> => {
    const claim = "path" in input ? claimStore(input.path) : null;
    let created: DatabaseSync | undefined;

    try {
      created = new DatabaseSync("path" in input ? input.path : ":memory:", {
        timeout: BUSY_TIMEOUT_MS,
      });

      if ("path" in input) created.exec("PRAGMA journal_mode = WAL");
      created.exec("PRAGMA synchronous = NORMAL");
      created.exec("PRAGMA checkpoint_fullfsync = ON");
      created.exec("PRAGMA journal_size_limit = 33554432");

      await migrateStore(sqliteTarget(created, "path" in input ? input.path : null));
      created.exec("PRAGMA optimize = 0x10012");
    } catch (error) {
      created?.close();
      claim?.();

      throw error;
    }

    database = created;
    release = claim;
    workers = "path" in input ? sqliteWorkers(created, input.path) : null;

    return connect(created, workers);
  };

  const connection = (): Promise<StoreConnection> => {
    if (closing !== null) return closing.then(connection);
    opening ??= open().catch((error: unknown) => {
      opening = null;

      throw error;
    });

    return opening;
  };

  return {
    open: connection,
    close() {
      closing ??= (async () => {
        await opening?.catch(() => undefined);
        await workers?.close();
        database?.close();
        release?.();
        workers = null;
        database = null;
        release = null;
        opening = null;
      })().finally(() => {
        closing = null;
      });

      return closing;
    },
  };
}

function hasTable(database: DatabaseSync, name: string): boolean {
  return (
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function storedVersion(database: DatabaseSync): number {
  if (!hasTable(database, "store_meta")) return 0;
  const row = database.prepare("SELECT version FROM store_meta WHERE id = 1").get();

  return row === undefined ? 0 : parseNumber(row.version);
}

function sqliteTarget(database: DatabaseSync, path: string | null): MigrationTarget {
  const target: MigrationTarget = {
    dialect: "sqlite",
    async stamp() {
      return {
        version: storedVersion(database),
        empty:
          !hasTable(database, "refs") ||
          database.prepare("SELECT 1 FROM refs LIMIT 1").get() === undefined,
      };
    },
    async records() {
      return database
        .prepare(
          "SELECT refs.name, refs.target, refs.revision, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE objects.body IS NOT NULL",
        )
        .all()
        .map(parseStoredRecord);
    },
    async *objects(kind) {
      yield* database
        .prepare("SELECT id, body FROM objects WHERE body IS NOT NULL AND instr(body, ?) > 0")
        .all(`"kind":${JSON.stringify(kind)}`)
        .map(parseStoredObject);
    },
    async *logs() {
      if (!hasTable(database, "log")) return;
      const read = database.prepare("SELECT seq, event FROM log WHERE session = ? ORDER BY seq");

      for (const row of database.prepare("SELECT DISTINCT session FROM log").all()) {
        const session = parseText(row.session);

        if (session !== null) yield { session, events: read.all(session).map(loggedRow) };
      }
    },
    async commit(change) {
      database.exec("BEGIN IMMEDIATE");

      try {
        if (storedVersion(database) !== change.from) {
          database.exec("ROLLBACK");

          return "moved";
        }

        for (const statement of change.sql) database.exec(statement);
        const putBody = database.prepare(PUT_BODY);

        const repoint = database.prepare(
          "UPDATE refs SET target = ?, revision = ? WHERE name = ? AND revision = ?",
        );

        for (const moved of change.repoints) {
          write(database, putBody, moved.id, moved.body);

          if (
            Number(repoint.run(moved.id, mintRevision(), moved.name, moved.expect).changes) === 0
          ) {
            database.exec("ROLLBACK");

            return "conflict";
          }
          updateSessionIndex(database, moved.name, moved.id, mintRevision());
        }

        const create = database.prepare(
          "INSERT INTO refs (name, target, revision) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING",
        );

        for (const created of change.creates) {
          write(database, putBody, created.target, created.body);
          const revision = mintRevision();

          if (Number(create.run(created.name, created.target, revision).changes) > 0)
            updateSessionIndex(database, created.name, created.target, revision);
        }

        const relog = database.prepare(
          "UPDATE log SET event = ? WHERE session = ? AND seq = ? AND event = ?",
        );

        for (const row of change.relogs) {
          if (Number(relog.run(row.event, row.session, row.seq, row.expect).changes) === 0) {
            database.exec("ROLLBACK");

            return "conflict";
          }
        }

        if (change.reindexSessions)
          for (const row of database.prepare("SELECT name, target, revision FROM refs").all()) {
            const ref = parseRef(row);
            updateSessionIndex(database, ref.name, ref.target, ref.revision);
          }

        database
          .prepare(
            "INSERT INTO store_meta (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version",
          )
          .run(change.to);
        database.exec("COMMIT");

        return "committed";
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");

        throw error;
      }
    },
  };

  if (path === null) return target;

  return {
    ...target,
    backup: async (from, to, names, log) => backup(database, path, from, to, names, log),
  };
}

function backup(
  database: DatabaseSync,
  path: string,
  from: number,
  to: number,
  names: readonly string[],
  log: readonly Relog[],
): void {
  const folder = join(dirname(path), "backups");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const at = new Date().toISOString().replaceAll(":", "-");
  const read = database.prepare("SELECT name, target, revision FROM refs WHERE name = ?");

  const rows = names.flatMap((name) => {
    const row = read.get(name);

    return row === undefined ? [] : [parseRef(row)];
  });

  writeFileSync(
    join(folder, `store-${at}-${process.pid}-${crypto.randomUUID()}-v${from}-v${to}.json`),
    JSON.stringify({
      refs: rows,
      log: log.map((row) => ({ session: row.session, seq: row.seq, event: row.expect })),
    }),
    { mode: 0o600 },
  );

  const copies = readdirSync(folder)
    .filter((file) => /^store-.+-v\d+-v\d+\.(?:db|json)$/u.test(file))
    .sort();

  for (const file of copies.slice(0, -BACKUPS_KEPT)) rmSync(join(folder, file), { force: true });
}

function connect(
  database: DatabaseSync,
  workers: ReturnType<typeof sqliteWorkers> | null,
): StoreConnection {
  const putBody = database.prepare(PUT_BODY);

  const putBytes = database.prepare(
    "INSERT INTO objects (id, bytes) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET bytes = excluded.bytes WHERE objects.bytes IS NULL",
  );

  const getBody = database.prepare("SELECT body FROM objects WHERE id = ?");
  const getBytes = database.prepare("SELECT bytes FROM objects WHERE id = ?");
  const getRef = database.prepare("SELECT name, target, revision FROM refs WHERE name = ?");

  const listFrom = database.prepare(
    "SELECT name, target, revision FROM refs WHERE name >= ? ORDER BY name",
  );

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

  const readCheckpoint = database.prepare(
    "SELECT seq, body FROM fold_checkpoints WHERE session = ?",
  );

  const writeCheckpoint = database.prepare(
    "INSERT INTO fold_checkpoints (session, seq, body) VALUES (?, ?, ?) ON CONFLICT (session) DO UPDATE SET seq = excluded.seq, body = excluded.body WHERE excluded.seq >= fold_checkpoints.seq",
  );

  const readGap = database.prepare(
    "SELECT COUNT(*) AS events, COALESCE(SUM(LENGTH(CAST(event AS BLOB))), 0) AS bytes FROM log WHERE session = ? AND seq > ?",
  );
  const readVersion = database.prepare("SELECT version FROM store_meta WHERE id = 1");
  const readDataVersion = database.prepare("PRAGMA data_version");

  const read = async (statement: StatementSync, ...params: SQLInputValue[]) =>
    (await workers?.read(statement.sourceSQL, params)) ?? statement.all(...params);

  const tail = (session: SessionId): Seq => {
    const row = readTail.get(session);

    return asSeq(row?.tail === null || row?.tail === undefined ? 0 : parseNumber(row.tail));
  };

  const ref = (name: string): Ref | null => {
    const row = getRef.get(name);

    return row === undefined ? null : parseRef(row);
  };

  return {
    commitMark: async () => parseNumber(readDataVersion.get()?.data_version),
    sessions: sqlSessionIndex(
      async (text, values) =>
        (await workers?.read(text, values)) ?? database.prepare(text).all(...values),
    ),
    objects: {
      async put(object) {
        const id = await objectId(object);
        write(database, putBody, id, JSON.stringify(object));
        workers?.check();

        return id;
      },
      async get(id) {
        const body = parseText(getBody.get(id)?.body);

        return body === null ? null : decodeObject(body);
      },
      async putBlob(bytes) {
        const joined = await collect(bytes);
        const id = await blobId(joined);
        write(database, putBytes, id, joined);
        workers?.check();

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

        const rows =
          end === null ? await read(listFrom, prefix) : await read(listRange, prefix, end);

        return rows.map(parseRef);
      },
      async set(updates) {
        const logged = collectSessionEvents(updates);

        const waiting = performance.now();
        database.exec("BEGIN IMMEDIATE");
        const acquired = performance.now();

        try {
          assertStoreVersion(parseNumber(readVersion.get()?.version ?? 0));
          const before = new Map<string, Ref | undefined>();

          for (const update of updates)
            if (!before.has(update.name)) before.set(update.name, ref(update.name) ?? undefined);
          const fenced = fenceNames(updates).find((name) => ref(name) === null);

          if (fenced !== undefined) {
            database.exec("ROLLBACK");

            return { kind: "fenced", name: fenced };
          }

          const stale = updates.find((update) => !admits(update, before.get(update.name)));

          if (stale !== undefined) {
            database.exec("ROLLBACK");

            return {
              kind: "stale",
              name: stale.name,
              revision: before.get(stale.name)?.revision ?? null,
            };
          }

          const touched = new Map<SessionId, Revision>();
          const revisions = updates.map((update) => {
            const revision = mintRevision();

            if (update.target === null) deleteRef.run(update.name);
            else putRef.run(update.name, update.target, revision);
            updateSessionIndex(database, update.name, update.target, revision);
            const session = parseSessionRef(update.name);

            if (session !== null) touched.set(session, revision);

            return revision;
          });

          for (const [session, version] of touched)
            database
              .prepare("UPDATE session_index SET version = ? WHERE session = ?")
              .run(version, session);

          const at = Date.now();
          const tails = new Map<SessionId, number>();

          const appended = logged.map(({ session, event }) => {
            const seq = (tails.get(session) ?? tail(session)) + 1;
            tails.set(session, seq);
            write(database, append, session, seq, at, JSON.stringify(event));

            return asSeq(seq);
          });

          database.exec("COMMIT");
          workers?.check();

          return { kind: "set", logged: appended, at, revisions };
        } catch (error) {
          if (database.isTransaction) database.exec("ROLLBACK");

          throw error;
        } finally {
          dev("sqlite", "transaction", {
            connection: "writer",
            lockWaitMs: acquired - waiting,
            executionMs: performance.now() - acquired,
          });
        }
      },
      async log(session, after, limit) {
        return (await read(readLog, session, after, limit)).map((row) =>
          decodeEvent(parseNumber(row.seq), parseNumber(row.at), parseText(row.event) ?? ""),
        );
      },
      tail: async (session) => tail(session),
    },
    checkpoints: {
      async read(session) {
        const [row] = await read(readCheckpoint, session);
        const body = parseText(row?.body);

        return row === undefined || body === null
          ? null
          : { seq: asSeq(parseNumber(row.seq)), body };
      },
      async write(session, checkpoint) {
        write(database, writeCheckpoint, session, checkpoint.seq, checkpoint.body);
        workers?.check();
      },
      async gap(session, after) {
        const [row] = await read(readGap, session, after);

        return { events: parseNumber(row?.events ?? 0), bytes: parseNumber(row?.bytes ?? 0) };
      },
    },
  };
}

function updateSessionIndex(
  database: DatabaseSync,
  name: string,
  target: ObjectId | null,
  revision: Revision,
): void {
  if (sessionIndexRef(name) === null) return;
  const body =
    target === null
      ? null
      : parseText(database.prepare("SELECT body FROM objects WHERE id = ?").get(target)?.body);

  for (const change of sessionIndexChanges(
    name,
    body === null ? null : decodeObject(body),
    revision,
  ))
    database.prepare(change.text).run(...change.values);
}

function write(database: DatabaseSync, statement: StatementSync, ...params: SQLInputValue[]) {
  const size = params.reduce<number>(
    (total, value) =>
      total +
      (typeof value === "string" ? value.length : ArrayBuffer.isView(value) ? value.byteLength : 0),
    0,
  );

  return (size > 64 * 1024 ? database.prepare(statement.sourceSQL) : statement).run(...params);
}
