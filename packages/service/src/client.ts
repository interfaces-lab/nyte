import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { get } from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { scheduler } from "node:timers/promises";
import { ConnectViewSchema } from "@nyte-ai/connect";
import type { ConnectView } from "@nyte-ai/connect";
import { HOST_HEADER, operationsDigest } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { serviceBuild } from "./build.ts";
import {
  alive,
  lockHolder,
  readRegistrations,
  registrationOwner,
  registrationPath,
  registrationWatcher,
} from "./registration.ts";
import type { Owner, Registration } from "./registration.ts";
import {
  BusySchema,
  HandoffSchema,
  SERVICE_ROUTES,
  ServiceClientSchema,
  ServiceEventSchema,
} from "./routes.ts";
import type { Busy, Handoff, ServiceClient, ServiceEvent } from "./routes.ts";
import { readStoreOwner } from "./store-owner.ts";
import {
  findSupervisor,
  logPath,
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

const RETIRE_TIMEOUT_MS = 5_000;

const STOP_POLL_MS = 50;

const FOLLOW_DEADLINE_MS = 30_000;

const FOLLOW_RETRY_MS = 1_000;

export interface EnsureServiceOptions {
  readonly home: string;
  readonly version: string;
  readonly code?: string;
  readonly command: readonly [string, ...string[]];
  readonly signal?: AbortSignal;
  readonly lost?: (successor: Handoff["to"] | null) => void;
}

export async function findService(home: string): Promise<Registration | undefined> {
  for (const registration of await readRegistrations(home))
    if (await answers(registration)) return registration;

  return undefined;
}

export async function ensureService(options: EnsureServiceOptions): Promise<Registration> {
  return attachOnce(options, null, options.lost);
}

export interface Following {
  readonly first: Promise<Registration>;
  current(): Registration | undefined;
  subscribe(listener: (registration: Registration) => void): () => void;
  readonly ended: Promise<Error>;
}

export function followService(options: Omit<EnsureServiceOptions, "lost">): Following {
  const first = Promise.withResolvers<Registration>();
  const ended = Promise.withResolvers<Error>();
  const listeners = new Set<(registration: Registration) => void>();
  let current: Registration | undefined;
  first.promise.catch(() => undefined);

  const follow = async (successor: Handoff["to"] | null): Promise<void> => {
    const deadline = Date.now() + FOLLOW_DEADLINE_MS;
    const left = current;

    for (;;) {
      try {
        const registration = await attachOnce(
          options,
          successor === null || left === undefined ? null : { to: successor, from: left },
          (next) => void follow(next),
        );

        const initial = current === undefined;
        current = registration;

        if (initial) first.resolve(registration);
        else for (const listener of listeners) listener(registration);

        return;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));

        if (options.signal?.aborted === true) return;

        if (current === undefined) {
          first.reject(error);

          return;
        }

        if (Date.now() >= deadline) {
          ended.resolve(error);

          return;
        }

        successor = null;
        await scheduler.wait(FOLLOW_RETRY_MS);
      }
    }
  };

  void follow(null);

  return {
    first: first.promise,
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    ended: ended.promise,
  };
}

async function attachOnce(
  options: Omit<EnsureServiceOptions, "lost">,
  handoff: { readonly to: Handoff["to"]; readonly from: Registration } | null,
  lost: EnsureServiceOptions["lost"],
): Promise<Registration> {
  const build = await serviceBuild(options.version, options.code);

  const registration =
    (handoff === null ? undefined : await awaitSuccessor(options.home, handoff.from)) ??
    (await locate(options, build));

  if (registration.owner === "desktop" && registration.operations !== (await operationsDigest()))
    throw new Error(desktopSkew(registration, build));
  attach(registration, build, options.signal, lost);

  return registration;
}

async function locate(
  options: Omit<EnsureServiceOptions, "lost">,
  build: string,
): Promise<Registration> {
  const found = await findService(options.home);

  if (found?.owner === "serve") throw new Error(serveOwns(found));

  return found !== undefined && serves(found, build) ? found : startBuild(options, build, found);
}

