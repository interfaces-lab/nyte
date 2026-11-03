import { SdkError, SOCKET_PATH } from "@nyte-ai/schema";
import type { ClientInfo, CredentialSource, Disposer, HostId } from "@nyte-ai/schema";
import { asSdkError, openHostSocket } from "@nyte-ai/protocol";
import type { HostSocket, SocketClosed, SocketLike } from "@nyte-ai/protocol";

export type Health =
  | { readonly kind: "connecting" }
  | { readonly kind: "open"; readonly since: number }
  | {
      readonly kind: "retrying";
      readonly attempt: number;
      readonly at: number;
      readonly error: SdkError;
    }
  | {
      readonly kind: "blocked";
      readonly reason: "auth" | "version" | "offline";
      readonly error: SdkError;
    };

export type SocketRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  refused(status: number): void;
};

export type OpenSocket = (request: SocketRequest) => SocketLike;

export type HostCredentials = Exclude<CredentialSource, { readonly kind: "pairing" }>;

export interface HostOptions {
  readonly credentials: HostCredentials;
  readonly client: Omit<ClientInfo, "actions">;
  readonly socket?: OpenSocket;
  readonly online?: () => boolean;
}

export interface Live<T> {
  subscribe(listener: () => void): Disposer;
  snapshot(): T;
}

export interface HostConnection {
  readonly address: string;
  readonly hostId: HostId | null;
  readonly health: Live<Health>;
  retry(): void;
  wake(): void;
  release(): void;
}

type Owned = { readonly connection: HostConnection; hold(): void };

type Registry = { named(host: HostId): void; closed(): void };

type Attempt = { refusal: number | null; closed: SocketClosed | null };

const RETRY_BASE_MS = 1_000;

const RETRY_MAX_MS = 30_000;

const STABLE_MS = 30_000;

const hosts = new Map<string, Owned>();

const dialed = new Map<string, HostId>();

export function openHost(address: string, options: HostOptions): HostConnection {
  const known = hosts.get(dialed.get(address) ?? address);

  if (known !== undefined) {
    known.hold();

    return known.connection;
  }

  const owned = superviseHost(address, options, {
    named(host) {
      if (hosts.has(host)) return;
      hosts.delete(address);
      hosts.set(host, owned);
      dialed.set(address, host);
    },
    closed() {
      hosts.forEach((entry, key) => {
        if (entry === owned) hosts.delete(key);
      });
      dialed.forEach((host, key) => {
        if (!hosts.has(host)) dialed.delete(key);
      });
    },
  });

  hosts.set(address, owned);

  return owned.connection;
}

function superviseHost(address: string, options: HostOptions, registry: Registry): Owned {
  const openSocket = options.socket ?? openGlobalSocket;
  const online = options.online ?? (() => true);
  const healthListeners = new Set<() => void>();
  let health: Health = { kind: "connecting" };
  let holders = 1;
  let attempt = 0;
  let generation = 0;
  let released = false;
  let current: HostSocket | null = null;
  let host: HostId | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: Health): void => {
    health = next;

    for (const listener of healthListeners) listener();
  };

  const connect = async (): Promise<void> => {
    generation += 1;
    const mine = generation;
    clearTimeout(retryTimer);

    if (!online()) {
      show({
        kind: "blocked",
        reason: "offline",
        error: new SdkError("unavailable", "The network is offline."),
      });

      return;
    }

    if (health.kind !== "connecting") show({ kind: "connecting" });
    const seen: Attempt = { refusal: null, closed: null };

    try {
      const headers = await credentialHeaders(options.credentials);

      if (mine !== generation) return;

      const raw = openSocket({
        url: socketUrl(address),
        headers,
        refused: (status) => {
          seen.refusal = status;
        },
      });

      raw.addEventListener("close", (event) => {
        seen.closed = { code: event.code, reason: event.reason };
      });

      const socket = await openHostSocket({
        socket: raw,
        client: { ...options.client, actions: [] },
      });

      if (mine !== generation) {
        socket.close();

        return;
      }

      opened(socket);
    } catch (error) {
      if (mine === generation) failed(asSdkError(error), seen);
    }
  };

  const opened = (socket: HostSocket): void => {
    current = socket;
    host = socket.welcome.host_id;
    registry.named(host);
    show({ kind: "open", since: Date.now() });

    stableTimer = setTimeout(() => {
      attempt = 0;
    }, STABLE_MS);

    void socket.closed.then((closed) => dropped(socket, closed));
  };

  const dropped = (socket: HostSocket, closed: SocketClosed): void => {
    if (current !== socket) return;
    current = null;
    clearTimeout(stableTimer);

    if (released) return;

    schedule(
      new SdkError(
        "unavailable",
        closed.reason === "" ? `The host closed the socket (${closed.code}).` : closed.reason,
      ),
    );
  };

  const failed = (error: SdkError, seen: Attempt): void => {
    if (seen.refusal === 401 || seen.refusal === 403) {
      show({
        kind: "blocked",
        reason: "auth",
        error: new SdkError(
          seen.refusal === 401 ? "unauthenticated" : "denied",
          `The host refused the socket (${seen.refusal}).`,
        ),
      });

      return;
    }

    if (seen.closed?.code === 1008 && /^Update the (host|client)/.test(seen.closed.reason)) {
      show({ kind: "blocked", reason: "version", error });

      return;
    }

    schedule(error);
  };

  const schedule = (error: SdkError): void => {
    attempt += 1;
    const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
    const delay = ceiling / 2 + (Math.random() * ceiling) / 2;
    show({ kind: "retrying", attempt, at: Date.now() + delay, error });
    retryTimer = setTimeout(() => void connect(), delay);
  };

  const restart = (): void => {
    if (released) return;
    attempt = 0;

    if (health.kind === "retrying" || health.kind === "blocked") void connect();
  };

  const connection: HostConnection = {
    address,
    get hostId() {
      return host;
    },
    health: {
      subscribe(listener) {
        healthListeners.add(listener);

        return () => {
          healthListeners.delete(listener);
        };
      },
      snapshot: () => health,
    },
    retry: restart,
    wake: restart,
    release() {
      holders -= 1;

      if (holders > 0 || released) return;
      released = true;
      generation += 1;
      clearTimeout(retryTimer);
      clearTimeout(stableTimer);
      current?.close();
      current = null;
      registry.closed();
    },
  };

  queueMicrotask(() => void connect());

  return {
    connection,
    hold() {
      holders += 1;
    },
  };
}

async function credentialHeaders(
  credentials: HostCredentials,
): Promise<Readonly<Record<string, string>>> {
  if (credentials.kind === "custom") return credentials.headers();

  return { Authorization: `Bearer ${credentials.token}` };
}

function socketUrl(address: string): string {
  const url = new URL(SOCKET_PATH, address);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";

  return url.href;
}

function openGlobalSocket(request: SocketRequest): SocketLike {
  return new WebSocket(request.url, { headers: request.headers });
}
