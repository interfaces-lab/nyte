import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { get } from "node:http";
import { basename, dirname } from "node:path";
import process from "node:process";
import { scheduler } from "node:timers/promises";
import { ConnectViewSchema } from "@nyte-ai/connect";
import type { ConnectView } from "@nyte-ai/connect";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { serviceBuild } from "./build.ts";
import { alive, lockHolder, logPath, readRegistration, registrationPath } from "./registration.ts";
import type { Registration } from "./registration.ts";
import { SERVICE_ROUTES, ServiceClientSchema, ServiceEventSchema } from "./routes.ts";
import type { ServiceClient, ServiceEvent } from "./routes.ts";

const START_TIMEOUT_MS = 20_000;

const STOP_TIMEOUT_MS = 5_000;

/** How often `stopService` checks whether the stopped service has exited. */
const STOP_POLL_MS = 50;

export interface EnsureServiceOptions {
  readonly home: string;
  /** The client's package version; with the operations digest it forms the build the service must register, see `serviceBuild`. */
  readonly version: string;
  readonly command: readonly [string, ...string[]];
  /** Ends this client's attachment to the service; absent, the attachment lasts as long as the process. */
  readonly signal?: AbortSignal;
}

export async function findService(home: string): Promise<Registration | undefined> {
  const registration = await readRegistration(home);

  if (registration === undefined) return undefined;

  return (await answers(registration)) ? registration : undefined;
}

/**
 * Returns the running service of this client's build, starting one when none runs. A
 * service of another build is stopped and replaced; one that won't stop fails with the
 * build skew and the fix. The client then stays attached until `signal` aborts or the
 * process exits, which keeps the service from stopping while idle.
 */
export async function ensureService(options: EnsureServiceOptions): Promise<Registration> {
  const build = await serviceBuild(options.version);
  const found = await findService(options.home);

  if (found !== undefined && found.version !== build) await replace(options.home, found, build);
  const registration = found?.version === build ? found : await start(options, build);
  attach(registration, build, options.signal);

  return registration;
}

async function replace(home: string, found: Registration, build: string): Promise<void> {
  const stopped = await stopService(home).catch(() => false);

  if (!stopped && alive(found.pid)) throw new Error(skew(found, build));
}

function skew(found: Registration, build: string): string {
  return `The Nyte service (pid ${String(found.pid)}) runs build ${found.version} but this nyte is build ${build}; stop it with \`nyte service stop\` and try again.`;
}

/**
 * Holds a request to the service's attach route open for as long as this client lives.
 * Its socket is unreferenced, so it never keeps the process running, and the service
 * sees the connection end when the process exits.
 */
function attach(registration: Registration, build: string, signal: AbortSignal | undefined): void {
  const url = new URL(SERVICE_ROUTES.attach, registration.url);
  url.searchParams.set("pid", String(process.pid));
  url.searchParams.set("startedAt", String(Math.round(performance.timeOrigin)));
  url.searchParams.set("build", build);

  const request = get(url, { headers: { Authorization: `Bearer ${registration.token}` } });
  signal?.addEventListener("abort", () => request.destroy(), { once: true });
  request.on("socket", (socket) => socket.unref());
  request.on("response", (response) => response.resume());
  request.on("error", () => undefined);
}

/** Lists the clients attached to the service. */
export async function serviceClients(
  registration: Registration,
): Promise<readonly ServiceClient[]> {
  const response = await fetch(new URL(SERVICE_ROUTES.clients, registration.url), {
    headers: { Authorization: `Bearer ${registration.token}` },
  });

  if (!response.ok) throw new Error(`The Nyte service answered ${String(response.status)}.`);

  return Value.Parse(Type.Array(ServiceClientSchema), await response.json());
}

export async function stopService(home: string): Promise<boolean> {
  const pid = (await findService(home))?.pid ?? (await lockHolder(home));

  if (pid === undefined) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await scheduler.wait(STOP_POLL_MS);
  }

  throw new Error(
    `The Nyte service (pid ${String(pid)}) didn't stop within 5 s. Stop it with \`kill ${String(pid)}\`.`,
  );
}

