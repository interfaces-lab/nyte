import { homedir } from "node:os";
import { parentPort } from "node:worker_threads";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { PortInUse, ServiceRunning, portConflict, probePort, startService } from "@nyte-ai/service";
import { readConnectConfig } from "./connect-config.ts";
import { openTerminalHost } from "./host.ts";
import type { HostCommand, HostFailureReason, HostMessage, HostReport } from "./hosting.ts";
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

port.on("message", (message: HostMessage) => {
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
  if (command.kind === "service") {
    const service = await startService({
      open: () => openTerminalHost(),
      home: homedir(),
      port: command.port,
      version: VERSION,
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

    return { address: listener.address, close: () => host.close() };
  } catch (cause) {
    await host.close();
    const conflict = portConflict(command.port, await probePort(command.port));

    throw conflict === undefined ? cause : new PortInUse(conflict);
  }
}

function failureReason(cause: unknown): HostFailureReason {
  if (cause instanceof PortInUse) return "port-in-use";

  return cause instanceof ServiceRunning ? "service-running" : "other";
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
