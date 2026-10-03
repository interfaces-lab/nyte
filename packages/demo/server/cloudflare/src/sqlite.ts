import type { SqliteConnection } from "@nyte-ai/core/store";

export function durableSqlite(storage: DurableObjectStorage): SqliteConnection {
  return {
    run(text, params) {
      storage.sql.exec(text, ...params).toArray();
    },
    all(text, params) {
      return storage.sql.exec(text, ...params).toArray();
    },
    exec(script) {
      storage.sql.exec(script).toArray();
    },
    transact(fn) {
      return storage.transactionSync(fn);
    },
    read(fn) {
      return storage.transactionSync(fn);
    },
  };
}
