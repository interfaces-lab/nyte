import { API_REVISION } from "@nyte-ai/schema";
import { sdk, SdkError } from "@nyte-ai/sdk";
import type { ConnectOptions, Connection, CredentialSource } from "@nyte-ai/sdk";
import { openHost, ticketSocket } from "@nyte-ai/sdk/client";
import type { HostConnection, OpenSocket } from "@nyte-ai/sdk/client";
import type { ConnectionProblem, HostEndpoint } from "../contract/connection.ts";

let installed: Connection | undefined;

let installedLive: HostConnection | undefined;

const first = Promise.withResolvers<Connection>();

const firstLive = Promise.withResolvers<HostConnection>();

let ready = first.promise;

let liveReady = firstLive.promise;

export async function connectHost(
  endpoint: HostEndpoint,
  options: {
    readonly journal?: ConnectOptions["journal"];
    readonly fetch?: ConnectOptions["fetch"];
    readonly socket?: OpenSocket;
    readonly remember?: (credential: CredentialSource) => void;
  } = {},
): Promise<Connection> {
  const connection = await sdk.connect({
    url: endpoint.url,
    credentials: endpoint.credentials,
    ...(endpoint.expect === undefined ? {} : { expect: endpoint.expect }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  if (connection.credential !== endpoint.credentials) options.remember?.(connection.credential);
  const credential = connection.credential;

  if (credential.kind === "pairing")
    throw new SdkError("unauthenticated", "The host did not trade the pairing code for a token.");

  const live = openHost(endpoint.url, {
    credentials: credential,
    client: { kind: "app", name: "Nyte", version: `api-${String(API_REVISION)}` },
    socket: options.socket ?? ticketSocket({ fetch: options.fetch }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  installConnection(connection, live);

  return connection;
}

export function installConnection(connection: Connection, live: HostConnection): void {
  const replaced = installed !== undefined;
  const released = installedLive;
  installed = connection;
  installedLive = live;
  first.resolve(connection);
  firstLive.resolve(live);
  ready = Promise.resolve(connection);
  liveReady = Promise.resolve(live);

  if (replaced) for (const stores of registries) stores.clear();

  released?.release();

  for (const listener of liveListeners) listener();
}

export function connected(): Promise<Connection> {
  return ready;
}

export function liveConnected(): Promise<HostConnection> {
  return liveReady;
}

export function currentLive(): HostConnection | undefined {
  return installedLive;
}

const liveListeners = new Set<() => void>();

export function subscribeLive(listener: () => void): () => void {
  liveListeners.add(listener);

  return () => liveListeners.delete(listener);
}

export function currentConnection(): Connection | undefined {
  return installed;
}

export function connection(): Connection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

export const registries = new Set<{ clear(): void }>();

export function hostChanged(cause: unknown): boolean {
  return cause instanceof SdkError && cause.code === "stale";
}

export function connectionProblem(cause: unknown): ConnectionProblem {
  if (!(cause instanceof SdkError)) {
    return {
      kind: "network",
      message: "Cannot reach the server. Check your connection and try again.",
    };
  }

  switch (cause.code) {
    case "unauthenticated":
    case "denied":
      return {
        kind: "authentication",
        message: "The server rejected this token. Update the connection token.",
      };
    case "unavailable":
    case "timeout":
      return {
        kind: "network",
        message: "Cannot reach the server. Check your connection and try again.",
      };
    case "stale":
      return {
        kind: "incompatible",
        message: "A different host answered at this address. Pair with it again.",
      };
    case "unknown":
    case "invalid":
    case "not_supported":
      return {
        kind: "incompatible",
        message: "This server does not support this app's protocol. Check its URL and version.",
      };
    case "internal":
      return {
        kind: "server",
        message:
          "The server could not complete this request. Check its deployment logs and try again.",
      };
    default: {
      const exhaustive: never = cause.code;

      return exhaustive;
    }
  }
}
