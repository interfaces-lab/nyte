import { isJson, isJsonObject, SdkError, SOCKET_PATH, TICKET_PATH } from "@nyte-ai/schema";
import type { SocketLike } from "@nyte-ai/protocol";
import { hostUrl } from "./host-connection.ts";
import type { OpenSocket, SocketRequest } from "./host-connection.ts";

type Listener = (event: {
  readonly data: unknown;
  readonly code: number;
  readonly reason: string;
}) => void;

type UrlSocket = new (url: string) => SocketLike;

export function ticketSocket(
  options: { readonly fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {},
): OpenSocket {
  return (request) => deferredSocket(() => dialWithTicket(request, options.fetch ?? fetch));
}

async function dialWithTicket(
  request: SocketRequest,
  send: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SocketLike> {
  const url = new URL(request.url);
  const address = `${url.origin}${url.pathname.slice(0, -SOCKET_PATH.length)}`;

  const response = await send(hostUrl(address, TICKET_PATH, "http"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...request.headers },
    body: "{}",
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new SdkError(
      response.status === 401
        ? "unauthenticated"
        : response.status === 403
          ? "denied"
          : "unavailable",
      `The host refused a socket ticket (${String(response.status)}).`,
    );
  }

  const answer: unknown = await response.json();
  const ticket = isJson(answer) && isJsonObject(answer) ? answer["ticket"] : undefined;

  if (typeof ticket !== "string" || ticket === "")
    throw new SdkError("invalid", "The host answered no socket ticket.");
  const Socket: unknown = globalThis.WebSocket;

  if (!urlSocketClass(Socket))
    throw new SdkError("not_supported", "This runtime has no WebSocket; pass a socket factory.");
  url.searchParams.set("ticket", ticket);

  return new Socket(url.href);
}

function deferredSocket(open: () => Promise<SocketLike>): SocketLike {
  const listeners = new Map<string, Set<Listener>>();
  let socket: SocketLike | null = null;
  let closed = false;

  const emit = (type: string, event: { readonly code: number; readonly reason: string }): void => {
    for (const listener of listeners.get(type) ?? []) listener({ data: undefined, ...event });
  };

  void open().then(
    (opened) => {
      if (closed) {
        opened.close();

        return;
      }

      socket = opened;
      opened.addEventListener("open", () => emit("open", { code: 0, reason: "" }));
      opened.addEventListener("message", (event) => {
        for (const listener of listeners.get("message") ?? [])
          listener({ data: event.data, code: 0, reason: "" });
      });
      opened.addEventListener("error", () => emit("error", { code: 0, reason: "" }));
      opened.addEventListener("close", (event) => emit("close", event));
    },
    (cause: unknown) => {
      closed = true;
      emit("error", { code: 0, reason: "" });
      emit("close", { code: 1006, reason: cause instanceof Error ? cause.message : String(cause) });
    },
  );

  return {
    send(data) {
      if (socket === null) throw new SdkError("unavailable", "The host socket is not open yet.");
      socket.send(data);
    },
    close(code, reason) {
      closed = true;
      socket?.close(code, reason);
    },
    addEventListener(type: string, listener: Listener) {
      const known = listeners.get(type) ?? new Set<Listener>();
      known.add(listener);
      listeners.set(type, known);
    },
  };
}

function urlSocketClass(value: unknown): value is UrlSocket {
  if (typeof value !== "function") return false;

  return "CONNECTING" in value;
}
