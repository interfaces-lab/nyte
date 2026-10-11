import process from "node:process";
import { openPostgresExecution } from "@nyte-ai/vercel/postgres";
import { createChatSdk, createChatServer, type WakeSession } from "./chat.ts";
import { serverModels } from "./models.ts";

export async function openExecution() {
  const configured = await serverModels();
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) throw new Error("DATABASE_URL is required for the Vercel host");

  return openPostgresExecution({
    pool: { connectionString },
    createSdk: (store) => createChatSdk({ ...configured, store }),
    onPoolError: (error) =>
      console.error(JSON.stringify({ event: "nyte.postgres.pool_error", name: error.name })),
  });
}

export async function openRuntime(wake: WakeSession) {
  const token = process.env.NYTE_TOKEN;

  if (!token) throw new Error("NYTE_TOKEN is required for the Vercel host.");
  const sdk = await openExecution();

  try {
    const server = createChatServer({ sdk, token, wake, outbox: sdk.outbox });

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