async function startBuild(
  options: Omit<EnsureServiceOptions, "lost">,
  build: string,
  found: Registration | undefined,
): Promise<Registration> {
  const supervisor = findSupervisor(options.home);

  if (found !== undefined) await replace(found, build);

  if (supervisor !== undefined && (await unitInstalled(options.home)))
    return supervise(
      options,
      supervisor,
      build,
      undefined,
      await writeUnit(supervisor, unitPlan(options)),
    );

  return start(options, build);
}

async function replace(found: Registration, build: string): Promise<void> {
  const retirement = await retire(found, undefined);

  if (retirement.kind === "busy") throw new Error(busy(found, build, retirement.busy));

  if (retirement.kind === "running") throw new Error(skew(found, build));
}

export type Retirement =
  | { readonly kind: "none" }
  | { readonly kind: "stopped"; readonly registration: Registration }
  | { readonly kind: "busy"; readonly registration: Registration; readonly busy: Busy }
  | { readonly kind: "running"; readonly registration: Registration }
  | { readonly kind: "desktop"; readonly registration: Registration }
  | { readonly kind: "serve"; readonly registration: Registration };

export async function retireService(home: string): Promise<Retirement> {
  const found = await findService(home);

  if (found === undefined) return { kind: "none" };

  if (found.owner === "desktop" || found.owner === "serve")
    return { kind: found.owner, registration: found };

  return retire(found, await operationsDigest());
}

async function retire(found: Registration, takeover: string | undefined): Promise<Retirement> {
  const url = new URL(SERVICE_ROUTES.retire, found.url);
  url.searchParams.set("pid", String(process.pid));

  if (takeover !== undefined) url.searchParams.set("operations", takeover);
  let answer: Response | undefined;

  try {
    answer = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${found.token}` },
      signal: AbortSignal.timeout(RETIRE_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError")
      return { kind: "running", registration: found };
  }

  if (answer?.status === 409)
    return {
      kind: "busy",
      registration: found,
      busy: Value.Parse(BusySchema, await answer.json()),
    };

  const stopped =
    answer?.ok === true
      ? await exited(found.pid)
      : !(await answers(found)) || (await terminate(found.pid));

  return stopped || !alive(found.pid)
    ? { kind: "stopped", registration: found }
    : { kind: "running", registration: found };
}

function serves(found: Registration, build: string): boolean {
  return found.owner === "desktop" || found.version === build;
}

function desktopSkew(found: Registration, build: string): string {
  return `Nyte.app (pid ${String(found.pid)}) has your chats open, and its build ${found.version} speaks another protocol than this nyte, build ${build}. Update nyte or Nyte.app so both are the same release, or quit Nyte.app, and try again.`;
}

function desktopOwns(found: Registration): string {
  return `Nyte.app (pid ${String(found.pid)}) has your chats open, and nyte uses it instead of the Nyte service while it runs.`;
}

function serveOwns(found: Registration): string {
  return `\`nyte serve\` (pid ${String(found.pid)}) has your chats open at ${found.url}. Stop it with \`nyte service stop\` and try again.`;
}

function skew(found: Registration, build: string): string {
  return `The Nyte service (pid ${String(found.pid)}) runs build ${found.version} but this nyte is build ${build}; stop it with \`nyte service stop\` and try again.`;
}

function busy(found: Registration, build: string, reason: Busy): string {
  const users =
    reason.clients > 0
      ? `${String(reason.clients)} other ${reason.clients === 1 ? "client still uses" : "clients still use"} it`
      : "a run or job is still working in it";

  return `The Nyte service (pid ${String(found.pid)}) runs build ${found.version} but this nyte is build ${build}, and ${users}. Quit them, or stop it with \`nyte service stop\`, and try again.`;
}

function attach(
  registration: Registration,
  build: string,
  signal: AbortSignal | undefined,
  lost: EnsureServiceOptions["lost"],
): void {
  const url = new URL(SERVICE_ROUTES.attach, registration.url);
  url.searchParams.set("pid", String(process.pid));
  url.searchParams.set("startedAt", String(Math.round(performance.timeOrigin)));
  url.searchParams.set("build", build);
  url.searchParams.set("follows", "1");

  const request = get(url, { headers: { Authorization: `Bearer ${registration.token}` } });
  let received = "";
  let ended = false;

  const end = (): void => {
    if (ended || signal?.aborted === true) return;
    ended = true;
    lost?.(readHandoff(received)?.to ?? null);
  };

  signal?.addEventListener("abort", () => request.destroy(), { once: true });
  request.on("socket", (socket) => socket.unref());
  request.on("response", (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      received += chunk;
    });
    response.on("close", end);
  });
  request.on("error", end);
  request.on("close", end);
}

