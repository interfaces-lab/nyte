import { DatabaseSync } from "node:sqlite";
import type { DurableObjectSql, SqlValue } from "../src/environment-record.ts";

export function doSqlStub(): DurableObjectSql {
  const database = new DatabaseSync(":memory:");

  return {
    transactionSync<T>(closure: () => T): T {
      database.exec("SAVEPOINT closure");

      try {
        const result = closure();

        database.exec("RELEASE closure");

        return result;
      } catch (error) {
        database.exec("ROLLBACK TO closure");
        database.exec("RELEASE closure");

        throw error;
      }
    },
    sql: {
      exec(query, ...bindings) {
        const rows = database
          .prepare(query)
          .all(
            ...bindings.map((value) =>
              value instanceof ArrayBuffer ? new Uint8Array(value) : value,
            ),
          );

        return {
          toArray: () =>
            rows.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([column, value]): [string, SqlValue] => [
                  column,
                  typeof value === "bigint"
                    ? Number(value)
                    : value instanceof Uint8Array
                      ? value.slice().buffer
                      : value,
                ]),
              ),
            ),
        };
      },
    },
  };
}
