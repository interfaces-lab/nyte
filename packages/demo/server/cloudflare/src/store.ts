/**
 * The kernel store's SQLite connection over a Durable Object's storage. One
 * object is one writer, so the change counter other processes would need is
 * left out and `transactionSync` is both the write and the read transaction.
 */
import type { SqliteConnection } from "@nyte-ai/core/store";

export function durableObjectSqlite(storage: DurableObjectStorage): SqliteConnection {
  const { sql } = storage;
  return {
    run: (text, params) => {
      // A cursor runs its statement to completion only when drained.
      sql.exec(text, ...params).toArray();
    },
    all: (text, params) => sql.exec(text, ...params).toArray(),
    exec: (script) => {
      sql.exec(script).toArray();
    },
    transact: (fn) => storage.transactionSync(fn),
    read: (fn) => storage.transactionSync(fn),
  };
}
