import { asSeq, SdkError } from "@nyte-ai/schema";
import type { ObjectId, Ref, Revision, Seq, SessionId, SetOutcome } from "@nyte-ai/schema";
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
import type { CommitOutcome, MigrationTarget } from "@nyte-ai/core/store";
import {
  collect,
  decodeEvent,
  loggedRow,
  memoryReader,
  mintRevision,
  numberOf,
  prefixEnd,
  refOf,
  storedRecordOf,
  textOf,
} from "./store-rows.ts";
import { sessionIndexChanges, sqlSessionIndex } from "./session-index.ts";

/** Returns one value Durable Object SQL binds and answers: text, a number, a blob as an `ArrayBuffer`, or null. */
export type SqlValue = ArrayBuffer | string | number | null;

/** Returns the part of a Durable Object's storage `durableObjectStore` uses, structurally, so a Worker passes `state.storage` as it is and a test passes a shim: `sql.exec` runs one statement with `?` bindings and answers its rows keyed by column name, and `transactionSync` runs a synchronous closure whose writes land all together or, when it throws, not at all (Durable Object SQL refuses `BEGIN`, so this is the only transaction). */
export type DurableObjectSql = {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
  };
  transactionSync<T>(closure: () => T): T;
};

const ROW_LIMIT = 2_000_000;

const encoder = new TextEncoder();

/** Returns a `Store` over a Durable Object's SQLite storage, node-free, with the sqlite store's tables, row helpers (`store-rows.ts`) and semantics (§41f): `objects(id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)`, `refs(name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)` and `log(session TEXT, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY (session, seq))`, brought to core's `STORE_VERSION` by `migrateStore` on first `open()`, each commit one `transactionSync` and no backup; the open rejects with `SdkError("unavailable")` for a store a newer Nyte migrated. `put` ids the value with core's `objectId` and stores its JSON once; `putBlob` buffers the stream, ids it with `blobId` and stores the bytes once as an `ArrayBuffer`; an object and a blob that share an id share the row, each column filled once; `blob` reads the bytes back with their size and a null mime; a body, blob or logged event past the Durable Object's 2 MB row limit throws `SdkError("invalid")` before anything is written (§42k). `refs.set` runs inside one `transactionSync` with no await between its reads and writes, first rejecting with `SdkError("unavailable")` when a newer Nyte has migrated the store, with `RefStore.set`'s semantics, each revision a random UUID, any throw inside rolling the whole batch back. `list(prefix)` reads the name range from `prefix` in name order; `log` returns the events after `after` in seq order up to `limit`, each validated as a `SessionEvent`; `tail` is the session's last seq, or 0. Every `open()` returns a connection over the one storage; `close()` releases nothing, the storage being the object's. In workerd, which allows code generation only while modules load, the Worker turns TypeBox acceleration off at startup (`Settings.Set({ useAcceleration: false })` from `typebox/system`, as `deploy/cloudflare/worker.ts` does), or `log`'s validation throws inside a request. */
export function durableObjectStore(storage: DurableObjectSql): Store {
  let connection: StoreConnection | null = null;

  return {
    async open() {
      if (connection !== null) return connection;

      await migrateStore(durableObjectTarget(storage));
      connection = connect(storage);

      return connection;
    },
    async close() {
      connection = null;
    },
  };
}

function storedVersion(storage: DurableObjectSql): number {
  const stamped = storage.sql
    .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_meta'")
    .toArray();

  if (stamped.length === 0) return 0;
  const version = storage.sql
    .exec("SELECT version FROM store_meta WHERE id = 1")
    .toArray()[0]?.version;

  return version === undefined ? 0 : numberOf(version);
}

