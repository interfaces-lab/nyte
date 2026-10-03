/**
 * The slice of the D1 binding the broker uses. Rows come back as `unknown`
 * and are checked against a schema before use.
 */
export type D1Value = string | number | null;

export interface D1Result {
  readonly results: unknown[];
  readonly meta: { readonly changes: number };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first(): Promise<unknown>;
  all(): Promise<D1Result>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements as one transaction. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
