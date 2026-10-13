import { asSeq } from "@nyte-ai/schema";
import type { Ref, Seq, SessionId, SetOutcome } from "@nyte-ai/schema";
import { SdkError, blobId, objectId } from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
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

/** Returns one value Durable Object SQL binds and answers: text, a number, a blob as an `ArrayBuffer`, or null. */
export type SqlValue = ArrayBuffer | string | number | null;

/** Returns the part of a Durable Object's storage `durableObjectStore` uses, structurally, so a Worker passes `state.storage` as it is and a test passes a shim: `sql.exec` runs one statement with `?` bindings and answers its rows keyed by column name, and `transactionSync` runs a synchronous closure whose writes land all together or, when it throws, not at all (Durable Object SQL refuses `BEGIN`, so this is the only transaction). */
export type DurableObjectSql = {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
  };
  transactionSync<T>(closure: () => T): T;
};

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)",
  "CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
];

const ROW_LIMIT = 2_000_000;

const encoder = new TextEncoder();

/** Returns a `Store` (`kind: "durable-object"`) over a Durable Object's SQLite storage, node-free, with the sqlite store's tables, row helpers (`store-rows.ts`) and semantics (§41f): `objects(id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)`, `refs(name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)` and `log(session TEXT, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY (session, seq))`, created on first `open()`. `put` ids the value with core's `objectId` and stores its JSON once; `putBlob` buffers the stream, ids it with `blobId` and stores the bytes once as an `ArrayBuffer`; an object and a blob that share an id share the row, each column filled once; `blob` reads the bytes back with their size and a null mime; a body, blob or logged event past the Durable Object's 2 MB row limit throws `SdkError("invalid")` before anything is written (§42k). `refs.set` runs inside one `transactionSync` with no await between its reads and writes: every `expect` is checked against the refs as they stood before the batch and the first that fails answers `stale { name, revision }` with nothing written; then the entries apply in order (a repeated name ends at its last entry; each entry mints a fresh random revision that is never reused; a null target deletes the row) and each event is appended to its session's log at the next seq under one `at`, an event on a ref outside `sessions/` throwing `SdkError("internal")` before anything is written, and any throw inside rolling the whole batch back; `seq` is the last one appended, else the tail of the first session named, else 0. `list(prefix)` reads the name range from `prefix` in name order; `log` returns the events after `after` in seq order up to `limit`, each validated as a `SessionEvent`; `tail` is the session's last seq, or 0. Every `open()` returns a connection over the one storage; `close()` releases nothing, the storage being the object's. In workerd, which allows code generation only while modules load, the Worker turns TypeBox acceleration off at startup (`Settings.Set({ useAcceleration: false })` from `typebox/system`, as `deploy/cloudflare/worker.ts` does), or `log`'s validation throws inside a request. */
export function durableObjectStore(storage: DurableObjectSql): Store {
  let connection: StoreConnection | null = null;

  return {
    kind: "durable-object",
    async open() {
      if (connection !== null) return connection;

      for (const statement of SCHEMA) storage.sql.exec(statement).toArray();
      connection = connect(storage);

      return connection;
    },
    async close() {
      connection = null;
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
            ? rows("SELECT name, target, revision FROM refs ORDER BY name")
            : rows(
                "SELECT name, target, revision FROM refs WHERE name >= ? AND name < ? ORDER BY name",
                prefix,
                end,
              );

        return found.map(refOf);
      },
      async set(updates) {
        const logged = eventsOf(updates).map(({ session, event }) => {
          const text = JSON.stringify(event);
          fits(encoder.encode(text).byteLength, `An event on ${session}`);

          return { session, text };
        });

        return storage.transactionSync((): SetOutcome => {
          const before = new Map<string, Ref | undefined>();

          for (const update of updates)
            if (!before.has(update.name)) before.set(update.name, ref(update.name) ?? undefined);
          const stale = updates.find((update) => !admits(update, before.get(update.name)));

          if (stale !== undefined)
            return {
              kind: "stale",
              name: stale.name,
              revision: before.get(stale.name)?.revision ?? null,
            };

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

            return revision;
          });

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

          const first = updates.map((update) => sessionOf(update.name)).find((id) => id !== null);

          return {
            kind: "set",
            seq: appended.at(-1) ?? (first ? tail(first) : asSeq(0)),
            revisions,
          };
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

/** Throws `SdkError("invalid")` when a row value is past the Durable Object's 2 MB limit (§42k). */
function fits(bytes: number, what: string): void {
  if (bytes > ROW_LIMIT)
    throw new SdkError(
      "invalid",
      `${what} is ${bytes} bytes, past the Durable Object store's 2 MB row limit.`,
    );
}
