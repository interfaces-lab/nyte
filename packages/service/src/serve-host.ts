import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import {
  findRunningHost,
  hostFilePath,
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
}

/** Serves the store on 127.0.0.1 and, off Windows, on `host.sock` until `signal` aborts, keeping its port and token in `host-address.json` across restarts and publishing the URL and token in `host.json` for clients to attach to. What `nyte host` and the desktop app's host run. */
export async function serveHost(options: ServeHostOptions): Promise<void> {
  if (!options.log) return serve(options, options.output);
  const log = hostLogPath();
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });

  const logged = {
    write: (text: string) => void appendFile(log, text, { mode: 0o600 }).catch(() => undefined),
  };

  try {
    await serve(options, logged);
  } catch (cause) {
    await appendFile(
      log,
      `${new Date().toISOString()} ${cause instanceof Error ? cause.message : String(cause)}\n`,
      { mode: 0o600 },
    );

    throw cause;
  }
}

async function serve(options: ServeHostOptions, output: Output): Promise<void> {
  const path = hostFilePath();
  const socket = process.platform === "win32" ? undefined : hostSocketPath();
  const running = await findRunningHost(path);

  if (running !== null) throw new Error(alreadyRunning(running, path));
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

    if (published.kind === "taken") throw new Error(alreadyRunning(published.by, path));

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
    } finally {
      await withdrawHost(path, process.pid);
    }
  } finally {
    await thread.stop();
  }
}

function alreadyRunning(host: RunningHost, path: string): string {
  return `A Nyte host is already running at ${host.url} (pid ${String(host.pid)}, named in ${path}). Stop it first, or attach to it.`;
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
