import { SdkError, SOCKET_PATH } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  Awaitable,
  ClientId,
  ClientInfo,
  Disposer,
  HeadName,
  Json,
  PartId,
  PerformEvent,
  RunId,
  SessionId,
  TextFrame,
  ToolProgress,
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
import { credentialHeaders } from "../connection/connect.ts";
import type { HostCredentials } from "../connection/connect.ts";
import { performs } from "../event-checks.ts";
import { openClientsStore } from "./clients.ts";
import type { ClientsStore } from "./clients.ts";
import { openSessions } from "./sessions.ts";
import type { SessionsStore, SessionsWindow } from "./sessions.ts";
import { openHeadStore } from "./head.ts";
import type { HeadStore } from "./head.ts";
import { openPartStore } from "./part.ts";
import type { PartStore } from "./part.ts";
import { listenerSet, request, socketRetryDelay } from "./store.ts";
import type { Attachment, Live } from "./store.ts";

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

export interface SocketRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type OpenSocket = (request: SocketRequest) => SocketLike;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface LinkOptions {
  readonly credentials: HostCredentials;
  readonly client: Omit<ClientInfo, "actions">;
  readonly socket?: OpenSocket;
  readonly fetch?: Fetch;
}

/** What the host streams for a part ahead of its row: its whole `text` so far, an `append` to the text it last sent, or a running tool's `progress`. */
export type TextUpdate =
  | (TextSource & { readonly kind: "text"; readonly version: number; readonly text: string })
  | (TextSource & { readonly kind: "append"; readonly version: number; readonly append: string })
  | (TextSource & { readonly kind: "progress"; readonly progress: ToolProgress });

interface TextSource {
  readonly part: PartId;
  readonly run: RunId | null;
}

export type Requester = PerformEvent["requester"];

export type ActionHandler = (input: Json, requester: Requester) => Awaitable<Json>;

export interface SocketLink {
  readonly health: Live<Health>;
  retry(): void;
  close(): void;
  call<N extends CallName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  head(session: SessionId, head: HeadName, options: { readonly tail: number }): HeadStore;
  part(session: SessionId, part: PartId): PartStore;
  sessions(window?: SessionsWindow): SessionsStore;
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

interface Attempt {
  opened: boolean;
  refusal: number | null;
  closed: Pick<SocketClosed, "code" | "reason"> | null;
}

interface Joined {
  readonly scope: string;
  readonly attachment: Attachment;
}

interface Waiter {
  resolve(socket: HostSocket): void;
  reject(error: SdkError): void;
}

interface Offered {
  readonly action: ActionDeclaration;
  readonly handler: ActionHandler;
}

const LOGIN_STATUS_MS = 5000;

export function openLink(address: string, options: LinkOptions): SocketLink {
  const openSocket = options.socket ?? openGlobalSocket;
  const healthListeners = listenerSet();
  const joined = new Set<Joined>();
  const scopes = new Map<string, number>();
  const waiters = new Set<Waiter>();
  const texts = new Set<(update: TextUpdate) => void>();
  const offers = new Map<string, Offered>();
  let subscribed = new Map<string, Promise<void>>();
  const credentials = options.credentials;
  let health: Health = { kind: "connecting" };
  let started = false;
  let attempt = 0;
  let sizeCloses = 0;
  let generation = 0;
  let released = false;
  let declared = "[]";
  let current: HostSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: Health): void => {
    health = next;

    if (next.kind === "retrying" || next.kind === "blocked") {
      for (const waiter of waiters.values()) waiter.reject(next.error);
    }

    if (next.kind !== "connecting") waiters.clear();
    healthListeners.notify();
  };

  const actions = (): readonly ActionDeclaration[] =>
    Array.from(offers.values(), (offered) => offered.action);

  const connect = async (): Promise<void> => {
    if (released) return;
    generation += 1;
    const mine = generation;
    clearTimeout(retryTimer);

    if (health.kind !== "connecting") show({ kind: "connecting" });
    const seen: Attempt = { opened: false, refusal: null, closed: null };

    try {
      const headers = await credentialHeaders(credentials);

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

      if (!seen.opened) {
        seen.refusal = await loginStatus(address, credentials, options.fetch ?? fetch);
      }

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
      if ("type" in frame) {
        openText(socket);

        return;
      }

      const update = textUpdate(frame);

      for (const listener of texts) listener(update);
    });

    for (const entry of joined) {
      entry.attachment.attach(socket, () => subscribe(socket, entry.scope));
    }

