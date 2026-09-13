import { Pool, type PoolConfig } from "pg";

export type PostgresValue = string | number | null | readonly string[];
export type PostgresRow = Readonly<Record<string, unknown>>;

export interface PostgresQuery {
  query(text: string, values?: readonly PostgresValue[]): Promise<readonly PostgresRow[]>;
}

/** A transaction must keep every query on the same PostgreSQL connection. */
export interface PostgresDatabase extends PostgresQuery {
  transaction<T>(run: (transaction: PostgresQuery) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgresDatabase(pool: Pool): PostgresDatabase {
  return {
    query: async (text, values = []) => {
      const result = await pool.query<Record<string, unknown>>(text, [...values]);
      return result.rows;
    },
    transaction: async (run) => {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        const result = await run({
          query: async (text, values = []) => {
            const response = await client.query<Record<string, unknown>>(text, [...values]);
            return response.rows;
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
}

export function createPostgresDatabase(
  options: PoolConfig & { readonly onPoolError?: (error: Error) => void },
): PostgresDatabase {
  const { onPoolError, ...poolOptions } = options;
  const pool = new Pool(poolOptions);
  // pg removes an idle connection that fails. Report that failure without an
  // unhandled EventEmitter error terminating otherwise healthy requests.
  pool.on("error", onPoolError ?? ((error) => process.emitWarning(error, "PostgresPoolError")));
  return postgresDatabase(pool);
}

export function stringColumn(row: PostgresRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") throw new TypeError(`PostgreSQL column ${name} is not a string`);
  return value;
}

/** pg returns int8 as text; neither driver values nor numeric overflow are trusted. */
export function integerColumn(row: PostgresRow, name: string): number {
  const value = row[name];
  const number = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new TypeError(`PostgreSQL column ${name} is not a safe integer`);
  }
  return number;
}

export async function databaseTime(db: PostgresQuery): Promise<number> {
  const [row] = await db.query(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now",
  );
  if (row === undefined) throw new Error("PostgreSQL did not return its clock");
  return integerColumn(row, "now");
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS nyte_sessions (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    next_seq BIGINT NOT NULL DEFAULT 1,
    event_floor BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS nyte_objects (
    session_id TEXT NOT NULL REFERENCES nyte_sessions(id) ON DELETE CASCADE,
    oid TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (session_id, oid)
  )`,
  `CREATE INDEX IF NOT EXISTS nyte_objects_kind ON nyte_objects(session_id, kind)`,
  `CREATE TABLE IF NOT EXISTS nyte_refs (
    session_id TEXT NOT NULL REFERENCES nyte_sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    oid TEXT NOT NULL,
    PRIMARY KEY (session_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS nyte_leases (
    session_id TEXT NOT NULL REFERENCES nyte_sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    fence BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (session_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS nyte_events (
    session_id TEXT NOT NULL REFERENCES nyte_sessions(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    at BIGINT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
  )`,
];

export async function initializePostgres(db: PostgresDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    // Cold starts may initialize together. PostgreSQL's IF NOT EXISTS alone
    // does not serialize simultaneous catalog writes from different clients.
    await transaction.query("SELECT pg_advisory_xact_lock(1853453413)");
    await transaction.query("CREATE TABLE IF NOT EXISTS nyte_schema (version INTEGER PRIMARY KEY)");
    const versions = await transaction.query("SELECT version FROM nyte_schema");
    if (versions.length > 1 || versions.some((row) => integerColumn(row, "version") !== 1)) {
      throw new Error("Unsupported Nyte PostgreSQL schema version");
    }
    for (const table of TABLES) await transaction.query(table);
    await transaction.query("INSERT INTO nyte_schema (version) VALUES (1) ON CONFLICT DO NOTHING");
  });
}
