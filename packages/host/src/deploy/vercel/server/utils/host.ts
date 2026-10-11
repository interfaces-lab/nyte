import process from "node:process";
import { createModels } from "@nyte-ai/ai/models";
import { SdkError, composeHost } from "@nyte-ai/core";
import type { Host, Kernel, Listener } from "@nyte-ai/core";
import { operations } from "@nyte-ai/protocol";
import { postgresStore } from "@nyte-ai/host";
import { listenFetch } from "@nyte-ai/host/listen-fetch";
import { sandboxProvider } from "@nyte-ai/host/providers";
import { start } from "workflow/api";
import manifest from "../../../../../package.json" with { type: "json" };
import { driveHead } from "../workflows/drive.ts";
import { answerRepair } from "./repair.ts";
import { vercelSandbox } from "./sandbox.ts";

/** Returns what one instance serves: the composed host and its listener. */
type Served = {
  readonly host: Omit<Host, "listen"> & { readonly kernel: Kernel };
  readonly listener: Listener;
};

const PAGE = 100;

let building: Promise<Served> | null = null;

/** Returns this instance's composed host and its listener, built on the first call and shared by every request and workflow step the instance serves (a failed build is forgotten, so the next call builds again): `composeHost` with `postgresStore({ connectionString: process.env.DATABASE_URL })` (unset, `SdkError("unavailable")`), the plugin `{ id: "sandbox", environment: sandboxProvider({ boot: vercelSandbox }) }` and workspace `{ kind: "sandbox", locator: { name: process.env.NYTE_SANDBOX ?? "nyte" } }`, `execution: { kind: "dispatch", async dispatch({ session, head }) { await start(driveHead, [{ session, head }]); } }` with `workflow/api`'s `start` (awaited, its `Run` handle dropped) (§42p, §42s: after each commit the kernel dispatches every head a wake makes owed a step, one pending dispatch per head here, so admitted inputs are `covered` and activation attaches the sandbox here), `poll: 1000` so this instance reads what other instances wrote (§42h), `home: null`, protocol's `operations()`, description `{ name: "nyte-host", platform: "vercel", version }`, `createModels()` from `@nyte-ai/ai/models`, and `secrets` from `NYTE_SECRET_KEY` (base64, decision 10). Drives start only from that dispatch and the repair route; nothing subscribes to the bus or to `kernel.wakes`. Jobs stay in the instance that started them: `job.output` for a job another instance started answers `unavailable`, its output reaching a client only through its exit report (§42h, §42w). `listenFetch` serves with `auth: { kind: "token", token: process.env.NYTE_TOKEN }`, `execution: { kind: "admit-only" }` and a `before` that answers `GET /.nyte/repair` (the cron) through `answerRepair` with `process.env.CRON_SECRET`: it pages `host.execution.repair` (100 a page), which on this `dispatch` kernel dispatches every runnable head again (§42s). */
export function vercelHost(): Promise<Served> {
  const built = (building ??= build());

  built.catch(() => {
    if (building === built) building = null;
  });

  return built;
}

async function build(): Promise<Served> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === "")
    throw new SdkError("unavailable", "Set DATABASE_URL to the Postgres database the host keeps.");
  const key = process.env.NYTE_SECRET_KEY;

  const host = await composeHost({
    store: postgresStore({ connectionString }),
    models: createModels(),
    plugins: [{ id: "sandbox", environment: sandboxProvider({ boot: vercelSandbox }) }],
    workspace: { kind: "sandbox", locator: { name: process.env.NYTE_SANDBOX ?? "nyte" } },
    execution: {
      kind: "dispatch",
      async dispatch({ session, head }) {
        await start(driveHead, [{ session, head }]);
      },
    },
    poll: 1000,
    secrets:
      key === undefined || key === ""
        ? undefined
        : { key: async () => new Uint8Array(Buffer.from(key, "base64")) },
    home: null,
    operations: operations(),
    description: { name: "nyte-host", platform: "vercel", version: manifest.version },
  });

  const repair = async (): Promise<void> => {
    let cursor: Parameters<Host["execution"]["repair"]>[0]["cursor"];

    do {
      const page = await host.execution.repair({ cursor, limit: PAGE });
      cursor = page.next ?? undefined;
    } while (cursor !== undefined);
  };

  const listener = await listenFetch(host, {
    transport: { kind: "fetch" },
    auth: { kind: "token", token: process.env.NYTE_TOKEN ?? "" },
    execution: { kind: "admit-only" },
    before: (request) => answerRepair(request, process.env.CRON_SECRET, repair),
  }).catch(async (error: unknown) => {
    await host.close();

    throw error;
  });

  return { host, listener };
}