    if (texts.size > 0) openText(socket);
    void socket.welcome.then(
      (welcome) => welcomed(socket, welcome),
      () => undefined,
    );
  };

  const welcomed = (socket: HostSocket, welcome: WelcomeFrame): void => {
    if (current !== socket || released) return;
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

    const closed = seen.closed;

    sizeCloses =
      closed !== null &&
      (closed.code === 1009 || (closed.code === 1008 && closed.reason === "backlog"))
        ? sizeCloses + 1
        : 0;
    schedule(error);
  };

  const schedule = (error: SdkError): void => {
    const delay = socketRetryDelay(attempt + sizeCloses);
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
    show({ kind: "retrying", attempt, at: Date.now() + delay, error });
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

  const start = (): void => {
    if (started) return;
    started = true;
    queueMicrotask(() => void connect());
  };

  const join = (scope: string, attachment: Attachment): Disposer => {
    start();
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
    start();

    if (current !== null) return Promise.resolve(current);

    if (health.kind === "retrying" || health.kind === "blocked") {
      return Promise.reject(health.error);
    }

    if (released) return Promise.reject(new SdkError("unavailable", "This connection is closed."));

    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  };

  const openText = (socket: HostSocket): void => {
    request(socket, "text.open", {}).catch(() => undefined);
  };

  const answer = async (socket: HostSocket, event: PerformEvent): Promise<void> => {
    const offered = offers.get(event.action);

    const outcome = await Promise.resolve()
      .then(() => {
        if (offered === undefined) {
          throw new SdkError("not_supported", `This client no longer offers ${event.action}.`);
        }

        return offered.handler(event.input, event.requester);
      })
      .then(
        (result) => ({ result }),
        (error: unknown) => {
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

  const link: SocketLink = {
    health: {
      subscribe(listener) {
        start();

        return healthListeners.subscribe(listener);
      },
      snapshot() {
        start();

        return health;
      },
    },
    retry() {
      if (released) return;
      attempt = 0;

      if (!started) {
        start();

        return;
      }

      if (health.kind === "retrying" || health.kind === "blocked") {
        void connect();

        return;
      }

      current?.probe().catch(() => {
        if (current === null && health.kind === "retrying") void connect();
      });
    },
    close() {
      if (released) return;
      released = true;
      generation += 1;
      clearTimeout(retryTimer);

      for (const waiter of waiters) {
        waiter.reject(new SdkError("unavailable", "This connection is closed."));
      }
      waiters.clear();
      current?.close();
    },
    async call(name, input) {
      return request(await ready(), name, input);
    },
    head: (session, head, view) =>
      openHeadStore({ session, head, tail: view.tail }, join, catalogs),
    part: (session, part) => openPartStore({ session, part }, join),
    sessions: (window) => openSessions(window ?? {}, join),
    text(listener) {
      start();
      texts.add(listener);

      if (texts.size === 1 && current !== null) openText(current);

      return () => {
        texts.delete(listener);
      };
    },
    clients: () => openClientsStore(join),
    perform: (client, action, input, perform) =>
      link.call("client.perform", {
        client,
        action,
        input,
        timeoutMs: perform?.timeoutMs,
      }),
    offer(action, handler) {
      start();
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

  return link;
}

async function loginStatus(
  address: string,
  credentials: HostCredentials,
  send: Fetch,
): Promise<number | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), LOGIN_STATUS_MS);

  const response = await credentialHeaders(credentials)
    .then((headers) =>
      send(hostUrl(address, "/clients.read", "http"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
        signal: deadline.signal,
      }),
    )
    .catch(() => null);

  clearTimeout(timer);
  await response?.body?.cancel().catch(() => undefined);

  return response?.status ?? null;
}

function textUpdate(frame: Exclude<TextFrame, { readonly type: "closed" }>): TextUpdate {
  const source = { part: frame.part, run: frame.run };

  if ("progress" in frame) return { ...source, kind: "progress", progress: frame.progress };

  if ("text" in frame) return { ...source, kind: "text", version: frame.version, text: frame.text };

  return { ...source, kind: "append", version: frame.version, append: frame.append };
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

type SocketClass = new (
  url: string,
  init?: { readonly headers: Readonly<Record<string, string>> },
) => SocketLike;

function openGlobalSocket(request: SocketRequest): SocketLike {
  const Socket = globalWebSocket();

  return new Socket(request.url, { headers: request.headers });
}

export function globalWebSocket(): SocketClass {
  const Socket: unknown = globalThis.WebSocket;

  if (!webSocketClass(Socket)) {
    throw new SdkError("not_supported", "This runtime has no WebSocket; pass a socket factory.");
  }

  return Socket;
}

function webSocketClass(value: unknown): value is SocketClass {
  if (typeof value !== "function") return false;

  return "CONNECTING" in value;
}
