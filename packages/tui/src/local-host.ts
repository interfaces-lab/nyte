import { spawn } from "node:child_process";
import { homedir } from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import type { LocalEndpoint } from "@nyte-ai/service";
import {
  findRunningHost,
  HOST_TAKEN_EXIT,
  hostFilePath,
  hostLogPath,
} from "@nyte-ai/service/host-endpoint";
import { selfCommand } from "./compiled.ts";

export type HostSource =
  | { readonly kind: "local" }
  | { readonly kind: "attached"; readonly endpoint: LocalEndpoint };

export interface HostSession {
  readonly connection: Connection;
  readonly endpoint: LocalEndpoint;
  close(): Promise<void>;
}

const HOST_START_MS = 20_000;

const HOST_POLL_MS = 100;

export async function connectHost(source: HostSource): Promise<HostSession> {
  switch (source.kind) {
    case "local":
      return attachHost(await ensureHost());
    case "attached":
      return attachHost(source.endpoint);
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}

async function ensureHost(): Promise<LocalEndpoint> {
  const path = hostFilePath();
  const running = await findRunningHost(path);

  if (running !== null) return { url: running.url, token: running.token };
  const command = selfCommand();

  const child = spawn(command[0], [...command.slice(1), "host", "--log"], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => entry[0] !== "NYTE_HOST_TOKEN"),
    ),
  });

  child.unref();
  const deadline = Date.now() + HOST_START_MS;

  while (Date.now() < deadline) {
    const exited =
      (child.exitCode !== null && child.exitCode !== HOST_TAKEN_EXIT) || child.signalCode !== null;

    await sleep(HOST_POLL_MS);
    const started = await findRunningHost(path);

    if (started !== null) return { url: started.url, token: started.token };

    if (exited) throw new Error(`The Nyte host stopped while starting. See ${hostLogPath()}.`);
  }

  throw new Error(
    `The Nyte host didn't start within ${String(HOST_START_MS / 1000)} s. See ${hostLogPath()}.`,
  );
}

async function attachHost(endpoint: LocalEndpoint): Promise<HostSession> {
  const connection = await sdk
    .connect({ url: endpoint.url, credentials: { kind: "token", token: endpoint.token } })
    .catch((cause: unknown) => {
      throw new Error(
        `Couldn't attach to the Nyte host at ${endpoint.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    });

  return {
    connection,
    endpoint,
    async close() {
      await connection.close().catch(() => undefined);
    },
  };
}
