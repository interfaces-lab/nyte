/**
 * Tagged-template SQL over one SQLite connection. The store speaks SQLite's
 * dialect and runs its CAS inside a synchronous transaction closure, so the
 * seam is a synchronous SQLite connection: `node:sqlite`, a Durable Object's
 * storage, a test double. Another engine or an async client is another store,
 * not another connection.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/session-backends/sqlite-node/src/sqlite/sql.ts
 */

export type SqliteValue = string | number | null;

export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqliteConnection {
  /** Runs a statement and discards its rows. */
  run(text: string, params: readonly SqliteValue[]): void;
  /** Runs a statement and returns every row. */
  all(text: string, params: readonly SqliteValue[]): readonly SqlRow[];
  /** Runs a script of several statements with no parameters. */
  exec(script: string): void;
  /** Runs `fn` in one write transaction; a throw rolls it back. */
  transact<T>(fn: () => T): T;
  /** Runs `fn` in one read transaction so several reads see one snapshot. */
  read<T>(fn: () => T): T;
  /**
   * A counter that changes when another connection writes. Present only when
   * another process can write the same database; a single-writer store leaves
   * it out and watchers rely on local notification alone.
   */
  dataVersion?(): number;
  close?(): void;
}

type SqlTemplateValue = SqliteValue | SqlQuery;

/** A parameterized SQLite query produced by {@link sql}. */
export class SqlQuery {
  readonly queryText: string;
  readonly params: readonly SqliteValue[];

  constructor(queryText: string, params: readonly SqliteValue[] = []) {
    this.queryText = queryText;
    this.params = params;
  }

  run(db: SqliteConnection): void {
    db.run(this.queryText, this.params);
  }

  get(db: SqliteConnection): SqlRow | undefined {
    return db.all(this.queryText, this.params)[0];
  }

  all(db: SqliteConnection): readonly SqlRow[] {
    return db.all(this.queryText, this.params);
  }

  /** Rows a `RETURNING` clause produced: the exact count a statement changed on any connection. */
  count(db: SqliteConnection): number {
    return db.all(this.queryText, this.params).length;
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

/** A comma-separated parameter list for `IN (...)`, one `?` per value. */
export function sqlList(values: readonly SqliteValue[]): SqlQuery {
  return new SqlQuery(values.map(() => "?").join(", "), values);
}
