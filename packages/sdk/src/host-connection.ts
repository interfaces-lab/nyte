import { compile, PerformEventType, SdkError, SOCKET_PATH, withJson } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  Awaitable,
  ClientId,
  ClientInfo,
  CredentialSource,
  Disposer,
  HeadName,
  HostId,
  Json,
  PartId,
  PerformEvent,
  SessionId,
  TextFrame,
  WelcomeFrame,
} from "@nyte-ai/schema";
import { asSdkError, openHostSocket } from "@nyte-ai/protocol";
import type {
  CallName,
  HostSocket,
  OperationInput,
  OperationOutput,
  SocketClosed,
  SocketLike,
} from "@nyte-ai/protocol";
import { catalogCache } from "./catalogs.ts";
import { openClientsStore } from "./live-clients.ts";
import type { ClientsStore } from "./live-clients.ts";
import { openSessions } from "./live-sessions.ts";
import type { SessionsStore, SessionsWindow } from "./live-sessions.ts";
import { openHeadStore } from "./live-head.ts";
import type { HeadStore } from "./live-head.ts";
import { openPartStore } from "./live-part.ts";
import type { PartStore } from "./live-part.ts";
import { listenerSet, request, retryDelay } from "./live.ts";
import type { Attachment, Live } from "./live.ts";

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
};

export type OpenSocket = (request: SocketRequest) => SocketLike;

export type HostCredentials = Exclude<CredentialSource, { readonly kind: "pairing" }>;

export interface HostOptions {
  readonly credentials: HostCredentials;
  readonly client: Omit<ClientInfo, "actions">;
  readonly socket?: OpenSocket;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly online?: () => boolean;
}

export type TextUpdate = Exclude<TextFrame, { readonly type: "closed" }>;

export type Requester = PerformEvent["requester"];

export type ActionHandler = (input: Json, requester: Requester) => Awaitable<Json>;

export interface HostConnection {
  readonly address: string;
  readonly hostId: HostId | null;
  readonly health: Live<Health>;
  retry(): void;
  wake(): void;
  release(): void;
  call<N extends CallName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  head(session: SessionId, head: HeadName, options: { readonly tail: number }): HeadStore;
  part(session: SessionId, part: PartId): PartStore;
  directory(window?: SessionsWindow): SessionsStore;
  text(listener: (update: TextUpdate) => void): Disposer;
  clients(): ClientsStore;
  perform(
    client: ClientId,
    action: string,
    input: Json,
    options?: { readonly timeoutMs?: number },
  ): Promise<Json>;
  offer(action: ActionDeclaration, handler: ActionHandler): Disposer;
}

type Owned = { readonly connection: HostConnection; hold(): void };

type Registry = { named(host: HostId): void; closed(): void };

type Attempt = { opened: boolean; refusal: number | null; closed: SocketClosed | null };

type Joined = { readonly scope: string; readonly attachment: Attachment };

type Waiter = { resolve(socket: HostSocket): void; reject(error: SdkError): void };

type Offered = { readonly action: ActionDeclaration; readonly handler: ActionHandler };

