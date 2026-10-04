import { createNyte, type NyteOptions } from "@nyte-ai/core";
import { SqlStore } from "@nyte-ai/core/store";
import { createNyteServer, type NyteServerOptions } from "@nyte-ai/server";
import { Settings } from "typebox/system";
import { createAlarmDriver } from "./alarm.ts";
import { sqlScan } from "./scan.ts";
import { durableSqlite } from "./sqlite.ts";

export interface CloudflareOptions {
  readonly nyte: Omit<Extract<NyteOptions, { plugins: unknown }>, "store" | "workspace">;
  readonly server: Omit<NyteServerOptions, "sdk" | "environment" | "describe">;
  readonly maxHeads?: number;
  readonly budgetMs?: number;
  readonly onAlarmError: (cause: unknown) => void;
}

export async function openCloudflareRuntime({
  storage,
  options,
  arm,
}: {
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;
  options: CloudflareOptions;
  arm: (at: number) => Promise<void>;
}) {
  Settings.Set({ useAcceleration: false });
  const db = durableSqlite(storage);
  const store = new SqlStore(db);
  const sdk = await createNyte({ ...options.nyte, store });

  try {
    const driver = createAlarmDriver({
      scan: sqlScan(db),
      advance: (input) => sdk.advance(input),
      arm,
      maxHeads: options.maxHeads,
      budgetMs: options.budgetMs,
      onError: options.onAlarmError,
    });

    const server = createNyteServer({
      ...options.server,
      sdk,
      describe: () => ({ capabilities: { workspace: false }, persistence: "durable" }),
    });

    return {
      driver,
      fetch(request: Request): Promise<Response> {
        if (request.method === "POST" && new URL(request.url).pathname.startsWith("/v1/call/"))
          return driver.submit(() => server.fetch(request));

        return server.fetch(request);
      },
    };
  } catch (cause) {
    await sdk.close();
    await store.close();
    throw cause;
  }
}
