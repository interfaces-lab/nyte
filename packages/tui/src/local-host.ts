import { spawn } from "node:child_process";
import { homedir } from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
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

/**
 * `progress` hears the phase of a wait the person would otherwise sit through in silence, such as
 * starting a host. One-shot commands pass `Output.progress`; the full-screen TUI passes nothing,
 * because its screen owns the terminal.
 */
export async function connectHost(
  source: HostSource,
  progress?: (phase: string) => void,
): Promise<HostSession> {
  switch (source.kind) {
    case "local":
      return attachHost(await ensureHost(progress));
    case "attached":
      return attachHost(source.endpoint);
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
    const exited = child.exitCode !== null || child.signalCode !== null;

    await sleep(HOST_POLL_MS);
    const started = await findRunningHost(path);

    if (started !== null) return { url: started.url, token: started.token };

    if (exited && !hostLockHeld())
      throw new Error(`The Nyte host stopped while starting. See ${hostLogPath()}.`);
  }

  throw new Error(
    `The Nyte host didn't start within ${String(HOST_START_MS / 1000)} s. See ${hostLogPath()}.`,
  );
}

/**
 * Whether a host holds `host.lock`, so one is starting or serving even though `host.json` doesn't
 * name it yet. Asked only after the host this command started has exited: it either lost the lock
 * to that host or failed. Taking the lock to ask holds it for one SQLite open, so a host claiming
 * it in that instant sees it taken.
 */
function hostLockHeld(): boolean {
  const release = tryLockFile(hostLockPath());
  release?.();

  return release === null;
}

/** A host that answers and refuses is reported with its wire error; one that never answers (`unavailable`) is `network_error`, its cause in a detail row. */
async function attachHost(endpoint: LocalEndpoint): Promise<HostSession> {
  const connection = await sdk
    .connect({ url: endpoint.url, credentials: { kind: "token", token: endpoint.token } })
    .catch((cause: unknown) => {
      if (cause instanceof SdkError && cause.code !== "unavailable")
        hostFailure(`attach to the host at ${endpoint.url}`)(cause);

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
