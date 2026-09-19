import { Pool, type PoolConfig } from "pg";
import { stampRunFailure } from "../migrations.ts";

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

/** Bumped whenever the tables or a stored object's shape change; an earlier version is upgraded through {@link MIGRATIONS}. */
const SCHEMA_VERSION = 2;

async function stampRunFailures(transaction: PostgresQuery): Promise<void> {
  const rows = await transaction.query(
    `SELECT session_id, oid, body, at FROM nyte_objects
     WHERE kind = 'run' AND jsonb_typeof(body::jsonb #> '{phase,error}') = 'string'`,
  );
  for (const row of rows) {
    const sessionId = stringColumn(row, "session_id");
    const oid = stringColumn(row, "oid");
    const next = stampRunFailure(oid, stringColumn(row, "body"));
    await transaction.query(
      `INSERT INTO nyte_objects (session_id, oid, kind, body, at) VALUES ($1, $2, 'run', $3, $4)
       ON CONFLICT DO NOTHING`,
      [sessionId, next.oid, next.body, integerColumn(row, "at")],
    );
    await transaction.query("UPDATE nyte_refs SET oid = $1 WHERE session_id = $2 AND oid = $3", [
      next.oid,
      sessionId,
      oid,
    ]);
    await transaction.query("DELETE FROM nyte_objects WHERE session_id = $1 AND oid = $2", [
      sessionId,
      oid,
    ]);
  }
}

const MIGRATIONS: ReadonlyMap<number, (transaction: PostgresQuery) => Promise<void>> = new Map([
  [1, stampRunFailures],
]);

export async function initializePostgres(db: PostgresDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    // Cold starts may initialize together. PostgreSQL's IF NOT EXISTS alone
    // does not serialize simultaneous catalog writes from different clients.
    await transaction.query("SELECT pg_advisory_xact_lock(1853453413)");
    await transaction.query("CREATE TABLE IF NOT EXISTS nyte_schema (version INTEGER PRIMARY KEY)");
    const versions = await transaction.query("SELECT version FROM nyte_schema");
    if (versions.length > 1) throw new Error("Unsupported Nyte PostgreSQL schema version");
    const [row] = versions;
    const stored = row === undefined ? SCHEMA_VERSION : integerColumn(row, "version");
    if (stored > SCHEMA_VERSION) {
      throw new Error(
        `Nyte PostgreSQL schema ${String(stored)} is newer than this build (${String(SCHEMA_VERSION)})`,
      );
    }
    for (const table of TABLES) await transaction.query(table);
    for (let version = stored; version < SCHEMA_VERSION; version += 1) {
      const migrate = MIGRATIONS.get(version);
      if (migrate === undefined) {
        throw new Error(
          `Nyte PostgreSQL schema ${String(version)} cannot be upgraded by this build`,
        );
      }
      await migrate(transaction);
    }
    await transaction.query("UPDATE nyte_schema SET version = $1 WHERE version <> $1", [
      SCHEMA_VERSION,
    ]);
    await transaction.query(
      "INSERT INTO nyte_schema (version) VALUES ($1) ON CONFLICT DO NOTHING",
      [SCHEMA_VERSION],
    );
  });
}
