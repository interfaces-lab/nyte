import process from "node:process";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { PostgresStore, postgresDatabase } from "@nyte-ai/core/postgres";
import { createChatSdk, createChatServer, type WakeSession } from "./chat.ts";
import { serverModels } from "./models.ts";

export async function openExecution() {
  const configured = serverModels();
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL is required for the Vercel host");
  }

  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  pool.on("error", (error) => {
    console.error(JSON.stringify({ event: "nyte.postgres.pool_error", name: error.name }));
  });
  attachDatabasePool(pool);
  const store = new PostgresStore(postgresDatabase(pool));

  try {
    await store.initialize();
    const sdk = await createChatSdk({ ...configured, store });

    return {
      ...sdk,
      async close() {
        try {
          await sdk.close();
        } finally {
          await store.close();
        }
      },
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}

export async function openRuntime(wake: WakeSession) {
  const token = process.env.NYTE_TOKEN;

  if (!token) throw new Error("NYTE_TOKEN is required for the Vercel host.");
  const sdk = await openExecution();

  try {
    const server = createChatServer({ sdk, token, wake });

    return {
      fetch: (request: Request) => server.fetch(request),
      async close() {
        server.close();
        await sdk.close();
      },
    };
  } catch (error) {
    await sdk.close();
    throw error;
  }
}