function readHandoff(received: string): Handoff | undefined {
  const line = received.trim().split("\n").at(-1);

  if (line === undefined || line === "") return undefined;

  try {
    const parsed: unknown = JSON.parse(line);

    return Value.Check(HandoffSchema, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function serviceClients(
  registration: Registration,
): Promise<readonly ServiceClient[]> {
  const response = await fetch(new URL(SERVICE_ROUTES.clients, registration.url), {
    headers: { Authorization: `Bearer ${registration.token}` },
  });

  if (!response.ok) throw new Error(`The Nyte service answered ${String(response.status)}.`);

  return Value.Parse(Type.Array(ServiceClientSchema), await response.json());
}

export type Stopped =
  | {
      readonly kind: "stopped";
      readonly owner: Owner;
      readonly pid: number;
      readonly how: "exited" | "killed";
      readonly orphans: number;
    }
  | {
      readonly kind: "owner";
      readonly pid: number;
      readonly program: string;
      readonly how: "exited" | "killed";
    }
  | {
      readonly kind: "desktop";
      readonly registration: Registration;
      readonly clients: readonly ServiceClient[];
    }
  | { readonly kind: "held"; readonly pid: number; readonly program: string };

export async function stopService(home: string): Promise<readonly Stopped[]> {
  const report: Stopped[] = [];
  const known = new Set<number>();

  for (const registration of await readRegistrations(home)) {
    if (!(await answers(registration))) continue;
    known.add(registration.pid);

    if (registration.owner === "desktop") {
      report.push({
        kind: "desktop",
        registration,
        clients: await serviceClients(registration).catch(() => []),
      });

      continue;
    }

    const { how, orphans } = await stopProcess(registration.pid);
    report.push({
      kind: "stopped",
      owner: registrationOwner(registration),
      pid: registration.pid,
      how,
      orphans,
    });
  }

  const locked = await lockHolder(home);

  if (locked !== undefined && !known.has(locked)) {
    known.add(locked);
    const { how, orphans } = await stopProcess(locked);
    report.push({ kind: "stopped", owner: "service", pid: locked, how, orphans });
  }

  const owner = readStoreOwner(join(home, ".nyte", "nyte.db"));

  if (owner === undefined || known.has(owner.pid) || !alive(owner.pid)) return report;

  if (!/nyte/iu.test(owner.program)) {
    report.push({ kind: "held", pid: owner.pid, program: owner.program });

    return report;
  }

  const { how } = await stopProcess(owner.pid);
  report.push({ kind: "owner", pid: owner.pid, program: owner.program, how });

  return report;
}

async function stopProcess(
  pid: number,
): Promise<{ readonly how: "exited" | "killed"; readonly orphans: number }> {
  const children = await descendants(pid);

  if (await terminate(pid)) return { how: "exited", orphans: await reap(children) };

  for (const child of children) kill(child, "SIGKILL");
  kill(pid, "SIGKILL");
  await exited(pid);

  return { how: "killed", orphans: await reap(children) };
}

async function reap(children: readonly number[]): Promise<number> {
  const orphaned = (await orphans()).filter((pid) => children.includes(pid));

  for (const pid of orphaned) kill(pid, "SIGKILL");

  return orphaned.length;
}

function kill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    return;
  }
}

async function processTable(): Promise<ReadonlyMap<number, number>> {
  const listed = await new Promise<string>((done) => {
    execFile("ps", ["-axo", "pid=,ppid="], (_error, stdout) => done(stdout));
  });

  return new Map(
    listed.split("\n").flatMap((line) => {
      const [pid = "", ppid = ""] = line.trim().split(/\s+/u);

      return pid === "" ? [] : [[Number(pid), Number(ppid)] as const];
    }),
  );
}

export async function descendants(pid: number): Promise<readonly number[]> {
  const table = await processTable();
  const found: number[] = [];
  const queue = [pid];

  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift())
    for (const [child, ppid] of table)
      if (ppid === parent && !found.includes(child)) {
        found.push(child);
        queue.push(child);
      }

  return found;
}