const performs = compile(withJson(PerformEventType));

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
  const healthListeners = listenerSet();
  const joined = new Set<Joined>();
  const scopes = new Map<string, number>();
  const waiters = new Set<Waiter>();
  const texts = new Set<(update: TextUpdate) => void>();
  const offers = new Map<string, Offered>();
  let subscribed = new Map<string, Promise<void>>();
  let health: Health = { kind: "connecting" };
  let holders = 1;
  let attempt = 0;
  let generation = 0;
  let released = false;
  let declared = "[]";
  let current: HostSocket | null = null;
  let host: HostId | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: Health): void => {
    health = next;

    if (next.kind === "retrying" || next.kind === "blocked")
      for (const waiter of waiters.values()) waiter.reject(next.error);

    if (next.kind !== "connecting") waiters.clear();
    healthListeners.notify();
  };

  const actions = (): readonly ActionDeclaration[] =>
    Array.from(offers.values(), (offered) => offered.action);

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
    const seen: Attempt = { opened: false, refusal: null, closed: null };

    try {
      const headers = await credentialHeaders(options.credentials);

      if (mine !== generation) return;

      const raw = openSocket({ url: socketUrl(address), headers });

      raw.addEventListener("open", () => {
        seen.opened = true;
      });
      raw.addEventListener("close", (event) => {
        seen.closed = { code: event.code, reason: event.reason };
      });

      const hello = actions();
      declared = JSON.stringify(hello);

      const socket = await openHostSocket({
        socket: raw,
        client: { ...options.client, actions: hello },
      });

      if (mine !== generation) {
        socket.close();

        return;
      }

      opened(socket, seen);
    } catch (error) {
      if (mine !== generation) return;

      if (!seen.opened) seen.refusal = await loginStatus(address, options);

      if (mine === generation) failed(asSdkError(error), seen);
    }
  };

  const opened = (socket: HostSocket, seen: Attempt): void => {
    current = socket;
    subscribed = new Map();

    void socket.closed.then((closed) => dropped(socket, closed, seen));

    if (declared !== JSON.stringify(actions())) {
      socket.close();

      return;
    }

    for (const waiter of waiters) waiter.resolve(socket);
    waiters.clear();
    socket.onText((frame) => {
      if ("type" in frame) openText(socket);
      else for (const listener of texts) listener(frame);
    });

    for (const entry of joined)
      entry.attachment.attach(socket, () => subscribe(socket, entry.scope));

    if (texts.size > 0) openText(socket);
    void socket.welcome.then(
      (welcome) => welcomed(socket, welcome),
      () => undefined,
    );
  };

  const welcomed = (socket: HostSocket, welcome: WelcomeFrame): void => {
    if (current !== socket) return;
    host = welcome.host_id;
    registry.named(host);
    attempt = 0;
    show({ kind: "open", since: Date.now() });

    if (offers.size > 0) {
      const scope = `client/${welcome.client_id}`;
      socket.onEvent((event) => {
        if (event.scope === scope && performs.Check(event)) void answer(socket, event);
      });
      void subscribe(socket, scope);
    }
  };

  const dropped = (socket: HostSocket, closed: SocketClosed, seen: Attempt): void => {
    if (current !== socket) return;
    current = null;

    for (const entry of joined) entry.attachment.detach();

    if (released) return;

    if (declared !== JSON.stringify(actions())) {
      void connect();

      return;
    }

    failed(
      new SdkError(
        "unavailable",
        closed.reason === "" ? `The host closed the socket (${closed.code}).` : closed.reason,
      ),
      seen,
    );
  };

  const failed = (error: SdkError, seen: Attempt): void => {
    if (seen.refusal === 401 || seen.refusal === 403) {
      show({
        kind: "blocked",
        reason: "auth",
        error: new SdkError(
          seen.refusal === 401 ? "unauthenticated" : "denied",
          `The host refused the credential (${seen.refusal}).`,
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
    const delay = retryDelay(attempt);
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
    show({ kind: "retrying", attempt, at: Date.now() + delay, error });
  };

  const restart = (): void => {
    if (released) return;
    attempt = 0;

    if (health.kind === "retrying" || health.kind === "blocked") void connect();
  };

  const subscribe = (socket: HostSocket, scope: string): Promise<void> => {
    const known = subscribed.get(scope);

    if (known !== undefined) return known;

    const held = subscribed;
    const made = request(socket, "events.subscribe", { scopes: [scope] }).then(() => undefined);
    made.catch(() => held.delete(scope));
    held.set(scope, made);

    return made;
  };

  const join = (scope: string, attachment: Attachment): Disposer => {
    const entry = { scope, attachment };
    joined.add(entry);
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);

    const attached = current;

    if (attached !== null) attachment.attach(attached, () => subscribe(attached, scope));

    return () => {
      if (!joined.delete(entry)) return;
      attachment.detach();
      const left = (scopes.get(scope) ?? 1) - 1;

      if (left > 0) {
        scopes.set(scope, left);

        return;
      }

      scopes.delete(scope);

      if (current === null || !subscribed.delete(scope)) return;
      request(current, "events.unsubscribe", { scopes: [scope] }).catch(() => undefined);
    };
  };

  const ready = (): Promise<HostSocket> => {
    if (current !== null) return Promise.resolve(current);

    if (health.kind === "retrying" || health.kind === "blocked")
      return Promise.reject(health.error);

    if (released)
      return Promise.reject(new SdkError("unavailable", "This host connection was released."));

    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  };

  const openText = (socket: HostSocket): void => {
    request(socket, "text.open", {}).catch(() => undefined);
  };

  const answer = async (socket: HostSocket, event: PerformEvent): Promise<void> => {
    const offered = offers.get(event.action);

    const outcome = await Promise.resolve()
      .then(() => {
        if (offered === undefined)
          throw new SdkError("not_supported", `This client no longer offers ${event.action}.`);

        return offered.handler(event.input, event.requester);
      })
      .then(
        (result) => ({ result }),
        (error) => {
          const failure = asSdkError(error);

          return { error: { code: failure.code, message: failure.message } };
        },
      );

    await request(socket, "client.reply", { call: event.call, ...outcome }).catch(() => undefined);
  };

  const reoffer = (): void => {
    if (current !== null && declared !== JSON.stringify(actions())) current.close();
  };

  const catalogs = catalogCache(async (id) => request(await ready(), "catalogs.read", { id }));

  const connection: HostConnection = {
    address,
    get hostId() {
      return host;
    },
    health: { subscribe: healthListeners.subscribe, snapshot: () => health },
    retry: restart,
    wake: restart,
    release() {
      holders -= 1;

      if (holders > 0 || released) return;
      released = true;
      generation += 1;
      clearTimeout(retryTimer);

      for (const waiter of waiters)
        waiter.reject(new SdkError("unavailable", "This host connection was released."));
      waiters.clear();
      current?.close();
      registry.closed();
    },
    async call(name, input) {
      return request(await ready(), name, input);
    },
    head: (session, head, view) =>
      openHeadStore({ session, head, tail: view.tail }, join, catalogs),
    part: (session, part) => openPartStore({ session, part }, join),
    directory: (window) => openSessions(window ?? {}, join),
    text(listener) {
      texts.add(listener);

      if (texts.size === 1 && current !== null) openText(current);

      return () => {
        texts.delete(listener);
      };
    },
    clients: () => openClientsStore(join),
    perform: (client, action, input, perform) =>
      connection.call("client.perform", {
        client,
        action,
        input,
        timeoutMs: perform?.timeoutMs,
      }),
    offer(action, handler) {
      const offered = { action, handler };
      offers.set(action.name, offered);
      reoffer();

      return () => {
        if (offers.get(action.name) !== offered) return;
        offers.delete(action.name);
        reoffer();
      };
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

async function loginStatus(address: string, options: HostOptions): Promise<number | null> {
  const send = options.fetch ?? fetch;

  const response = await credentialHeaders(options.credentials)
    .then((headers) =>
      send(hostUrl(address, "/clients.read", "http"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      }),
    )
    .catch(() => null);

  await response?.body?.cancel();

  return response?.status ?? null;
}

function socketUrl(address: string): string {
  return hostUrl(address, SOCKET_PATH, "ws");
}

export function hostUrl(address: string, path: string, scheme: "http" | "ws"): string {
  const url = new URL(address);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  url.protocol = `${scheme}${secure ? "s" : ""}:`;
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}${path}`;
  url.search = "";
  url.hash = "";

  return url.href;
}

type HeaderSocket = new (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => SocketLike;

function openGlobalSocket(request: SocketRequest): SocketLike {
  const Socket: unknown = globalThis.WebSocket;

  if (!webSocketClass(Socket))
    throw new SdkError("not_supported", "This runtime has no WebSocket; pass a socket factory.");

  return new Socket(request.url, { headers: request.headers });
}

function webSocketClass(value: unknown): value is HeaderSocket {
  if (typeof value !== "function") return false;

  return "CONNECTING" in value;
}