/**
 * Starts the service and waits for it to register. The registration file is the readiness
 * signal: the service renames it into place once it listens, so each change to it (or the
 * child exiting) wakes one check instead of a timer polling for it.
 */
async function start(options: EnsureServiceOptions, build: string): Promise<Registration> {
  const log = logPath(options.home);
  const registration = registrationPath(options.home);
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });
  await mkdir(dirname(registration), { recursive: true, mode: 0o700 });
  const offset = (await stat(log).catch(() => undefined))?.size ?? 0;
  const output = await open(log, "a", 0o600);
  const [command, ...args] = options.command;
  let wake = Promise.withResolvers<void>();

  const watcher = watch(dirname(registration), (_event, file) => {
    if (file === null || file === basename(registration)) wake.resolve();
  });

  let gone = false;

  try {
    const child = spawn(command, args, {
      cwd: options.home,
      detached: true,
      stdio: ["ignore", output.fd, output.fd],
    });

    child.unref();
    await output.close();

    const exited = (): void => {
      gone = true;
      wake.resolve();
    };

    child.once("exit", exited);
    child.once("error", exited);
    const timeout = setTimeout(() => wake.resolve(), START_TIMEOUT_MS);
    const deadline = Date.now() + START_TIMEOUT_MS;

    try {
      while (Date.now() < deadline) {
        const exitedBefore = gone;
        const found = await findService(options.home);

        if (found?.version === build) return found;

        if (found !== undefined) throw new Error(skew(found, build));

        if (exitedBefore && (await lockHolder(options.home)) === undefined)
          throw new Error(`${await failureIn(log, offset)} See ${log}.`);
        await wake.promise;
        wake = Promise.withResolvers<void>();
      }
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    watcher.close();
  }

  throw new Error(`The Nyte service didn't start within 20 s. See ${log}.`);
}

async function failureIn(log: string, offset: number): Promise<string> {
  const text = await readFile(log, "utf8").catch(() => "");
  const lines = text.slice(offset).split("\n");
  const error = lines.findLast((line) => line.startsWith("error: "));

  return error === undefined
    ? "The Nyte service exited before it was ready."
    : error.slice("error: ".length);
}

async function answers(registration: Registration): Promise<boolean> {
  if (!alive(registration.pid)) return false;

  const hostId = await fetch(new URL("/.nyte/describe", registration.url), {
    signal: AbortSignal.timeout(1000),
  })
    .then((response) => response.headers.get(HOST_HEADER))
    .catch(() => null);

  return hostId === registration.hostId;
}

export interface ServiceConnect {
  view(): Promise<ConnectView>;
  watch(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  share(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  unlink(): Promise<ConnectView>;
}

export function serviceConnect(registration: Registration): ServiceConnect {
  const headers = { Authorization: `Bearer ${registration.token}` };
  const url = (path: string): URL => new URL(path, registration.url);

  const readView = async (response: Response): Promise<ConnectView> => {
    const body: unknown = await response.json();

    if (!response.ok)
      throw new Error(
        typeof body === "object" && body !== null && "message" in body
          ? String(body.message)
          : `The Nyte service answered ${String(response.status)}.`,
      );

    return Value.Parse(ConnectViewSchema, body);
  };

  return {
    view: async () => readView(await fetch(url(SERVICE_ROUTES.connect), { headers })),
    watch: (signal) => events(url(SERVICE_ROUTES.watch), headers, signal),
    share: (signal) => events(url(SERVICE_ROUTES.share), headers, signal),
    unlink: async () =>
      readView(await fetch(url(SERVICE_ROUTES.unlink), { method: "POST", headers })),
  };
}

async function* events(
  url: URL,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): AsyncIterable<ServiceEvent> {
  const response = await fetch(url, { headers, signal });

  if (!response.ok || response.body === null)
    throw new Error(`The Nyte service answered ${String(response.status)}.`);
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    for await (const chunk of response.body) {
      const lines = `${buffered}${decoder.decode(chunk, { stream: true })}`.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines)
        if (line !== "") yield Value.Parse(ServiceEventSchema, JSON.parse(line));
    }
  } catch (cause) {
    if (signal.aborted) return;

    throw cause;
  }
}
