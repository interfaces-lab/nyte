import { Pool, type PoolConfig } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import type { Nyte } from "@nyte-ai/core";
import { PostgresStore, postgresDatabase } from "@nyte-ai/core/postgres";
import { dispatchOutbox } from "./outbox.ts";

export async function openPostgresExecution({
  pool: config,
  createSdk,
  onPoolError,
}: {
  pool: PoolConfig;
  createSdk: (store: PostgresStore) => Promise<Nyte>;
  onPoolError: (error: Error) => void;
}) {
  const pool = new Pool({
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ...config,
  });

  pool.on("error", onPoolError);
  const database = postgresDatabase(pool);
  const store = new PostgresStore(database);
  const outbox = dispatchOutbox(database);

  try {
    attachDatabasePool(pool);
    await store.initialize();
    await outbox.initialize();
    const sdk = await createSdk(store);
    let closing: Promise<void> | undefined;

    return {
      ...sdk,
      outbox,
      close(): Promise<void> {
        closing ??= (async () => {
          try {
            await sdk.close();
          } finally {
            await store.close();
          }
        })();

        return closing;
      },
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}
