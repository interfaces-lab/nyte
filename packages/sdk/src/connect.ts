import { asId } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  ClientId,
  ClientInfo,
  CredentialSource,
  Disposer,
  HeadName,
  Json,
  PartId,
  SessionId,
} from "@nyte-ai/schema";
import type { ConnectOptions, Connection, RequestJournal, Sessions } from "@nyte-ai/core";
import type { CallName, OperationInput, OperationOutput } from "@nyte-ai/protocol";
import { dial } from "./connection/connect.ts";
import type { HostCredentials } from "./connection/connect.ts";
import { openChat } from "./live/chat.ts";
import type { Chat, ChatOptions } from "./live/chat.ts";
import type { ClientsStore } from "./live/clients.ts";
import type { HeadStore } from "./live/head.ts";
import { openLink } from "./live/host-connection.ts";
import type {
  ActionHandler,
  Fetch,
  Health,
  OpenSocket,
  TextUpdate,
} from "./live/host-connection.ts";
import type { PartStore } from "./live/part.ts";
import type { RefusedSends } from "./send/journal.ts";
import type { SessionsStore, SessionsWindow } from "./live/sessions.ts";
import type { Live } from "./live/store.ts";

export interface ClientConnectOptions {
  readonly url: string;
  /** A token, custom headers, or a pairing code, which the first request trades for a device token that becomes `credential`. */
  readonly credentials: CredentialSource;
  readonly expect?: ConnectOptions["expect"];
  /** How this client names itself to the host and to the other clients. */
  readonly client: Omit<ClientInfo, "actions">;
  /** Where a send waits until the host has it. Give it storage that outlives the process (`createSendJournal(storage)`), or a message sent while the host is away is lost on quit. */
  readonly journal: RequestJournal;
  /** The global `fetch` and `WebSocket` when absent: a desktop bridge or React Native passes its own. */
  readonly transport?: { readonly fetch?: Fetch; readonly socket?: OpenSocket };
}

export interface ClientConnection extends Connection {
  /** The credential every request and the socket send: a pairing code is traded for a device token before `connect` resolves. */
  readonly credential: HostCredentials;
  readonly sessions: Sessions & {
    /** The sessions in `window`, kept current: the newest roots by default, `pinned`, a parent's children, or the roots whose name holds `query`. Close it when done. */
    open(window?: SessionsWindow): SessionsStore;
  };
  /** The socket's state. The socket dials on the first use of anything below, so a connection that only makes requests opens none. */
  readonly health: Live<Health>;
  /** Call it when the link may have come back: the app came forward, the window got focus, the network returned. A link that is retrying or blocked dials now; an open one checks the host answers. */
  retry(): void;
  /** The chat of `session`'s `options.head` (main by default): its view, kept current, and the actions a chat screen takes. Each call returns its own chat. */
  chat(session: SessionId, options?: ChatOptions): Chat;
  head(session: SessionId, head: HeadName, options: { readonly tail: number }): HeadStore;
  part(session: SessionId, part: PartId): PartStore;
  text(listener: (update: TextUpdate) => void): Disposer;
  clients(): ClientsStore;
  call<N extends CallName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  perform(
    client: ClientId,
    action: string,
    input: Json,
    options?: { readonly timeoutMs?: number },
  ): Promise<Json>;
  offer(action: ActionDeclaration, handler: ActionHandler): Disposer;
  /** The sends the journal replayed, at connect or on `resend`, that the host refused, kept until `take` so the client can give each one's text back. */
  readonly refused: RefusedSends;
}

const MAIN = asId<"head">("main");

const TAIL = 200;

/** Connects to the host at `options.url` and resolves once it has answered and proved itself as `sdk.connect` does: requests, the journal, the socket and every chat over one connection. `close()` closes all of it. */
export async function connect(options: ClientConnectOptions): Promise<ClientConnection> {
  const fetch = options.transport?.fetch;

  const dialed = await dial({
    url: options.url,
    credentials: options.credentials,
    expect: options.expect,
    journal: options.journal,
    fetch,
  });

  const http = dialed.connection;

  const link = openLink(options.url, {
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
    credential: dialed.credential,
    refused: dialed.journal.refused,
    sessions: { ...http.sessions, open: (window) => link.sessions(window) },
    chat(session, chat) {
      const head = chat?.head ?? MAIN;
      const tail = chat?.tail ?? TAIL;

      return openChat({
        session: http.session(session),
        head,
        open: () => link.head(session, head, { tail }),
        text: (listener) => link.text(listener),
        health: link.health,
        journal: dialed.journal,
      });
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}