function durableObjectTarget(storage: DurableObjectSql): MigrationTarget {
  const rows = (query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[] =>
    storage.sql.exec(query, ...bindings).toArray();

  return {
    dialect: "sqlite",
    async stamp() {
      const present =
        rows("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refs'").length > 0;

      return {
        version: storedVersion(storage),
        empty: !present || rows("SELECT 1 FROM refs LIMIT 1").length === 0,
      };
    },
    async records() {
      return rows(
        "SELECT refs.name, refs.target, refs.revision, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE objects.body IS NOT NULL",
      ).map(storedRecordOf);
    },
    async *logs() {
      if (rows("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'log'").length === 0)
        return;

      for (const row of rows("SELECT DISTINCT session FROM log")) {
        const session = textOf(row.session);

        if (session !== null)
          yield {
            session,
            events: rows("SELECT seq, event FROM log WHERE session = ? ORDER BY seq", session).map(
              loggedRow,
            ),
          };
      }
    },
    async commit(change) {
      return storage.transactionSync((): CommitOutcome => {
        if (storedVersion(storage) !== change.from) return "moved";

        const conflicted = change.repoints.some(
          (moved) =>
            rows("SELECT 1 FROM refs WHERE name = ? AND revision = ?", moved.name, moved.expect)
              .length === 0,
        );

        const relogged = change.relogs.every(
          (relog) =>
            rows(
              "SELECT 1 FROM log WHERE session = ? AND seq = ? AND event = ?",
              relog.session,
              relog.seq,
              relog.expect,
            ).length > 0,
        );

        if (conflicted || !relogged) return "conflict";

        for (const statement of change.sql) rows(statement);

        for (const moved of change.repoints) {
          rows(
            "INSERT INTO objects (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
            moved.id,
            moved.body,
          );
          rows(
            "UPDATE refs SET target = ?, revision = ? WHERE name = ?",
            moved.id,
            mintRevision(),
            moved.name,
          );
          updateSessionIndex(storage, moved.name, moved.id, mintRevision());
        }

        for (const created of change.creates) {
          const revision = mintRevision();

          if (
            rows(
              "INSERT INTO refs (name, target, revision) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING RETURNING name",
              created.name,
              created.target,
              revision,
            ).length > 0
          )
            updateSessionIndex(storage, created.name, created.target, revision);
        }

        for (const relog of change.relogs)
          rows(
            "UPDATE log SET event = ? WHERE session = ? AND seq = ?",
            relog.event,
            relog.session,
            relog.seq,
          );

        if (change.reindexSessions)
          for (const row of rows("SELECT name, target, revision FROM refs")) {
            const ref = refOf(row);
            updateSessionIndex(storage, ref.name, ref.target, ref.revision);
          }

        rows(
          "INSERT INTO store_meta (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version",
          change.to,
        );

        return "committed";
      });
    },
  };
}

function connect(storage: DurableObjectSql): StoreConnection {
  const rows = (query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[] =>
    storage.sql.exec(query, ...bindings).toArray();

  const tail = (session: SessionId): Seq => {
    const value = rows("SELECT MAX(seq) AS tail FROM log WHERE session = ?", session)[0]?.tail;

    return asSeq(value === null || value === undefined ? 0 : numberOf(value));
  };

  const ref = (name: string): Ref | null => {
    const row = rows("SELECT name, target, revision FROM refs WHERE name = ?", name)[0];

    return row === undefined ? null : refOf(row);
  };

  return {
    sessions: sqlSessionIndex(async (text, values) => rows(text, ...values)),
    objects: {
      async put(object) {
        const id = await objectId(object);
        const body = JSON.stringify(object);
        fits(encoder.encode(body).byteLength, `Object ${id}`);
        rows(
          "INSERT INTO objects (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
          id,
          body,
        );

        return id;
      },
      async get(id) {
        const body = textOf(rows("SELECT body FROM objects WHERE id = ?", id)[0]?.body);

        return body === null ? null : decodeObject(body);
      },
      async putBlob(bytes) {
        const joined = await collect(bytes);
        const id = await blobId(joined);
        fits(joined.byteLength, `Blob ${id}`);
        rows(
          "INSERT INTO objects (id, bytes) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET bytes = excluded.bytes WHERE objects.bytes IS NULL",
          id,
          joined.slice().buffer,
        );

        return id;
      },
      async blob(id) {
        const bytes = rows("SELECT bytes FROM objects WHERE id = ?", id)[0]?.bytes;

        return bytes instanceof ArrayBuffer ? memoryReader(new Uint8Array(bytes)) : null;
      },
    },
    refs: {
      get: async (name) => ref(name),
      async list(prefix) {
        const end = prefixEnd(prefix);

        const found =
          end === null
            ? rows("SELECT name, target, revision FROM refs WHERE name >= ? ORDER BY name", prefix)
            : rows(
                "SELECT name, target, revision FROM refs WHERE name >= ? AND name < ? ORDER BY name",
                prefix,
                end,
              );

        return found.map(refOf);
      },
      async set(updates) {
        const logged = collectSessionEvents(updates).map(({ session, event }) => {
          const text = JSON.stringify(event);
          fits(encoder.encode(text).byteLength, `An event on ${session}`);

          return { session, text };
        });

        return storage.transactionSync((): SetOutcome => {
          assertStoreVersion(storedVersion(storage));
          const before = new Map<string, Ref | undefined>();

          for (const update of updates)
            if (!before.has(update.name)) before.set(update.name, ref(update.name) ?? undefined);
          const fenced = fenceNames(updates).find((name) => ref(name) === null);

          if (fenced !== undefined) return { kind: "fenced", name: fenced };
          const stale = updates.find((update) => !admits(update, before.get(update.name)));

          if (stale !== undefined)
            return {
              kind: "stale",
              name: stale.name,
              revision: before.get(stale.name)?.revision ?? null,
            };

          const touched = new Map<SessionId, Revision>();
          const revisions = updates.map((update) => {
            const revision = mintRevision();

            if (update.target === null) rows("DELETE FROM refs WHERE name = ?", update.name);
            else
              rows(
                "INSERT INTO refs (name, target, revision) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET target = excluded.target, revision = excluded.revision",
                update.name,
                update.target,
                revision,
              );
            updateSessionIndex(storage, update.name, update.target, revision);
            const session = parseSessionRef(update.name);

            if (session !== null) touched.set(session, revision);

            return revision;
          });

          for (const [session, version] of touched)
            rows("UPDATE session_index SET version = ? WHERE session = ?", version, session);

          const at = Date.now();
          const tails = new Map<SessionId, number>();

          const appended = logged.map(({ session, text }) => {
            const seq = (tails.get(session) ?? tail(session)) + 1;
            tails.set(session, seq);
            rows(
              "INSERT INTO log (session, seq, at, event) VALUES (?, ?, ?, ?)",
              session,
              seq,
              at,
              text,
            );

            return asSeq(seq);
          });

          return { kind: "set", logged: appended, at, revisions };
        });
      },
      async log(session, after, limit) {
        return rows(
          "SELECT seq, at, event FROM log WHERE session = ? AND seq > ? ORDER BY seq LIMIT ?",
          session,
          after,
          limit,
        ).map((row) => decodeEvent(numberOf(row.seq), numberOf(row.at), textOf(row.event) ?? ""));
      },
      tail: async (session) => tail(session),
    },
  };
}

function updateSessionIndex(
  storage: DurableObjectSql,
  name: string,
  target: ObjectId | null,
  revision: Revision,
): void {
  if (sessionIndexRef(name) === null) return;
  const body =
    target === null
      ? null
      : textOf(
          storage.sql.exec("SELECT body FROM objects WHERE id = ?", target).toArray()[0]?.body,
        );

  for (const change of sessionIndexChanges(
    name,
    body === null ? null : decodeObject(body),
    revision,
  ))
    storage.sql.exec(change.text, ...change.values);
}

function fits(bytes: number, what: string): void {
  if (bytes > ROW_LIMIT)
    throw new SdkError(
      "invalid",
      `${what} is ${bytes} bytes, past the Durable Object store's 2 MB row limit.`,
    );
}
