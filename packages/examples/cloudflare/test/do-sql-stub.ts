import { DatabaseSync } from "node:sqlite";
import type { DurableObjectSql, SqlValue } from "@nyte-ai/host/durable-object";

export function doSqlStub(): DurableObjectSql & { readonly database: DatabaseSync } {
  const database = new DatabaseSync(":memory:");

  return {
    database,
    transactionSync<T>(closure: () => T): T {
      database.exec("BEGIN");

      try {
        const result = closure();
        database.exec("COMMIT");

        return result;
      } catch (error) {
        database.exec("ROLLBACK");

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
