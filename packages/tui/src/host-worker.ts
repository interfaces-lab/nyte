import { homedir } from "node:os";
import process from "node:process";
import { parentPort } from "node:worker_threads";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { StoreOwned } from "@nyte-ai/host";
import {
  PortInUse,
  ServiceRunning,
  portConflict,
  probePort,
  removeRegistration,
  serviceBuild,
  startService,
  stopHostJobs,
  watchReplacement,
  writeRegistration,
} from "@nyte-ai/service";
import type { Registration } from "@nyte-ai/service";
import { readCodeId } from "./code-id.ts";
import { readConnectConfig } from "./connect-config.ts";
import { openTerminalHost } from "./host.ts";
import { hostMessages } from "./hosting.ts";
import type { HostCommand, HostFailureReason, HostReport } from "./hosting.ts";
import { VERSION } from "./version.ts";

interface Opened {
  readonly address: string;
  close(): Promise<void>;
}

const port = parentPort;

if (port === null) throw new Error("The host worker must run on a worker thread.");

registerBunOAuthFlows();

const report = (message: HostReport): void => port.postMessage(message);

let opening: Promise<Opened | null> = Promise.resolve(null);

port.on("message", (message) => {
  if (!hostMessages.Check(message)) {
    report({
      kind: "failed",
      reason: "other",
      message: "The CLI sent a message the host thread does not know.",
    });

    return;
  }

  if (message.kind !== "stop") {
    opening = open(message).then(
      (opened) => {
        report({ kind: "listening", address: opened.address });

        return opened;
      },
      (cause: unknown) => {
        report({ kind: "failed", reason: failureReason(cause), message: failureMessage(cause) });

        return null;
      },
    );

    return;
  }

  void opening
    .then((opened) => opened?.close())
    .then(
      () => report({ kind: "closed" }),
      (cause: unknown) =>
        report({ kind: "failed", reason: "other", message: failureMessage(cause) }),
    );
});

async function open(command: HostCommand): Promise<Opened> {
  const home = homedir();

  if (command.kind === "service") {
    const service = await startService({
      open: () => openTerminalHost(),
      home,
      port: command.port,
      version: VERSION,
      code: await readCodeId(),
      connect: readConnectConfig(),
    });

    return { address: service.registration.url, close: () => service.close() };
  }

  const host = await openTerminalHost();

  try {
    const listener = await host.listen({
      transport: { kind: "http", port: command.port },
      auth: { kind: "token", token: command.token },
    });

    if (listener.address === null) throw new Error("The listener bound no address.");

    const registration: Registration = {
      url: listener.address,
      token: command.token,
      pid: process.pid,
      version: await serviceBuild(VERSION, await readCodeId()),
      hostId: host.hostId,
      owner: "serve",
      folder: process.cwd(),
    };

    await writeRegistration(home, registration);

    const unwatch = watchReplacement(home, registration, () =>
      process.kill(process.pid, "SIGTERM"),
    );

    return {
      address: listener.address,
      close: async () => {
        unwatch();
        await removeRegistration(home, registration);
        await stopHostJobs(host);
        await host.close();
      },
    };
  } catch (cause) {
    await host.close();
    const conflict = portConflict(command.port, await probePort(command.port));

    throw conflict === undefined ? cause : new PortInUse(conflict);
  }
}

function failureReason(cause: unknown): HostFailureReason {
  if (cause instanceof PortInUse) return "port-in-use";

  if (cause instanceof StoreOwned) return "store-owned";

  return cause instanceof ServiceRunning ? "service-running" : "other";
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
