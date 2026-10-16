import { homedir } from "node:os";
import process from "node:process";
import type { ConnectView } from "@nyte-ai/connect";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";
import type { Connection } from "@nyte-ai/sdk";
import {
  ensureService,
  findService,
  PortInUse,
  serviceConnect,
  ServiceRunning,
  startService,
  stopService,
} from "@nyte-ai/service";
import type { Registration } from "@nyte-ai/service";
import { compiled } from "./codemode-runtime.ts";
import type { RemoteFacts } from "./model/state.ts";
import { readConnectConfig } from "./connect-config.ts";
import { openTerminalHost } from "./host.ts";
import { VERSION } from "./version.ts";

export interface ServiceSession {
  readonly registration: Registration;
  readonly connection: Connection;
}

export function servicePort(
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
      const running = await findService(home);

      output.write(
        running === undefined
          ? "Nyte service isn't running. Any nyte command starts it.\n"
          : `Nyte service ${running.version} at ${running.url} (pid ${String(running.pid)})\n`,
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

    case "run":
      return runService(rest, signal, output);
    default:
      throw new Error(`Unknown service command: ${command}. Run \`nyte service --help\`.`);
  }
}

async function runService(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  const port = parseRunPort(args);
  const home = homedir();
  const service = await startService({
    open: () => openTerminalHost(),
    home,
    port,
    version: VERSION,
    connect: readConnectConfig(),
  }).catch((cause: unknown) => {
    if (cause instanceof PortInUse)
      throw new Error(
        `${cause.message} Free it, or ${args.length === 0 ? "set NYTE_SERVICE_PORT to" : "pass"} another port.`,
      );

    if (cause instanceof ServiceRunning)
      throw new Error(`${cause.message} Stop it with \`nyte service stop\`.`);

    throw cause;
  });

  output.write(
    `Nyte service at ${service.registration.url} (pid ${String(service.registration.pid)})\n`,
  );

  if (!signal.aborted)
    await new Promise((done) => signal.addEventListener("abort", done, { once: true }));
  await service.close();
}

function parseRunPort(args: readonly string[]): number {
  if (args.length === 0) return servicePort();

  if (args.length === 2 && args[0] === "--port") return servicePort(args[1], "--port");

  if (args.length === 1 && args[0]?.startsWith("--port=") === true)
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

export function remoteFacts(view: ConnectView): RemoteFacts {
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
