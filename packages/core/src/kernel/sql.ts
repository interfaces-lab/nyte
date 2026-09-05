/**
 * Tagged-template SQL helper, ported from pi (earendil-works) and adapted to
 * node:sqlite.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/session-backends/sqlite-node/src/sqlite/sql.ts
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type SqliteValue = string | number | null;

type SqlTemplateValue = SqliteValue | SqlQuery;

/** A parameterized SQLite query produced by {@link sql}. */
export class SqlQuery {
  readonly queryText: string;
  readonly params: readonly SqliteValue[];

  constructor(queryText: string, params: readonly SqliteValue[] = []) {
    this.queryText = queryText;
    this.params = params;
  }

  run(db: DatabaseSync): ReturnType<StatementSync["run"]> {
    return db.prepare(this.queryText).run(...this.params);
  }

  get(db: DatabaseSync): ReturnType<StatementSync["get"]> {
    return db.prepare(this.queryText).get(...this.params);
  }

  all(db: DatabaseSync): ReturnType<StatementSync["all"]> {
    return db.prepare(this.queryText).all(...this.params);
  }
}

/** Builds a parameterized query. Nested queries are inlined; other interpolations become `?` parameters. */
export function sql(strings: TemplateStringsArray, ...values: SqlTemplateValue[]): SqlQuery {
  let queryText = strings[0] ?? "";
  const params: SqliteValue[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value instanceof SqlQuery) {
      queryText += value.queryText;
      params.push(...value.params);
    } else {
      queryText += "?";
      params.push(value ?? null);
    }
    queryText += strings[index + 1] ?? "";
  }
  return new SqlQuery(queryText, params);
}
