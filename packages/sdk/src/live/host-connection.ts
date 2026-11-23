import { OPERATIONS, SdkError, SOCKET_PATH } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  Awaitable,
  ClientId,
  ClientInfo,
  ClosingReason,
  Disposer,
  HeadName,
  HostId,
  Json,
  PartId,
  PerformEvent,
  RunId,
  SessionId,
  TextFrame,
  ToolProgress,
  WelcomeFrame,
} from "@nyte-ai/schema";
import { asSdkError, linkLost, namesOperation, openHostSocket } from "@nyte-ai/protocol";
import type {
  CallName,
  HostSocket,
  OperationInput,
  OperationOutput,
  SocketClosed,
  SocketLike,
} from "@nyte-ai/protocol";
import { dev } from "@nyte-ai/core/client";
import { catalogCache } from "./catalogs.ts";
import { credentialHeaders } from "../connection/connect.ts";
import type { HostCredentials } from "../connection/connect.ts";
import { closings, performs } from "../event-checks.ts";
import { openClientsStore } from "./clients.ts";
import type { ClientsStore } from "./clients.ts";
import { openSessions } from "./sessions.ts";
import type { SessionsStore, SessionsWindow } from "./sessions.ts";
import { openHeadStore } from "./head.ts";
import type { HeadStore } from "./head.ts";
import { openPartStore } from "./part.ts";
import type { PartStore } from "./part.ts";
import type { LinkCell, LinkState } from "./link.ts";
import { request, retryDelay } from "./store.ts";
import type { Attachment, Live } from "./store.ts";

export interface SocketRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type OpenSocket = (request: SocketRequest) => SocketLike;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface LinkOptions {
  readonly link: LinkCell;
  readonly host: HostId;
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
  readonly link: Live<LinkState>;
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
  welcomed: boolean;
  closing: ClosingReason | null;
  refusal: number | null;
  closed: SocketClosed | null;
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

const UNANSWERED_HELLOS = 2;

const UNANSWERED_HELLO =
  "The host didn't answer this client's hello, so it runs a build too old to talk to. Update Nyte on the host.";

export function openLink(address: string, options: LinkOptions): SocketLink {
  const openSocket = options.socket ?? openGlobalSocket;
  const { link } = options;
  const joined = new Set<Joined>();
  const scopes = new Map<string, number>();
  const waiters = new Set<Waiter>();
  const texts = new Set<(update: TextUpdate) => void>();
  const offers = new Map<string, Offered>();
  let subscribed = new Map<string, Promise<void>>();
  const credentials = options.credentials;
  let started = false;
  let attempt = 0;
  let sizeCloses = 0;
  let unanswered = 0;
  let generation = 0;
  let released = false;
  let declared = "[]";
  let current: HostSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: LinkState): void => {
    link.socket(next);
    settleWaiters();
  };

  const settleWaiters = (): void => {
    const state = link.snapshot();

    if (state.kind !== "refused" && state.kind !== "closed") return;

    const error =
      state.kind === "refused"
        ? state.error
        : new SdkError("unavailable", "This connection is closed.");

    for (const waiter of waiters) waiter.reject(error);
    waiters.clear();
  };

  const stopped = (): boolean => {
    const state = link.snapshot();

    return released || state.kind === "refused" || state.kind === "closed";
  };

  const actions = (): readonly ActionDeclaration[] =>
    Array.from(offers.values(), (offered) => offered.action);

