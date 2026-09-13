import { randomUUID } from "node:crypto";
import type { PoolConfig } from "pg";
import { UnknownSession, type Session, type SessionInfo, type Store } from "../store.ts";
import {
  createPostgresDatabase,
  initializePostgres,
  integerColumn,
  stringColumn,
  type PostgresDatabase,
} from "./database.ts";
import { postgresSession } from "./session.ts";

export interface PostgresStoreOptions {
  /** Cross-instance replay interval while a consumer is watching. Defaults to 250 ms. */
  readonly watchPollIntervalMs?: number;
}

/** Shared durable state; closing a store ends its connections, never its sessions. */
export class PostgresStore implements Store {
  private readonly db: PostgresDatabase;
  private readonly watchPollIntervalMs: number;
  private readonly closeController = new AbortController();
  private ready: Promise<void> | undefined;

  constructor(db: PostgresDatabase, options?: PostgresStoreOptions) {
    const watchPollIntervalMs = options?.watchPollIntervalMs ?? 250;
    if (!Number.isSafeInteger(watchPollIntervalMs) || watchPollIntervalMs <= 0) {
      throw new RangeError("watchPollIntervalMs must be a positive safe integer");
    }
    this.db = db;
    this.watchPollIntervalMs = watchPollIntervalMs;
  }

  async initialize(): Promise<void> {
    if (this.closeController.signal.aborted) throw new Error("PostgreSQL store is closed");
    this.ready ??= initializePostgres(this.db);
    await this.ready;
    if (this.closeController.signal.aborted) throw new Error("PostgreSQL store is closed");
  }

  async create(options?: { readonly id?: string }): Promise<Session> {
    await this.initialize();
    const id = options?.id ?? `session_${randomUUID().slice(0, 12)}`;
    const rows = await this.db.query(
      `INSERT INTO nyte_sessions (id, created_at)
       VALUES ($1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id],
    );
    if (rows.length !== 1) throw new Error(`Session already exists: ${id}`);
    return this.session(id);
  }

  async open(id: string): Promise<Session> {
    await this.initialize();
    const rows = await this.db.query("SELECT id FROM nyte_sessions WHERE id = $1", [id]);
    if (rows.length === 0) throw new UnknownSession(id);
    return this.session(id);
  }

  async list(): Promise<readonly SessionInfo[]> {
    await this.initialize();
    const rows = await this.db.query(
      'SELECT id, created_at FROM nyte_sessions ORDER BY created_at, id COLLATE "C"',
    );
    return rows.map((row) => ({
      id: stringColumn(row, "id"),
      createdAt: integerColumn(row, "created_at"),
    }));
  }

  async delete(id: string): Promise<void> {
    await this.initialize();
    // DELETE acquires the same session row lock as every session mutation.
    await this.db.query("DELETE FROM nyte_sessions WHERE id = $1", [id]);
  }

  async close(): Promise<void> {
    if (this.closeController.signal.aborted) return;
    this.closeController.abort();
    try {
      await this.ready;
    } finally {
      await this.db.close();
    }
  }

  private session(id: string): Session {
    return postgresSession({
      id,
      db: this.db,
      storeSignal: this.closeController.signal,
      watchPollIntervalMs: this.watchPollIntervalMs,
    });
  }
}

/** Opens an owned pg pool and initializes the schema before accepting requests. */
export async function openPostgresStore(
  options: PoolConfig & PostgresStoreOptions & { readonly onPoolError?: (error: Error) => void },
): Promise<PostgresStore> {
  const { watchPollIntervalMs, ...poolOptions } = options;
  const db = createPostgresDatabase({
    max: 4,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000,
    ...poolOptions,
  });
  const store = new PostgresStore(
    db,
    watchPollIntervalMs === undefined ? undefined : { watchPollIntervalMs },
  );
  try {
    await store.initialize();
    return store;
  } catch (error) {
    await db.close();
    throw error;
  }
}
