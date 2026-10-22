import process from "node:process";
import { createModels } from "@nyte-ai/ai/models";
import { SdkError } from "@nyte-ai/schema";
import { composeHost } from "@nyte-ai/core/server";
import type { Host, Listener, OpenOptions } from "@nyte-ai/core";
import type { ServedHost } from "@nyte-ai/core/server";
import { postgresStore } from "@nyte-ai/host";
import { credentialStore } from "@nyte-ai/host/credentials";
import { seedSigner } from "@nyte-ai/host/identity";
import { listenFetch } from "@nyte-ai/host/listen-fetch";
import { sandboxProvider } from "@nyte-ai/host/providers";
import manifest from "../../package.json" with { type: "json" };
import { answerRepair } from "./repair.ts";

type Served = {
  readonly host: ServedHost;
  readonly listener: Listener;
};

/** Starts the workflow that drives a head; the host hands each wake to it. */
type Dispatch = Extract<
  NonNullable<OpenOptions["execution"]>,
  { readonly kind: "dispatch" }
>["dispatch"];

const PAGE = 100;

const boot: Parameters<typeof sandboxProvider>[0]["boot"] = async () => {
  throw new SdkError("unavailable", "Supply a boot over your sandbox SDK in server/utils/host.ts.");
};

let building: Promise<Served> | null = null;

/** This process's host, composed once, handing each wake to `dispatch`. */
export function vercelHost(dispatch: Dispatch): Promise<Served> {
  const built = (building ??= build(dispatch));

  built.catch(() => {
    if (building === built) building = null;
  });

  return built;
}

async function build(dispatch: Dispatch): Promise<Served> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === "")
    throw new SdkError("unavailable", "Set DATABASE_URL to the Postgres database the host keeps.");
  const identityKey = process.env.NYTE_IDENTITY_KEY;
  const store = postgresStore({ connectionString });
  const secrets = secretsFrom(process.env.NYTE_SECRET_KEY);
  const description = { name: "nyte-host", platform: "vercel", version: manifest.version };

  const host = await composeHost({
    store,
    models: createModels({ credentials: credentialStore(store, secrets) }),
    plugins: [{ id: "sandbox", environment: sandboxProvider({ boot }) }],
    workspace: { kind: "sandbox", locator: { name: process.env.NYTE_SANDBOX ?? "nyte" } },
    execution: { kind: "dispatch", dispatch },
    poll: 1000,
    secrets,
    home: null,
    description,
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
    describe: () => description,
    ...(identityKey === undefined || identityKey === ""
      ? {}
      : { identity: await seedSigner(host.hostId, Uint8Array.fromBase64(identityKey)) }),
    before: (request) => answerRepair(request, process.env.CRON_SECRET, repair),
  }).catch(async (error: unknown) => {
    await host.close();

    throw error;
  });

  return { host, listener };
}

function secretsFrom(key: string | undefined): NonNullable<OpenOptions["secrets"]> {
  if (key === undefined || key === "")
    return {
      key: async () => {
        throw new SdkError("unavailable", "Set NYTE_SECRET_KEY to a base64 32-byte key.");
      },
    };
  const bytes = new Uint8Array(Buffer.from(key, "base64"));

  return { key: async () => bytes };
}
