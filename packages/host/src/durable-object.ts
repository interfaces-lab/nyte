import type { Store } from "@nyte-ai/core";

/** Returns one value Durable Object SQL binds and answers: text, a number, a blob as an `ArrayBuffer`, or null. */
export type SqlValue = ArrayBuffer | string | number | null;

/** Returns the part of a Durable Object's storage `durableObjectStore` uses, structurally, so a Worker passes `state.storage` as it is and a test passes a shim: `sql.exec` runs one statement with `?` bindings and answers its rows keyed by column name, and `transactionSync` runs a synchronous closure whose writes land all together or, when it throws, not at all (Durable Object SQL refuses `BEGIN`, so this is the only transaction). */
export type DurableObjectSql = {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
  };
  transactionSync<T>(closure: () => T): T;
};

/** Returns a `Store` (`kind: "durable-object"`) over a Durable Object's SQLite storage, node-free, with the sqlite store's tables, row helpers (`store-rows.ts`) and semantics (§41f): `objects(id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)`, `refs(name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)` and `log(session TEXT, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY (session, seq))`, created on first `open()`. `put` ids the value with core's `objectId` and stores its JSON once; `putBlob` buffers the stream, ids it with `blobId` and stores the bytes once as an `ArrayBuffer`; an object and a blob that share an id share the row, each column filled once; `blob` reads the bytes back with their size and a null mime; a body or blob past the Durable Object's 2 MB row limit throws `SdkError("invalid")` before anything is written. `refs.set` runs inside one `transactionSync` with no await between its reads and writes: every `expect` is checked against the refs as they stood before the batch and the first that fails answers `stale { name, revision }` with nothing written; then the entries apply in order (a repeated name ends at its last entry; each entry mints a fresh random revision that is never reused; a null target deletes the row) and each event is appended to its session's log at the next seq under one `at`, an event on a ref outside `sessions/` throwing `SdkError("internal")` before anything is written, and any throw inside rolling the whole batch back; `seq` is the last one appended, else the tail of the first session named, else 0. `list(prefix)` reads the name range from `prefix` in name order; `log` returns the events after `after` in seq order up to `limit`, each validated as a `SessionEvent`; `tail` is the session's last seq, or 0. Every `open()` returns a connection over the one storage, its `close` a no-op; `close()` releases nothing, the storage being the object's. */
export function durableObjectStore(storage: DurableObjectSql): Store {
  throw new Error("not implemented");
}
