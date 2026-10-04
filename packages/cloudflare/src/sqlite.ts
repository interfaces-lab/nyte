import type { SqliteConnection, SqliteValue, SqlRow } from "@nyte-ai/core/store";

const encoder = new TextEncoder();

function checkBindings(params: readonly SqliteValue[]): void {
  if (params.length > 100) throw new RangeError("Durable Object SQL allows at most 100 parameters");

  const bytes = params.reduce<number>(
    (sum, value) => sum + (typeof value === "string" ? encoder.encode(value).byteLength : 8),
    0,
  );

  if (bytes > 1_900_000)
    throw new RangeError(
      "Nyte Durable Object persistence exceeds the 1,900,000-byte statement budget",
    );
}

export function durableSqlite(storage: {
  sql: { exec(text: string, ...bindings: SqliteValue[]): { toArray(): readonly SqlRow[] } };
  transactionSync<T>(run: () => T): T;
}): SqliteConnection {
  return {
    run(text, params) {
      checkBindings(params);
      storage.sql.exec(text, ...params).toArray();
    },
    all(text, params) {
      checkBindings(params);

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
