import { homedir } from "node:os";
import process from "node:process";
import type { ConnectView } from "@nyte-ai/connect";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import {
  ensureService,
  findService,
  installService,
  logPath,
  readSupervision,
  serviceBuild,
  serviceClients,
  serviceConnect,
  stopService,
  uninstallService,
} from "@nyte-ai/service";
import type { Registration, ServiceClient, Supervision, Supervisor } from "@nyte-ai/service";
import { compiled } from "./compiled.ts";
import { HostFailure, startHostThread } from "./hosting.ts";
import type { RemoteFacts } from "./model/state.ts";
import { VERSION } from "./version.ts";

export interface ServiceSession {
  readonly registration: Registration;
  readonly connection: Connection;
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

function serviceCommand(): [string, ...string[]] {
  const script = process.argv[1];

  return compiled || script === undefined
    ? [process.execPath, "service", "run"]
    : [process.execPath, script, "service", "run"];
}

export function ensureLocalService(): Promise<Registration> {
  return ensureService({
    home: homedir(),
    version: VERSION,
    command: serviceCommand(),
  });
}

export async function connectLocalService(): Promise<ServiceSession> {
  const registration = await ensureLocalService();

  const connection = await sdk.connect({
    url: registration.url,
    credentials: { kind: "token", token: registration.token },
    expect: { hostId: asId(registration.hostId) },
  });

  return { registration, connection };
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
      const installed = describeSupervision(supervision, running?.pid);

      if (running === undefined) {
        output.write(lines(["Nyte service isn't running. Any nyte command starts it.", installed]));

        return;
      }

      const header = [
        `Nyte service ${running.version} at ${running.url} (pid ${String(running.pid)})`,
        installed,
      ];

      const build = await serviceBuild(VERSION);

      if (running.version !== build) {
        output.write(
          lines([...header, `This nyte is build ${build}; its next command replaces the service.`]),
        );

        return;
      }

      const clients = await serviceClients(running);

      output.write(
        lines([
          ...header,
          clients.length === 0
            ? "No clients attached."
            : `${String(clients.length)} ${clients.length === 1 ? "client" : "clients"} attached:`,
          ...clients.map(describeClient),
        ]),
      );

      return;
    }

    case "stop": {
      if (rest.length > 0) throw new Error("Usage: nyte service stop");
      output.write(
        (await stopService(home)) ? "Stopped the Nyte service.\n" : "Nyte service isn't running.\n",
      );

      return;
    }

    case "install": {
      if (rest.length > 0) throw new Error("Usage: nyte service install");

      const installed = await installService({
        home,
        version: VERSION,
        command: serviceCommand(),
      });

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

function unitName(supervisor: Supervisor): string {
  return `${supervisor.kind === "launchd" ? "a launch agent" : "a systemd user unit"} at ${supervisor.unit}`;
}

/** The status line on how the service is installed, given the pid of the running service; none where it can't be. */
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
        ? `Installed as ${unitName(supervisor)}.`
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

      if (cause.reason === "port-in-use")
        throw new Error(
          `${cause.message} Free it, or ${args.length === 0 ? "set NYTE_SERVICE_PORT to" : "pass"} another port.`,
        );

      if (cause.reason === "service-running")
        throw new Error(`${cause.message} Stop it with \`nyte service stop\`.`);

      throw cause;
    },
  );

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
