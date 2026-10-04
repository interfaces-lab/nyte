import { PGlite } from "@electric-sql/pglite";
import { PostgresStore, type PostgresDatabase, type PostgresRow } from "@nyte-ai/core/postgres";
import { dispatchOutbox } from "@nyte-ai/vercel/outbox";
import { createChatSdk } from "../src/chat.ts";
import { serverModels } from "./echo.ts";

export async function postgresFixture() {
  const database = await PGlite.create();
  const opened = new Set<Awaited<ReturnType<typeof createChatSdk>>>();
  const configured = serverModels();

  return {
    async openSdk() {
      const connection: PostgresDatabase = {
        query: async (sql, values = []) =>
          (await database.query<PostgresRow>(sql, [...values])).rows,
        transaction: (run) =>
          database.transaction(async (transaction) =>
            run({
              query: async (sql, values = []) =>
                (await transaction.query<PostgresRow>(sql, [...values])).rows,
            }),
          ),
        // Connections borrow the embedded engine; fixture cleanup closes it after all stores.
        close: async () => {},
      };

      const store = new PostgresStore(connection, { watchPollIntervalMs: 5 });
      const outbox = dispatchOutbox(connection);
      await store.initialize();
      await outbox.initialize();
      const sdk = await createChatSdk({ ...configured, store });

      const owned = {
        ...sdk,
        outbox,
        async close() {
          await sdk.close();
          await store.close();
          opened.delete(owned);
        },
      };

      opened.add(owned);

      return owned;
    },
    async close() {
      for (const sdk of opened) await sdk.close();
      await database.close();
    },
  };
}
