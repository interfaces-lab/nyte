import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { tryLockFile } from "@nyte-ai/connect/host";
import {
  findRunningHost,
  hostFilePath,
  hostLockPath,
  hostLogPath,
  hostSocketPath,
  publishHost,
  readHostAddress,
  saveHostAddress,
  withdrawHost,
} from "./host-endpoint.ts";
import type { RunningHost } from "./host-endpoint.ts";
import { OWN_TOKEN_AUTHORITY, startHostThread } from "./host-thread.ts";
import type { HostWorkerEntry } from "./host-thread.ts";
import { portConflict, probePort } from "./port.ts";

interface Output {
  readonly write: (text: string) => void;
}

/** Where a served host listens, as `host.json` names it. */
export interface HostListening {
  readonly url: string;
  readonly socket: string | undefined;
  readonly endpoint: string;
  readonly pid: number;
}

export interface ServeHostOptions {
  /** The worker module the host thread runs. */
  readonly entry: HostWorkerEntry;
  /** Appends the output and the final error to the host log instead of writing to `output`. */
  readonly log: boolean;
  /** The `nyte-tailnet` sidecar; default the one beside the process's executable. */
  readonly tailnet?: string;
  readonly signal: AbortSignal;
  readonly output: Output;
  /** The text written once the host listens. */
  readonly listening: (host: HostListening) => string;
  /** What to do when another host serves this home: `wait` stands by until the holder exits and then serves (the launch agent); `exit` returns at once. */
  readonly whenTaken: "wait" | "exit";
}

/** How `serveHost` ended: `stopped` once `signal` aborted, `taken` when another host serves this home, naming it once it has published `host.json`. */
export type Served =
  | { readonly kind: "stopped" }
  | { readonly kind: "taken"; readonly by: RunningHost | null };

type Claim = Served | { readonly kind: "claimed"; readonly release: () => void };

const STANDBY_POLL_MS = 1_000;

/** Serves the store on 127.0.0.1 and, off Windows, on `host.sock` until `signal` aborts, keeping its port and token in `host-address.json` across restarts and publishing the URL and token in `host.json` for clients to attach to. Holds `host.lock` while it serves, so one home has one served host. What `nyte host` and the desktop app's host run. */
export async function serveHost(options: ServeHostOptions): Promise<Served> {
  if (!options.log) return serve(options, options.output);
  const log = hostLogPath();
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });

  const logged = {
    write: (text: string) => void appendFile(log, text, { mode: 0o600 }).catch(() => undefined),
  };

  try {
    return await serve(options, logged);
  } catch (cause) {
    await appendFile(
      log,
      `${new Date().toISOString()} ${cause instanceof Error ? cause.message : String(cause)}\n`,
      { mode: 0o600 },
    );

    throw cause;
  }
}

async function serve(options: ServeHostOptions, output: Output): Promise<Served> {
  const path = hostFilePath();
  const claim = await claimHost(path, options, output);

  if (claim.kind !== "claimed") return claim;

  try {
    return await serveClaimed(options, output, path);
  } finally {
    claim.release();
  }
}

/** Takes `host.lock`, then checks `host.json` for a live host an older build published without the lock. Probes `host.json` only while holding the lock, so a standby does no HTTP probing. */
async function claimHost(path: string, options: ServeHostOptions, output: Output): Promise<Claim> {
  let release: (() => void) | null = null;
  let standing = false;

  for (;;) {
    release ??= tryLockFile(hostLockPath());
    const holder = release === null ? null : await findRunningHost(path);

    if (release !== null && holder === null) return { kind: "claimed", release };

    if (options.whenTaken === "exit") {
      release?.();

      return { kind: "taken", by: holder ?? (await findRunningHost(path)) };
    }

    if (!standing)
      output.write(`${JSON.stringify({ type: "standby", holder: holder?.pid ?? null })}\n`);
    standing = true;
    await sleep(STANDBY_POLL_MS, undefined, { signal: options.signal }).catch(() => undefined);

    if (options.signal.aborted) {
      release?.();

      return { kind: "stopped" };
    }
  }
}

/** Opens home as the default workspace, never the working directory: launchd starts the desktop's agent in `/`, and a workspace there reads every folder macOS protects under home. */
async function serveClaimed(
  options: ServeHostOptions,
  output: Output,
  path: string,
): Promise<Served> {
  const socket = process.platform === "win32" ? undefined : hostSocketPath();
  const addressPath = join(dirname(path), "host-address.json");
  const saved = await readHostAddress(addressPath);
  const token = saved?.token ?? randomBytes(32).toString("base64url");

  const conflict =
    saved === null ? undefined : portConflict(saved.port, await probePort(saved.port));

  const thread = await startHostThread(options.entry, {
    kind: "local",
    port: saved === null || conflict !== undefined ? 0 : saved.port,
    token,
    authority: OWN_TOKEN_AUTHORITY,
    socket,
    tailnet: options.tailnet,
    workspace: homedir(),
  });

  const port = Number(new URL(thread.address).port);

  if (conflict !== undefined)
    process.stderr.write(
      `${conflict} Listening on port ${String(port)} instead; clients that knew the old address need ${thread.address}.\n`,
    );

  await saveHostAddress(addressPath, { port, token });

  try {
    const published = await publishHost(path, {
      url: thread.address,
      token,
      pid: process.pid,
      socket,
    });

    if (published.kind === "taken") return published;

    try {
      output.write(
        options.listening({ url: thread.address, socket, endpoint: path, pid: process.pid }),
      );

      const stopped = await Promise.race([
        aborted(options.signal).then(() => null),
        thread.ended.then(
          () => null,
          (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
        ),
      ]);

      if (stopped !== null) throw new Error(`The host stopped: ${stopped.message}`);

      return { kind: "stopped" };
    } finally {
      await withdrawHost(path, process.pid);
    }
  } finally {
    await thread.stop();
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