async function orphans(): Promise<readonly number[]> {
  const table = await processTable();

  return [...table].flatMap(([pid, ppid]) => (ppid === 1 ? [pid] : []));
}

async function terminate(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  return exited(pid);
}

async function exited(pid: number): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await scheduler.wait(STOP_POLL_MS);
  }

  return false;
}

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

export interface Installed {
  readonly kind: "installed" | "unchanged";
  readonly supervisor: Supervisor;
  readonly registration: Registration;
}

export async function installService(options: EnsureServiceOptions): Promise<Installed> {
  const supervisor = findSupervisor(options.home);

  if (supervisor === undefined)
    throw new Error(
      `Installing the Nyte service needs launchd (macOS) or systemd (Linux); this is ${process.platform}.`,
    );
  const build = await serviceBuild(options.version, options.code);
  const found = await findService(options.home);

  if (found?.owner === "desktop")
    throw new Error(`${desktopOwns(found)} Quit Nyte.app, then install the service.`);

  if (found?.owner === "serve") throw new Error(serveOwns(found));

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

export async function uninstallService(home: string): Promise<boolean> {
  const supervisor = findSupervisor(home);

  return supervisor !== undefined && removeUnit(supervisor);
}

async function start(
  options: Omit<EnsureServiceOptions, "lost">,
  build: string,
): Promise<Registration> {
  const log = await openLog(options.home);
  const output = await open(log.path, "a", 0o600);
  const [command, ...args] = options.command;
  const exited = Promise.withResolvers<void>();

  try {
    const child = spawn(command, args, {
      cwd: options.home,
      env: { ...process.env, HOME: options.home },
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

async function supervise(
  options: Omit<EnsureServiceOptions, "lost">,
  supervisor: Supervisor,
  build: string,
  found: Registration | undefined,
  rewritten: boolean,
): Promise<Registration> {
  const log = await openLog(options.home);

  try {
    if (rewritten || found !== undefined)
      await relaunchUnit(supervisor, async () => {
        await stopService(options.home);

        return true;
      });
    else await startUnit(supervisor);
  } catch (cause) {
    if (found !== undefined && alive(found.pid)) throw new Error(skew(found, build));

    throw cause;
  }

  return awaitRegistration(options.home, build, log, new Promise(() => undefined));
}

function unitPlan(options: Pick<EnsureServiceOptions, "home" | "command">): UnitPlan {
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
  readonly offset: number;
}

async function openLog(home: string): Promise<ServiceLog> {
  const path = logPath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(dirname(registrationPath(home)), { recursive: true, mode: 0o700 });

  return { path, offset: (await stat(path).catch(() => undefined))?.size ?? 0 };
}

async function awaitRegistration(
  home: string,
  build: string,
  log: ServiceLog,
  exited: Promise<void>,
): Promise<Registration> {
  let wake = Promise.withResolvers<void>();
  let gone = false;

  const stops = [
    registrationWatcher(home, () => wake.resolve()),
    (() => {
      const watcher = watch(dirname(log.path), () => wake.resolve());

      return () => watcher.close();
    })(),
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

      if (found?.owner === "serve") throw new Error(serveOwns(found));

      if (found !== undefined && serves(found, build)) return found;

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

    for (const stop of stops) stop();
  }

  throw new Error(`The Nyte service didn't start within 20 s. See ${log.path}.`);
}

async function awaitSuccessor(home: string, left: Registration): Promise<Registration | undefined> {
  let wake = Promise.withResolvers<void>();
  const stop = registrationWatcher(home, () => wake.resolve());
  const timeout = setTimeout(() => wake.resolve(), START_TIMEOUT_MS);
  const deadline = Date.now() + START_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      const found = await findService(home);

      if (found !== undefined && found.url !== left.url) return found;
      await wake.promise;
      wake = Promise.withResolvers<void>();
    }

    return undefined;
  } finally {
    clearTimeout(timeout);
    stop();
  }
}

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
    if (!response.ok) throw await refusal(response);

    return Value.Parse(ConnectViewSchema, await response.json());
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

  if (!response.ok || response.body === null) throw await refusal(response);
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

const RefusalSchema = Type.Object({ message: Type.String() });

async function refusal(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);

  return new Error(
    Value.Check(RefusalSchema, body)
      ? body.message
      : `The Nyte service answered ${String(response.status)}.`,
  );
}
