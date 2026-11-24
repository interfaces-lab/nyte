import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { connect } from "@nyte-ai/sdk/client";
import type { ClientConnection, ClientConnectOptions } from "@nyte-ai/sdk/client";
import { tryLockFile } from "@nyte-ai/connect/host";
import { compareVersions, SdkError } from "@nyte-ai/schema";
import type { LocalEndpoint } from "@nyte-ai/service";
import {
  describeHost,
  findRunningHost,
  hostFilePath,
  hostLockPath,
  hostLogPath,
  processAlive,
} from "@nyte-ai/service/host-endpoint";
import type { RunningHost } from "@nyte-ai/service/host-endpoint";
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

const RETIRE_EXIT_MS = 30_000;

export async function connectHost(
  source: HostSource,
  kind: "tui" | "cli",
  progress?: (phase: string) => void,
): Promise<HostSession> {
  switch (source.kind) {
    case "local":
      return followRetire(await attachHost(await ensureHost(progress), kind));
    case "attached":
      return attachHost(source.endpoint, kind);
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}

async function ensureHost(progress?: (phase: string) => void): Promise<RunningHost> {
  const path = hostFilePath();
  const running = await findRunningHost(path);

  if (running !== null) return running;
  progress?.("Starting a Nyte host…");
  const deadline = Date.now() + HOST_START_MS;
  let child: ChildProcess | null = null;
  let updating = false;

  for (;;) {
    const exited = child !== null && (child.exitCode !== null || child.signalCode !== null);
    const held = hostLockHeld();

    if ((child === null || exited) && !held) {
      if (exited) throw new Error(`The Nyte host stopped while starting. See ${hostLogPath()}.`);
      child = startHost();
    }

    if (Date.now() >= deadline && !held) {
      throw new Error(
        `The Nyte host didn't start within ${String(HOST_START_MS / 1000)} s. See ${hostLogPath()}.`,
      );
    }

    if (Date.now() >= deadline && !updating) {
      updating = true;
      progress?.("Updating Nyte data…");
    }

    await sleep(HOST_POLL_MS);
    const started = await findRunningHost(path);

    if (started !== null) return started;
  }
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

function followRetire(session: HostSession): HostSession {
  const { connection } = session;
  let asked = false;

  const unfollow = connection.link.subscribe(() => {
    const state = connection.link.snapshot();

    if (state.kind === "open") {
      asked = state.match.kind === "host-older" && state.match.replace === "when-idle";

      return;
    }

    if (!asked || state.kind !== "away" || state.reason !== "replacing") return;
    asked = false;
    void replaceHost().catch(() => undefined);
  });

  return {
    ...session,
    async close() {
      unfollow();
      await session.close();
    },
  };
}

async function replaceHost(): Promise<void> {
  const retiring = await findRunningHost(hostFilePath());

  if (retiring !== null) await processExit(retiring.pid);
  await ensureHost();
}

async function processExit(pid: number): Promise<void> {
  const deadline = Date.now() + RETIRE_EXIT_MS;

  for (;;) {
    if (!processAlive(pid) || Date.now() >= deadline) return;
    await sleep(HOST_POLL_MS, undefined, { ref: false });
  }
}

function hostLockHeld(): boolean {
  const release = tryLockFile(hostLockPath());
  release?.();

  return release === null;
}

async function attachHost(
  endpoint: LocalEndpoint & Pick<RunningHost, "socket">,
  kind: "tui" | "cli",
): Promise<HostSession> {
  const connection = await connect({
    url: endpoint.url,
    credentials: { kind: "token", token: endpoint.token },
    client: { kind, name: "nyte", version: VERSION },
    journal: fileJournal(),
    transport: unixTransport(endpoint.socket),
  }).catch(async (cause: unknown) => {
    if (cause instanceof SdkError && cause.code !== "unavailable") {
      await failIfHostNewer(endpoint.url);
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

/** The HTTP dial fails before the socket's hello, so the host's `host-newer` verdict (`matchBuild`) never arrives. Orders the builds the way it would, so an older nyte left on the PATH says so instead of showing a schema error. */
async function failIfHostNewer(url: string): Promise<void> {
  const host = await describeHost(url, 1000);

  if (host === null || (compareVersions(VERSION, host.version) ?? 0) >= 0) return;

  throw new CliError("conflict", `Can't attach to the host at ${url}: it runs a newer Nyte.`, {
    details: [
      { label: "This nyte", value: `${VERSION} at ${selfCommand()[0]}` },
      { label: "Host reported", value: printable(host.version) },
      { label: "Fix", value: "Put a nyte at least as new as the host first on your PATH" },
    ],
  });
}

function unixTransport(path: string | undefined): ClientConnectOptions["transport"] {
  if (path === undefined || !existsSync(path)) return undefined;

  return {
    fetch: (url, init) => fetch(url, { ...init, unix: path }),
    socket: (request) => new WebSocket(`ws+unix://${path}:/.nyte/ws`, { headers: request.headers }),
  };
}
