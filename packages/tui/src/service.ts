import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import process from "node:process";
import type { ConnectView } from "@nyte-ai/connect";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import {
  commandLink,
  ensureService,
  findService,
  followService,
  installService,
  logPath,
  readSupervision,
  serviceBuild,
  serviceClients,
  serviceConnect,
  stopService,
  uninstallService,
} from "@nyte-ai/service";
import type {
  Following,
  Registration,
  ServiceClient,
  Stopped,
  Supervision,
  Supervisor,
} from "@nyte-ai/service";
import { readCodeId } from "./code-id.ts";
import { compiled } from "./compiled.ts";
import { HostFailure, startHostThread } from "./hosting.ts";
import type { RemoteFacts } from "./model/state.ts";
import { VERSION } from "./version.ts";

export interface ServiceSession {
  readonly connection: Connection;
  readonly following: Following;
}

export interface LocalServiceOptions {
  readonly home: string;
  readonly version: string;
  readonly code?: string;
  readonly command: readonly [string, ...string[]];
}

function servicePort(
  value: string | undefined = process.env["NYTE_SERVICE_PORT"],
  source = "NYTE_SERVICE_PORT",
): number {
  if (value === undefined || value === "") return 0;
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${source} must be a port from 1 to 65535.`);

  return port;
}

async function serviceCommand(home: string): Promise<[string, ...string[]]> {
  const script = process.argv[1];

  if (!compiled && script !== undefined) return [process.execPath, script, "service", "run"];
  const link = commandLink(home);

  const [linked, running] = await Promise.all([
    realpath(link).catch(() => undefined),
    realpath(process.execPath),
  ]);

  return [linked === running ? link : process.execPath, "service", "run"];
}

export async function localServiceOptions(): Promise<LocalServiceOptions> {
  const home = homedir();

  return { home, version: VERSION, code: await readCodeId(), command: await serviceCommand(home) };
}

export async function ensureLocalService(): Promise<Registration> {
  return ensureService(await localServiceOptions());
}

export async function connectLocalService(options?: LocalServiceOptions): Promise<ServiceSession> {
  const following = followService(options ?? (await localServiceOptions()));
  const first = await following.first;

  const connection = await sdk.connect({
    url: first.url,
    credentials: { kind: "token", token: first.token },
    expect: { hostId: asId(first.hostId) },
    fetch: (resource, init) => fetchFollowing(following, resource, init),
  });

  return { connection, following };
}

function fetchFollowing(
  following: Following,
  resource: string,
  init: RequestInit | undefined,
): Promise<Response> {
  const current = following.current();

  if (current === undefined) return fetch(resource, init);
  const requested = new URL(resource);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${current.token}`);

  return fetch(new URL(`${requested.pathname}${requested.search}`, current.url), {
    ...init,
    headers,
  });
}

export function followRemote(
  following: Following,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
  failed: (cause: unknown) => void,
): void {
  let watching: AbortController | undefined;

  const start = (registration: Registration): void => {
    watching?.abort();
    const controller = new AbortController();
    watching = controller;
    void watchRemote(registration, AbortSignal.any([signal, controller.signal]), report).catch(
      (cause: unknown) => {
        if (!controller.signal.aborted && !signal.aborted) failed(cause);
      },
    );
  };

  const current = following.current();

  if (current !== undefined) start(current);
  const leave = following.subscribe(start);
  signal.addEventListener(
    "abort",
    () => {
      leave();
      watching?.abort();
    },
    { once: true },
  );
}

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

