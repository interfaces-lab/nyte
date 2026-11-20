export type D1Value = string | number | null;

export type D1Row = Readonly<Record<string, D1Value>>;

interface D1Result {
  readonly results: D1Row[];
  readonly meta: { readonly changes: number };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first(): Promise<D1Row | null>;
  all(): Promise<D1Result>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
