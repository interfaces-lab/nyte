import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { ConnectView } from "@nyte-ai/connect";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import { serviceConnect } from "@nyte-ai/service";
import type { LocalEndpoint } from "@nyte-ai/service";
import { startHostThread } from "./hosting.ts";
import type { RemoteFacts } from "./model/state.ts";

const RETRY_MS = 1_000;

export interface LocalSession {
  readonly connection: Connection;
  readonly endpoint: LocalEndpoint;
  readonly ended: Promise<Error>;
  close(): Promise<void>;
}

export async function connectLocalHost(): Promise<LocalSession> {
  const token = randomBytes(32).toString("base64url");
  const thread = await startHostThread({ kind: "local", port: 0, token });

  const connection = await sdk
    .connect({ url: thread.address, credentials: { kind: "token", token } })
    .catch(async (cause: unknown) => {
      await thread.stop();

      throw cause;
    });

  return {
    connection,
    endpoint: { url: thread.address, token },
    ended: thread.ended.then(
      () => new Error("The host thread stopped."),
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    ),
    async close() {
      await connection.close().catch(() => undefined);
      await thread.stop();
    },
  };
}

export function followRemote(
  endpoint: LocalEndpoint,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
  failed: (cause: unknown) => void,
): void {
  void (async () => {
    while (!signal.aborted) {
      await watchRemote(endpoint, signal, report).catch((cause: unknown) => {
        if (!signal.aborted) failed(cause);
      });
      await sleep(RETRY_MS, undefined, { signal }).catch(() => undefined);
    }
  })();
}

export async function watchRemote(
  endpoint: LocalEndpoint,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
): Promise<void> {
  let holder = false;

  for await (const event of serviceConnect(endpoint).watch(signal)) {
    if (event.kind === "relay") holder = event.holder;

    if (event.kind === "view") report(holder ? remoteFacts(event.view) : { kind: "off" });
  }
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