  const connect = async (): Promise<void> => {
    if (stopped()) return;
    generation += 1;
    const mine = generation;
    clearTimeout(retryTimer);
    const seen: Attempt = {
      opened: false,
      welcomed: false,
      closing: null,
      refusal: null,
      closed: null,
    };

    try {
      const headers = await credentialHeaders(credentials);

      if (mine !== generation) return;

      const raw = openSocket({ url: socketUrl(address), headers });

      raw.addEventListener("open", () => {
        seen.opened = true;
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
      seen.refusal = await loginStatus(address, credentials, options.fetch ?? fetch);

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
    socket.onEvent((event) => {
      if (closings.Check(event)) seen.closing = event.reason;
    });

    for (const entry of joined) {
      entry.attachment.attach(socket, () => subscribe(socket, entry.scope));
    }

    if (texts.size > 0) openText(socket);
    void socket.welcome.then(
      (welcome) => welcomed(socket, welcome, seen),
      () => undefined,
    );
  };

  const welcomed = (socket: HostSocket, welcome: WelcomeFrame, seen: Attempt): void => {
    if (current !== socket || released) return;
    seen.welcomed = true;

    if (welcome.host_id !== options.host) {
      current = null;
      socket.close();

      for (const entry of joined) entry.attachment.detach();

      show({
        kind: "refused",
        reason: "other-host",
        error: new SdkError(
          "stale",
          `Host ${welcome.host_id} answered instead of ${options.host}. Connect again to reach it.`,
        ),
      });

      return;
    }

    attempt = 0;
    unanswered = 0;
    show({
      kind: "open",
      since: Date.now(),
      version: welcome.version,
      startedAt: welcome.startedAt,
      match: welcome.match,
    });

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
    seen.closed = closed;

    for (const entry of joined) entry.attachment.detach();

    if (stopped()) return;

    if (declared !== JSON.stringify(actions())) {
      void connect();

      return;
    }

    if (!seen.welcomed) {
      void loginStatus(address, credentials, options.fetch ?? fetch).then((status) => {
        seen.refusal = status;

        if (current === null && !stopped()) failed(lostSocket(closed), seen);
      });

      return;
    }

    failed(lostSocket(closed), seen);
  };

  const failed = (error: SdkError, seen: Attempt): void => {
    if (stopped()) return;

    if (seen.refusal === 401 || seen.refusal === 403) {
      show({
        kind: "refused",
        reason: "auth",
        error: new SdkError(
          seen.refusal === 401 ? "unauthenticated" : "denied",
          `The host refused the credential (${seen.refusal}).`,
        ),
      });

      return;
    }

    const refused = seen.closed?.refused ?? null;

    if (refused !== null) {
      show({
        kind: "refused",
        reason: refused.reason,
        error: new SdkError("not_supported", refused.message),
      });

      return;
    }

    unanswered =
      seen.opened && !seen.welcomed && seen.closing === null && seen.refusal !== null
        ? unanswered + 1
        : 0;

    if (unanswered >= UNANSWERED_HELLOS) {
      show({
        kind: "refused",
        reason: "update-host",
        error: new SdkError("not_supported", UNANSWERED_HELLO),
      });

      return;
    }

    const closed = seen.closed;

    sizeCloses =
      closed !== null &&
      (closed.code === 1009 || (closed.code === 1008 && closed.reason === "backlog"))
        ? sizeCloses + 1
        : 0;
    schedule(seen.closing, error);
  };

  const schedule = (closing: ClosingReason | null, error: SdkError): void => {
    const delay = retryDelay(attempt + sizeCloses);
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
    const previous = link.snapshot();
    const away = previous.kind === "away" ? previous : null;
    dev("sdk", "link away", { attempt, delay, message: error.message });

    show({
      kind: "away",
      since: away?.since ?? Date.now(),
      retryAt: Date.now() + delay,
      reason: closing ?? away?.reason ?? "lost",
    });
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
    link.subscribe(() => {
      if (!stopped()) return;
      generation += 1;
      clearTimeout(retryTimer);
      current?.close();
      settleWaiters();
    });
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
    const state = link.snapshot();

    if (state.kind === "refused") return Promise.reject(state.error);

    if (released || state.kind === "closed") {
      return Promise.reject(new SdkError("unavailable", "This connection is closed."));
    }

    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  };

  const call = async <N extends CallName>(
    name: N,
    input: OperationInput<N>,
  ): Promise<OperationOutput<N>> => {
    for (;;) {
      const socket = await ready();

      try {
        return await request(socket, name, input);
      } catch (error) {
        const query = namesOperation(name) && OPERATIONS[name].kind === "query";

        if (!linkLost(error) || !query || !(await lost(socket))) throw error;
      }
    }
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

  const socketLink: SocketLink = {
    link: {
      subscribe(listener) {
        start();

        return link.subscribe(listener);
      },
      snapshot() {
        start();

        return link.snapshot();
      },
    },
    retry() {
      if (released) return;
      attempt = 0;

      if (!started) {
        start();

        return;
      }
      const state = link.snapshot();

      if (state.kind === "refused") {
        unanswered = 0;
        link.retry();
        show({ kind: "connecting" });
        void connect();

        return;
      }

      if (state.kind === "away") {
        void connect();

        return;
      }

      current?.probe().catch(() => {
        if (current === null && link.snapshot().kind === "away") void connect();
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
    call,
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
      call("client.perform", {
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

  return socketLink;
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

function lostSocket(closed: SocketClosed): SdkError {
  return new SdkError(
    "unavailable",
    closed.reason === "" ? `The host closed the socket (${closed.code}).` : closed.reason,
  );
}

async function lost(socket: HostSocket): Promise<boolean> {
  return Promise.race([socket.closed.then(() => true), Promise.resolve(false)]);
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
