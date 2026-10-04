import { DatabaseSync } from "node:sqlite";
import type { SqliteValue } from "@nyte-ai/core/store";
import { durableSqlite } from "../src/sqlite.ts";

export function sqliteFixture() {
  const database = new DatabaseSync(":memory:");

  const connection = durableSqlite({
    sql: {
      exec(text: string, ...params: SqliteValue[]) {
        return {
          toArray() {
            if (params.length === 0 && text.includes(";")) {
              database.exec(text);

              return [];
            }

            return database.prepare(text).all(...params);
          },
        };
      },
    },
    transactionSync<T>(fn: () => T): T {
      database.exec("SAVEPOINT fixture");

      try {
        const value = fn();
        database.exec("RELEASE fixture");

        return value;
      } catch (error) {
        database.exec("ROLLBACK TO fixture; RELEASE fixture");
        throw error;
      }
    },
  });

  return { connection, close: () => database.close() };
}
