import { homedir } from "node:os";
import { parentPort } from "node:worker_threads";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { ConnectRuntime, hostShare, machineName } from "@nyte-ai/connect/host";
import { portConflict, probePort, Sharing } from "@nyte-ai/service";
import { readConnectConfig } from "./connect-config.ts";
import { openTerminalHost } from "./host.ts";
import { hostMessages } from "./hosting.ts";
import type { HostCommand, HostReport } from "./hosting.ts";

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
    report({ kind: "failed", message: "The CLI sent a message the host thread does not know." });

    return;
  }

  if (message.kind !== "stop") {
    opening = open(message).then(
      (opened) => {
        report({ kind: "listening", address: opened.address });

        return opened;
      },
      (cause: unknown) => {
        report({ kind: "failed", message: failureMessage(cause) });

        return null;
      },
    );

    return;
  }

  void opening
    .then((opened) => opened?.close())
    .then(
      () => report({ kind: "closed" }),
      (cause: unknown) => report({ kind: "failed", message: failureMessage(cause) }),
    );
});

const revoked = (): void =>
  void opening
    .then((opened) => opened?.close())
    .catch(() => undefined)
    .then(() => report({ kind: "revoked" }));

async function open(command: HostCommand): Promise<Opened> {
  const host = await openTerminalHost({
    label: "nyte",
    onRevoked: revoked,
  });

  let sharing: Sharing | null = null;

  const connect = new ConnectRuntime({
    config: readConnectConfig(),
    home: `${homedir()}/.nyte`,
    authorizer: { kind: "transaction", onOpened: () => undefined },
    onChange: () => sharing?.changed(),
    name: machineName(),
  });

  sharing = new Sharing({ connect, share: hostShare(host), home: homedir() });

  try {
    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1", port: command.port },
      auth: { kind: "token", token: command.token, authority: new Set(command.authority) },
      before: sharing.routes(command.token),
    });

    if (listener.address === null) throw new Error("The listener bound no address.");
    sharing.start();

    return {
      address: listener.address,
      close: async () => {
        await sharing.close();
        await connect.close();
        await host.close();
      },
    };
  } catch (cause) {
    await sharing.close();
    await connect.close();
    await host.close();

    const conflict =
      command.port === 0 ? undefined : portConflict(command.port, await probePort(command.port));

    throw conflict === undefined ? cause : new Error(conflict);
  }
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