export async function serviceCommandMain(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  const [command = "status", ...rest] = args;
  const home = homedir();

  switch (command) {
    case "status": {
      if (rest.length > 0) throw new Error("Usage: nyte service status");
      const [running, supervision] = await Promise.all([findService(home), readSupervision(home)]);
      const installed = describeSupervision(
        supervision,
        running === undefined || running.owner !== undefined ? undefined : running.pid,
      );

      const build = await serviceBuild(VERSION, await readCodeId());

      if (running === undefined) {
        output.write(
          lines([
            "Nyte service isn't running. Any nyte command starts it.",
            installed,
            `This nyte is build ${build}.`,
          ]),
        );

        return;
      }

      const header = [describeRunning(running), installed];

      if (running.owner === "serve") {
        output.write(lines(header));

        return;
      }

      if (running.owner !== "desktop" && running.version !== build) {
        output.write(
          lines([...header, `This nyte is build ${build}; its next command replaces the service.`]),
        );

        return;
      }

      const clients = await serviceClients(running);

      output.write(lines([...header, ...describeClients(clients)]));

      return;
    }

    case "stop": {
      if (rest.length > 0) throw new Error("Usage: nyte service stop");
      const report = await stopService(home);
      const supervision = await readSupervision(home);

      const restarts =
        supervision.kind === "installed" &&
        report.some((entry) => entry.kind === "stopped" && entry.owner === "service")
          ? `It's installed as ${unitName(supervision.supervisor)}, so it starts again at login; \`nyte service uninstall\` keeps it stopped.`
          : undefined;

      output.write(
        lines(
          report.length === 0
            ? ["Nyte service isn't running."]
            : [...report.flatMap(describeStopped), restarts],
        ),
      );

      return;
    }

    case "install": {
      if (rest.length > 0) throw new Error("Usage: nyte service install");

      const installed = await installService(await localServiceOptions());

      output.write(
        installed.kind === "unchanged"
          ? `The Nyte service is already installed as ${unitName(installed.supervisor)}.\n`
          : `Installed the Nyte service as ${unitName(installed.supervisor)}.\nIt runs as pid ${String(installed.registration.pid)}, starts at login, restarts after a crash, and logs to ${logPath(home)}.\n`,
      );

      return;
    }

    case "uninstall": {
      if (rest.length > 0) throw new Error("Usage: nyte service uninstall");
      output.write(
        (await uninstallService(home))
          ? "Uninstalled and stopped the Nyte service. Any nyte command starts it again.\n"
          : "The Nyte service isn't installed.\n",
      );

      return;
    }

    case "run":
      return runService(rest, signal, output);
    default:
      throw new Error(`Unknown service command: ${command}. Run \`nyte service --help\`.`);
  }
}

function describeRunning(running: Registration): string {
  const where = `${running.version} at ${running.url} (pid ${String(running.pid)})`;

  switch (running.owner) {
    case "desktop":
      return `Nyte.app ${where} has your chats open; nyte uses it instead of the service while it runs.`;
    case "serve":
      return `\`nyte serve\` ${where} has your chats open in ${running.folder}; stop it with \`nyte service stop\` before another nyte can use them.`;
    case "service":
    case undefined:
      return `Nyte service ${where}`;
    default: {
      const _exhaustive: never = running;

      return _exhaustive;
    }
  }
}

function describeClients(clients: readonly ServiceClient[]): readonly string[] {
  return [
    clients.length === 0
      ? "No clients attached."
      : `${String(clients.length)} ${clients.length === 1 ? "client" : "clients"} attached:`,
    ...clients.map(describeClient),
  ];
}

