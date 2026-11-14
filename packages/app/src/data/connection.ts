import { API_REVISION } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/sdk";
import type { CredentialSource } from "@nyte-ai/sdk";
import { connect, mediaLink, ticketSocket } from "@nyte-ai/sdk/client";
import type { ClientConnection, ClientConnectOptions, Live, OpenSocket } from "@nyte-ai/sdk/client";
import type { ConnectionProblem, HostEndpoint } from "../contract/connection.ts";
import type { StoreSource } from "./derived-store.ts";
import { localJournal } from "./send-journal.ts";

type Fetch = NonNullable<NonNullable<ClientConnectOptions["transport"]>["fetch"]>;

let installed: ClientConnection | undefined;

let installedMedia: ((path: string) => Promise<string>) | undefined;

const first = Promise.withResolvers<ClientConnection>();

const installs = new Set<(replaced: boolean) => void>();

export async function connectHost(
  endpoint: HostEndpoint,
  options: {
    readonly fetch?: Fetch;
    readonly socket?: OpenSocket;
    readonly remember?: (credential: CredentialSource) => void;
  } = {},
): Promise<ClientConnection> {
  const connection = await connect({
    url: endpoint.url,
    credentials: endpoint.credentials,
    expect: endpoint.expect,
    client: { kind: "app", name: "Nyte", version: `api-${String(API_REVISION)}` },
    journal: localJournal(),
    transport: {
      fetch: options.fetch,
      socket: options.socket ?? ticketSocket({ fetch: options.fetch }),
    },
  });

  if (connection.credential !== endpoint.credentials) options.remember?.(connection.credential);
  installConnection(connection);
  installedMedia = async (path) => {
    const link = await mediaLink(endpoint.url, path, {
      credentials: connection.credential,
      fetch: options.fetch,
    });

    return endpoint.mediaOrigin === undefined
      ? link
      : `${endpoint.mediaOrigin}${new URL(link).pathname}`;
  };

  return connection;
}

export async function mediaUrl(path: string): Promise<string> {
  await connected();

  if (installedMedia === undefined)
    throw new SdkError("not_supported", "This connection streams no files.");

  return installedMedia(path);
}

/** Installs `connection`, tells every `onInstall` listener whether it replaced one, then closes the one it replaced. */
export function installConnection(connection: ClientConnection): void {
  const replaced = installed;
  installed = connection;
  first.resolve(connection);

  for (const listener of installs) listener(replaced !== undefined);

  if (replaced !== connection) void replaced?.close();
}

export function connected(): Promise<ClientConnection> {
  return installed === undefined ? first.promise : Promise.resolve(installed);
}

/** The installed connection, for what follows its socket's health or asks it to retry. */
export function currentLive(): ClientConnection | undefined {
  return installed;
}

/** Hears every install; `replaced` is false only for the first. */
export function onInstall(listener: (replaced: boolean) => void): () => void {
  installs.add(listener);

  return () => installs.delete(listener);
}

/** `read`'s value on the installed connection, followed onto each connection that replaces it: a listener hears its changes and each install. */
export function installedLive<S>(
  read: (current: ClientConnection) => Live<S>,
): StoreSource<S | undefined> {
  return {
    subscribe(listener) {
      let leave = installed === undefined ? undefined : read(installed).subscribe(listener);

      const stop = onInstall(() => {
        leave?.();
        leave = installed === undefined ? undefined : read(installed).subscribe(listener);
        listener();
      });

      return () => {
        stop();
        leave?.();
      };
    },
    read: () => (installed === undefined ? undefined : read(installed).snapshot()),
  };
}

export function currentConnection(): ClientConnection | undefined {
  return installed;
}

export function connection(): ClientConnection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

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
