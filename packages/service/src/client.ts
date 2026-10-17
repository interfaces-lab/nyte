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
import {
  findSupervisor,
  relaunchUnit,
  removeUnit,
  startUnit,
  supervisedPid,
  unitInstalled,
  writeUnit,
} from "./supervisor.ts";
import type { Supervisor, UnitPlan } from "./supervisor.ts";

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
 * build skew and the fix. With the service installed, its supervisor starts the unit as
 * installed, never rewritten: a service of another build there fails with the skew and
 * `nyte service install` as the fix. The client then stays attached until `signal`
 * aborts or the process exits, which keeps the service from stopping while idle.
 */
export async function ensureService(options: EnsureServiceOptions): Promise<Registration> {
  const build = await serviceBuild(options.version);
  const found = await findService(options.home);
  const registration = found?.version === build ? found : await startBuild(options, build, found);
  attach(registration, build, options.signal);

  return registration;
}

async function startBuild(
  options: EnsureServiceOptions,
  build: string,
  found: Registration | undefined,
): Promise<Registration> {
  const supervisor = findSupervisor(options.home);

  if (supervisor !== undefined && (await unitInstalled(options.home)))
    return startInstalled(options, supervisor, build, found);

  if (found !== undefined) await replace(options.home, found, build);

  return start(options, build);
}

async function replace(home: string, found: Registration, build: string): Promise<void> {
  const stopped = await stopService(home).catch(() => false);

  if (!stopped && alive(found.pid)) throw new Error(skew(found, build));
}

function skew(found: Registration, build: string): string {
  return `The Nyte service (pid ${String(found.pid)}) runs build ${found.version} but this nyte is build ${build}; stop it with \`nyte service stop\` and try again.`;
}