function describeStopped(entry: Stopped): readonly string[] {
  switch (entry.kind) {
    case "stopped": {
      const what =
        entry.owner === "serve" ? "`nyte serve`" : `the Nyte service (pid ${String(entry.pid)})`;

      const ended =
        entry.how === "exited"
          ? `Stopped ${what}.`
          : `Killed ${what} after it ignored SIGTERM for 5 s.`;

      return entry.orphans === 0
        ? [ended]
        : [
            `${ended} Killed ${String(entry.orphans)} ${entry.orphans === 1 ? "process" : "processes"} it left behind.`,
          ];
    }
    case "owner":
      return [
        `${entry.how === "exited" ? "Stopped" : "Killed"} the Nyte process holding the store (pid ${String(entry.pid)}, ${entry.program}).`,
      ];
    case "held":
      return [
        `Something that isn't Nyte holds the store (pid ${String(entry.pid)}, ${entry.program}); nyte left it alone.`,
      ];
    case "desktop":
      return [
        `Nyte.app (pid ${String(entry.registration.pid)}) has your chats open; quit it to close them.`,
        ...describeClients(entry.clients),
      ];
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

function unitName(supervisor: Supervisor): string {
  return `${supervisor.kind === "launchd" ? "a launch agent" : "a systemd user unit"} at ${supervisor.unit}`;
}

function describeSupervision(
  supervision: Supervision,
  running: number | undefined,
): string | undefined {
  switch (supervision.kind) {
    case "unsupported":
      return undefined;
    case "absent":
      return "Not installed. `nyte service install` starts it at login and keeps it running.";
    case "installed": {
      const { supervisor, pid } = supervision;

      return running === undefined || pid === running
        ? `Installed as ${unitName(supervisor)}; it starts at login and comes back after a crash.`
        : `Installed as ${unitName(supervisor)}, but ${supervisor.kind} isn't supervising this service; run \`nyte service install\` to hand it over.`;
    }
    default: {
      const _exhaustive: never = supervision;

      return _exhaustive;
    }
  }
}

function lines(rows: readonly (string | undefined)[]): string {
  return `${rows.filter((row) => row !== undefined).join("\n")}\n`;
}

async function runService(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  const service = await startHostThread({ kind: "service", port: parseRunPort(args) }).catch(
    (cause: unknown) => {
      if (!(cause instanceof HostFailure)) throw cause;

      if (cause.reason === "store-owned" || cause.reason === "service-running") {
        output.error(`error: ${cause.message}`);

        return null;
      }

      if (cause.reason === "port-in-use")
        throw new Error(
          `${cause.message} Free it, or ${args.length === 0 ? "set NYTE_SERVICE_PORT to" : "pass"} another port.`,
        );

      throw cause;
    },
  );

  if (service === null) return;
  output.write(`Nyte service at ${service.address} (pid ${String(process.pid)})\n`);

  const stopped = new Promise((done) => signal.addEventListener("abort", done, { once: true }));

  if (!signal.aborted) await Promise.race([stopped, service.ended]);
  await service.stop();
}

function describeClient(client: ServiceClient): string {
  return `  pid ${String(client.pid)}, started ${new Date(client.startedAt).toLocaleString()}, ${client.tty ?? "no terminal"}, build ${client.build}`;
}

function parseRunPort(args: readonly string[]): number {
  if (args.length === 0) return servicePort();

  if (args.length === 2 && args[0] === "--port") return servicePort(args[1], "--port");

  if (args.length === 1 && args[0].startsWith("--port="))
    return servicePort(args[0].slice("--port=".length), "--port");

  throw new Error("Usage: nyte service run [--port <n>]");
}

export async function watchRemote(
  registration: Registration,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
): Promise<void> {
  for await (const event of serviceConnect(registration).watch(signal))
    if (event.kind === "view") report(remoteFacts(event.view));
}

function remoteFacts(view: ConnectView): RemoteFacts {
  if (view.kind !== "linked") return { kind: "off" };

  switch (view.connection.kind) {
    case "stopped":
      return { kind: "off" };
    case "connecting":
    case "retrying":
      return { kind: "connecting" };
    case "failed":
      return { kind: "interrupted" };
    case "connected":
      break;
    default: {
      const _exhaustive: never = view.connection;

      return _exhaustive;
    }
  }

  switch (view.lease.kind) {
    case "current":
      return { kind: "shared", devices: view.devices.length };
    case "pending":
    case "stopped":
      return { kind: "connecting" };
    case "lapsed":
      return { kind: "interrupted" };
    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}
