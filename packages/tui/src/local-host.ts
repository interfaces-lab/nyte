import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { connect } from "@nyte-ai/sdk/client";
import type { ClientConnection } from "@nyte-ai/sdk/client";
import { tryLockFile } from "@nyte-ai/connect/host";
import { SdkError } from "@nyte-ai/schema";
import type { LocalEndpoint } from "@nyte-ai/service";
import {
  findRunningHost,
  hostFilePath,
  hostLockPath,
  hostLogPath,
} from "@nyte-ai/service/host-endpoint";
import { CliError } from "./cli/errors.ts";
import { printable } from "./cli/format.ts";
import { selfCommand } from "./compiled.ts";
import { hostFailure } from "./host-socket.ts";
import { fileJournal } from "./send-journal.ts";
import { VERSION } from "./version.ts";

export type HostSource =
  | { readonly kind: "local" }
  | { readonly kind: "attached"; readonly endpoint: LocalEndpoint };

export interface HostSession {
  readonly connection: ClientConnection;
  readonly endpoint: LocalEndpoint;
  close(): Promise<void>;
}

const HOST_START_MS = 20_000;

const HOST_POLL_MS = 100;

export async function connectHost(
  source: HostSource,
  kind: "tui" | "cli",
  progress?: (phase: string) => void,
): Promise<HostSession> {
  switch (source.kind) {
    case "local":
      return attachHost(await ensureHost(progress), kind);
    case "attached":
      return attachHost(source.endpoint, kind);
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}

async function ensureHost(progress?: (phase: string) => void): Promise<LocalEndpoint> {
  const path = hostFilePath();
  const running = await findRunningHost(path);

  if (running !== null) return { url: running.url, token: running.token };
  progress?.("Starting a Nyte host…");
  const deadline = Date.now() + HOST_START_MS;
  let child: ChildProcess | null = null;

  while (Date.now() < deadline) {
    const exited = child !== null && (child.exitCode !== null || child.signalCode !== null);

    if ((child === null || exited) && !hostLockHeld()) {
      if (exited) throw new Error(`The Nyte host stopped while starting. See ${hostLogPath()}.`);
      child = startHost();
    }

    await sleep(HOST_POLL_MS);
    const started = await findRunningHost(path);

    if (started !== null) return { url: started.url, token: started.token };
  }

  throw new Error(
    `The Nyte host didn't start within ${String(HOST_START_MS / 1000)} s. See ${hostLogPath()}.`,
  );
}

function startHost(): ChildProcess {
  const command = selfCommand();

  const child = spawn(command[0], [...command.slice(1), "host", "--log", "--supervised"], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => entry[0] !== "NYTE_HOST_TOKEN"),
    ),
  });

  child.unref();

  return child;
}

function hostLockHeld(): boolean {
  const release = tryLockFile(hostLockPath());
  release?.();

  return release === null;
}

async function attachHost(endpoint: LocalEndpoint, kind: "tui" | "cli"): Promise<HostSession> {
  const connection = await connect({
    url: endpoint.url,
    credentials: { kind: "token", token: endpoint.token },
    client: { kind, name: "nyte", version: VERSION },
    journal: fileJournal(),
  }).catch((cause: unknown) => {
    if (cause instanceof SdkError && cause.code !== "unavailable") {
      hostFailure(`attach to the host at ${endpoint.url}`)(cause);
    }

    throw new CliError("network_error", `Couldn't reach the host at ${endpoint.url}.`, {
      details: [
        {
          label: "Cause",
          value: printable(cause instanceof Error ? cause.message : String(cause)),
        },
        { label: "Host file", value: "nyte host writes its URL and token to ~/.nyte/host.json" },
      ],
      next: [{ label: "Start a host on that machine", argv: ["nyte", "host"] }],
    });
  });

  return {
    connection,
    endpoint,
    async close() {
      await connection.close().catch(() => undefined);
    },
  };
}
