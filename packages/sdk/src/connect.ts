import { asId, SdkError } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  ClientInfo,
  CredentialSource,
  Disposer,
  HeadName,
  PartId,
  SessionId,
} from "@nyte-ai/schema";
import type { Clients, ConnectOptions, Connection, RequestJournal, Sessions } from "@nyte-ai/core";
import { linkLost } from "@nyte-ai/protocol";
import type { CallName, OperationInput, OperationOutput } from "@nyte-ai/protocol";
import { dial } from "./connection/connect.ts";
import type { HostCredentials } from "./connection/connect.ts";
import { openChat } from "./live/chat.ts";
import type { Chat, ChatOptions } from "./live/chat.ts";
import type { ClientsStore } from "./live/clients.ts";
import type { HeadStore } from "./live/head.ts";
import { openLink } from "./live/host-connection.ts";
import type { ActionHandler, Fetch, OpenSocket, TextUpdate } from "./live/host-connection.ts";
import { linkCell } from "./live/link.ts";
import type { LinkState } from "./live/link.ts";
import type { PartStore } from "./live/part.ts";
import type { RefusedSends } from "./send/journal.ts";
import type { SessionsStore, SessionsWindow } from "./live/sessions.ts";
import { retryDelay } from "./live/store.ts";
import type { Live } from "./live/store.ts";

/** The socket's state as clients drew it before `link`, read from `link` until the last of them moves over. */
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
      readonly reason: "auth" | "version" | "other-host";
      readonly error: SdkError;
    };

export interface ClientConnectOptions {
  readonly url: string;
  /** A token, custom headers, or a pairing code, which the first request trades for a device token that becomes `credential`. */
  readonly credentials: CredentialSource;
  readonly expect?: ConnectOptions["expect"];
  readonly client: Omit<ClientInfo, "actions">;
  /** Where a send waits until the host has it. Give it storage that outlives the process (`createSendJournal(storage)`), or a message sent while the host is away is lost on quit. */
  readonly journal: RequestJournal;
  /** The global `fetch` and `WebSocket` when absent: a desktop bridge or React Native passes its own. */
  readonly transport?: { readonly fetch?: Fetch; readonly socket?: OpenSocket };
  /** Dial again on the retry curve until the host answers or this aborts, for a client that lives as long as its host may be away. Without it, a host that doesn't answer rejects. */
  readonly wait?: AbortSignal;
}

export interface ClientConnection extends Connection {
  /** The credential every request and the socket send: a pairing code is traded for a device token before `connect` resolves. */
  readonly credential: HostCredentials;
  readonly sessions: Sessions & {
    /** The sessions in `window`, kept current: the newest roots by default, `pinned`, a parent's children, or the roots whose name holds `query`. Close it when done. */
    open(window?: SessionsWindow): SessionsStore;
  };
  /** The connection's state, from the socket and from what HTTP answers. Reading it dials the socket, as does the first use of anything below, so a connection that only makes requests opens none. */
  readonly link: Live<LinkState>;
  readonly health: Live<Health>;
  /** Call it when the link may have come back: the app came forward, the window got focus, the network returned. A link that is away or refused dials now; an open one checks the host answers. */
  retry(): void;
  /** The chat of `session`'s `options.head` (main by default): its view, kept current, and the actions a chat screen takes. Each call returns its own chat. */
  chat(session: SessionId, options?: ChatOptions): Chat;
  head(session: SessionId, head: HeadName, options: { readonly tail: number }): HeadStore;
  part(session: SessionId, part: PartId): PartStore;
  text(listener: (update: TextUpdate) => void): Disposer;
  readonly clients: Clients & {
    /** The connected clients, kept current. Close it when done. */
    open(): ClientsStore;
  };
  call<N extends CallName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  offer(action: ActionDeclaration, handler: ActionHandler): Disposer;
  /** The sends the journal replayed, at connect or on `resend`, that the host refused, kept until `take` so the client can give each one's text back. */
  readonly refused: RefusedSends;
}

const MAIN = asId<"head">("main");

const TAIL = 200;

/** Connects to the host at `options.url` and resolves once it has answered and proved itself as `sdk.connect` does: requests, the journal, the socket and every chat over one connection. `close()` closes all of it. */
export async function connect(options: ClientConnectOptions): Promise<ClientConnection> {
  const fetch = options.transport?.fetch;
  const cell = linkCell();

  const dialing = () =>
    dial({
      url: options.url,
      credentials: options.credentials,
      expect: options.expect,
      journal: options.journal,
      fetch,
      link: cell,
    });

  const dialed = options.wait === undefined ? await dialing() : await answered(dialing, options.wait);

  const http = dialed.connection;

  const link = openLink(options.url, {
    link: cell,
    host: http.hostId,
    credentials: dialed.credential,
    client: options.client,
    socket: options.transport?.socket,
    fetch,
  });

  const close = async (): Promise<void> => {
    link.close();
    await http.close();
  };

  return {
    ...http,
    ...link,
    health: healthLink(link.link),
    credential: dialed.credential,
    refused: dialed.journal.refused,
    sessions: { ...http.sessions, open: (window) => link.sessions(window) },
    clients: { ...http.clients, open: () => link.clients() },
    client: (id) => ({
      perform: (action, input, options) => link.perform(id, action, input, options),
    }),
    chat(session, chat) {
      const head = chat?.head ?? MAIN;
      const tail = chat?.tail ?? TAIL;

      return openChat({
        session: http.session(session),
        head,
        open: () => link.head(session, head, { tail }),
        text: (listener) => link.text(listener),
        link: link.link,
        journal: dialed.journal,
      });
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

async function answered<T>(dialing: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();

    try {
      return await dialing();
    } catch (error) {
      if (!linkLost(error)) throw error;
      await sleep(retryDelay(attempt), signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function healthLink(link: Live<LinkState>): Live<Health> {
  let read: LinkState | null = null;
  let health: Health = { kind: "connecting" };

  return {
    subscribe: (listener) => link.subscribe(listener),
    snapshot() {
      const state = link.snapshot();

      if (state !== read) {
        read = state;
        health = readHealth(state);
      }

      return health;
    },
  };
}

function readHealth(state: LinkState): Health {
  switch (state.kind) {
    case "connecting":
    case "closed":
      return { kind: "connecting" };
    case "open":
      return { kind: "open", since: state.since };
    case "away":
      return {
        kind: "retrying",
        attempt: 1,
        at: state.retryAt,
        error: new SdkError("unavailable", "The host is away."),
      };
    case "refused":
      return {
        kind: "blocked",
        reason: state.reason === "auth" || state.reason === "other-host" ? state.reason : "version",
        error: state.error,
      };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}