function installedSkew(found: Registration, build: string): string {
  return `The installed Nyte service (pid ${String(found.pid)}) runs build ${found.version} but this nyte is build ${build}; run \`nyte service install\` from this nyte to make it the service.`;
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

/** How the service is installed: `unsupported` on a platform without launchd or systemd, `absent` with no unit, or `installed` with the pid its supervisor runs it as, null when the supervisor runs none. */
export type Supervision =
  | { readonly kind: "unsupported" }
  | { readonly kind: "absent"; readonly supervisor: Supervisor }
  | { readonly kind: "installed"; readonly supervisor: Supervisor; readonly pid: number | null };

export async function readSupervision(home: string): Promise<Supervision> {
  const supervisor = findSupervisor(home);

  if (supervisor === undefined) return { kind: "unsupported" };

  if (!(await unitInstalled(home))) return { kind: "absent", supervisor };

  return { kind: "installed", supervisor, pid: await supervisedPid(supervisor) };
}

/** What `installService` did: wrote the unit and started the service under it, or found both already so. */
export interface Installed {
  readonly kind: "installed" | "unchanged";
  readonly supervisor: Supervisor;
  readonly registration: Registration;
}

/**
 * Installs the service as a launch agent (macOS) or systemd user unit (Linux) running
 * `command`: the supervisor starts it at login and after a crash, and it never stops for
 * being idle. A running service the supervisor doesn't run, or one of another build, is
 * stopped and started under the supervisor. Installing again with the same command and
 * environment changes nothing.
 */
export async function installService(options: EnsureServiceOptions): Promise<Installed> {
  const supervisor = findSupervisor(options.home);

  if (supervisor === undefined)
    throw new Error(
      `Installing the Nyte service needs launchd (macOS) or systemd (Linux); this is ${process.platform}.`,
    );
  const build = await serviceBuild(options.version);
  const found = await findService(options.home);

  if (
    found?.version === build &&
    (await supervisedPid(supervisor)) === found.pid &&
    !(await writeUnit(supervisor, unitPlan(options)))
  )
    return { kind: "unchanged", supervisor, registration: found };

  return {
    kind: "installed",
    supervisor,
    registration: await supervise(
      options,
      supervisor,
      build,
      found,
      await writeUnit(supervisor, unitPlan(options)),
    ),
  };
}

/** Stops the service the supervisor runs and removes its unit; false when none was installed. A service started outside the supervisor keeps running until it's idle. */
export async function uninstallService(home: string): Promise<boolean> {
  const supervisor = findSupervisor(home);

  return supervisor !== undefined && removeUnit(supervisor);
}

/** Starts the service as a detached child of this client and waits for it to register. */
async function start(options: EnsureServiceOptions, build: string): Promise<Registration> {
  const log = await openLog(options.home);
  const output = await open(log.path, "a", 0o600);
  const [command, ...args] = options.command;
  const exited = Promise.withResolvers<void>();

  try {
    const child = spawn(command, args, {
      cwd: options.home,
      detached: true,
      stdio: ["ignore", output.fd, output.fd],
    });

    child.unref();
    child.once("exit", () => exited.resolve());
    child.once("error", () => exited.resolve());
  } finally {
    await output.close();
  }

  return awaitRegistration(options.home, build, log, exited.promise);
}

/**
 * Starts the installed unit as it is written, for a client that did not install it: only
 * `nyte service install` writes the unit, so two installed builds never keep repointing it
 * at each other. A service of another build, running or started from the unit, fails with
 * how to make this build the service.
 */
async function startInstalled(
  options: EnsureServiceOptions,
  supervisor: Supervisor,
  build: string,
  found: Registration | undefined,
): Promise<Registration> {
  if (found !== undefined) throw new Error(installedSkew(found, build));
  const log = await openLog(options.home);
  await startUnit(supervisor);

  try {
    return await awaitRegistration(options.home, build, log, new Promise(() => undefined));
  } catch (cause) {
    const started = await findService(options.home);

    if (started !== undefined && started.version !== build)
      throw new Error(installedSkew(started, build), { cause });

    throw cause;
  }
}

/**
 * Has the supervisor run the unit `nyte service install` just wrote and waits for its
 * registration. When the unit `rewritten` or a service runs already, the supervisor stops
 * the service and starts the unit again, so it never restarts the old build behind the
 * client's back.
 */
async function supervise(
  options: EnsureServiceOptions,
  supervisor: Supervisor,
  build: string,
  found: Registration | undefined,
  rewritten: boolean,
): Promise<Registration> {
  const log = await openLog(options.home);

  try {
    if (rewritten || found !== undefined)
      await relaunchUnit(supervisor, () => stopService(options.home));
    else await startUnit(supervisor);
  } catch (cause) {
    if (found !== undefined && alive(found.pid)) throw new Error(skew(found, build));

    throw cause;
  }

  return awaitRegistration(options.home, build, log, new Promise(() => undefined));
}

/** What the installed unit runs for a client: its command in its home, with its PATH and service port. */
function unitPlan(options: EnsureServiceOptions): UnitPlan {
  const inherited = ["PATH", "NYTE_SERVICE_PORT"].flatMap((name) => {
    const value = process.env[name];

    return value === undefined ? [] : [[name, value] as const];
  });

  return {
    home: options.home,
    command: options.command,
    environment: { HOME: options.home, ...Object.fromEntries(inherited) },
  };
}

interface ServiceLog {
  readonly path: string;
  /** The log's size before this start, so only the start's own lines explain a failure. */
  readonly offset: number;
}

async function openLog(home: string): Promise<ServiceLog> {
  const path = logPath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(dirname(registrationPath(home)), { recursive: true, mode: 0o700 });

  return { path, offset: (await stat(path).catch(() => undefined))?.size ?? 0 };
}

/**
 * Waits for the service of `build` to register. The registration file is the readiness
 * signal: the service renames it into place once it listens, so each change to it, a line
 * in the log, or the started process exiting wakes one check instead of a timer polling.
 * An `error: ` line or the exit, with nothing left holding the lock, fails the start.
 */
async function awaitRegistration(
  home: string,
  build: string,
  log: ServiceLog,
  exited: Promise<void>,
): Promise<Registration> {
  const registration = registrationPath(home);
  let wake = Promise.withResolvers<void>();
  let gone = false;

  const watchers = [
    watch(dirname(registration), (_event, file) => {
      if (file === null || file === basename(registration)) wake.resolve();
    }),
    watch(dirname(log.path), () => wake.resolve()),
  ];

  void exited.then(() => {
    gone = true;
    wake.resolve();
  });

  const timeout = setTimeout(() => wake.resolve(), START_TIMEOUT_MS);
  const deadline = Date.now() + START_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      const exitedBefore = gone;
      const found = await findService(home);

      if (found?.version === build) return found;

      if (found !== undefined) throw new Error(skew(found, build));
      const failure = await failureIn(log);

      if ((exitedBefore || failure !== undefined) && (await lockHolder(home)) === undefined)
        throw new Error(
          `${failure ?? "The Nyte service exited before it was ready."} See ${log.path}.`,
        );
      await wake.promise;
      wake = Promise.withResolvers<void>();
    }
  } finally {
    clearTimeout(timeout);

    for (const watcher of watchers) watcher.close();
  }

  throw new Error(`The Nyte service didn't start within 20 s. See ${log.path}.`);
}

/** The last `error: ` line the service logged since `log.offset`, without its prefix. */
async function failureIn(log: ServiceLog): Promise<string | undefined> {
  const text = await readFile(log.path, "utf8").catch(() => "");
  const lines = text.slice(log.offset).split("\n");

  return lines.findLast((line) => line.startsWith("error: "))?.slice("error: ".length);
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
