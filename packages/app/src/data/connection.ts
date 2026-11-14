import { API_REVISION } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/sdk";
import { connect, mediaLink, ticketSocket } from "@nyte-ai/sdk/client";
import type {
  ClientConnection,
  ClientConnectOptions,
  Health,
  Live,
  OpenSocket,
} from "@nyte-ai/sdk/client";
import type { ConnectionProblem, HostEndpoint } from "../contract/connection.ts";
import type { StoreSource } from "./derived-store.ts";
import { queryClient, readsHost } from "./query-client.ts";
import { localJournal } from "./send-journal.ts";

type Fetch = NonNullable<NonNullable<ClientConnectOptions["transport"]>["fetch"]>;

let installed: ClientConnection | undefined;

let installedMedia: ((path: string) => Promise<string>) | undefined;

const first = Promise.withResolvers<ClientConnection>();

const installs = new Set<(replaced: boolean) => void>();

export async function connectHost(
  endpoint: HostEndpoint,
  options: { readonly fetch?: Fetch; readonly socket?: OpenSocket } = {},
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

/** Installs `connection`, resets the host reads cached from another host it replaces, tells every `onInstall` listener whether it replaced one, then closes the one it replaced. */
export function installConnection(connection: ClientConnection): void {
  const replaced = installed;
  installed = connection;
  first.resolve(connection);

  if (replaced !== undefined && replaced.hostId !== connection.hostId)
    void queryClient.resetQueries({ predicate: readsHost });

  for (const listener of installs) listener(replaced !== undefined);

  if (replaced !== connection) void replaced?.close();
}

export function connected(): Promise<ClientConnection> {
  return installed === undefined ? first.promise : Promise.resolve(installed);
}

/** Hears every install; `replaced` is false only for the first. */
export function onInstall(listener: (replaced: boolean) => void): () => void {
  installs.add(listener);

  return () => installs.delete(listener);
}

/**
 * `open`'s value on the installed connection, followed onto each connection that replaces it: a
 * listener hears its changes and each install. `open` runs once per connection; with `close`, what
 * it opened closes when a connection replaces it or the last listener leaves.
 */
export function installedLive<S, L>(
  open: (current: ClientConnection) => Live<S> & L,
  close: (live: L) => void = () => undefined,
): StoreSource<S | undefined> {
  let opened: { readonly connection: ClientConnection; readonly live: Live<S> & L } | undefined;
  let listening = 0;

  const current = (): (Live<S> & L) | undefined => {
    if (installed === undefined) return undefined;

    if (opened?.connection !== installed) {
      if (opened !== undefined) close(opened.live);
      opened = { connection: installed, live: open(installed) };
    }

    return opened.live;
  };

  return {
    subscribe(listener) {
      listening += 1;
      let leave = current()?.subscribe(listener);

      const stop = onInstall(() => {
        leave?.();
        leave = current()?.subscribe(listener);
        listener();
      });

      return () => {
        stop();
        leave?.();
        listening -= 1;

        if (listening > 0 || opened === undefined) return;
        close(opened.live);
        opened = undefined;
      };
    },
    read: () => current()?.snapshot(),
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

/** Whether `next` is a link that opened since `previous`: a host read that failed while it was down may answer now. */
export function linkReopened(previous: Health | undefined, next: Health | undefined): boolean {
  return next?.kind === "open" && (previous?.kind !== "open" || previous.since !== next.since);
}

const health = installedLive((current) => current.health);

let lastHealth = health.read();

health.subscribe(() => {
  const next = health.read();

  if (linkReopened(lastHealth, next))
    void queryClient.refetchQueries({
      type: "active",
      predicate: (query) => readsHost(query) && query.state.status === "error",
    });
  lastHealth = next;
});
