/**
 * `@nyte-ai/server/node`: the Nyte server bound to one Node address. The root
 * export hands you `fetch` and listens on nothing; this one owns the listener
 * and the bridge between Node's request objects and the Web ones `fetch` reads.
 * `requestListener` is that bridge alone, for a server or middleware chain you
 * already own.
 *
 * `serve` binds one address, never every interface. Closing it ends the
 * listener and its streams but never the work a session already accepted.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { createNyteServer } from "./index.ts";
import type { NyteServerOptions } from "./index.ts";

export interface RequestListenerOptions {
  /** The origin request URLs resolve against. Default: the request's own `Host` header, over http. */
  readonly origin?: string;
  /** Hears a request the bridge itself could not serve; the client sees 500 or a dropped connection. */
  readonly onError?: (cause: unknown) => void;
}

export interface ServeOptions extends NyteServerOptions {
  /** The single address to bind and advertise. Default 127.0.0.1. */
  readonly hostname?: string;
  /** Default 0: a port the system picks, reported in `address`. */
  readonly port?: number;
  /**
   * Answers a request before the Nyte server, which never sees it, so its own
   * authorization is the only one applied. Resolve undefined for every
   * request it does not own.
   */
  readonly handle?: (request: Request) => Promise<Response | undefined>;
}

export interface Serving {
  /** `http://<hostname>:<port>`, the base URL a client enters. */
  readonly address: string;
  /**
   * Drop every open connection, streams included, and keep listening on the
   * same port. Clients that come back authenticate again, so a credential
   * refused from now on loses the streams it opened before.
   */
  disconnectClients(): void;
  /** Close the listener, drop its connections, and end open watches. Accepted SDK work continues. */
  close(): Promise<void>;
}

/** Time for ended responses to flush before remaining connections are destroyed. */
const DRAIN_MS = 500;

/** The request body as the server pulls it; the socket stays paused between pulls. */
function requestBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Uint8Array) => {
        controller.enqueue(chunk);
        incoming.pause();
      });
      incoming.once("end", () => controller.close());
      incoming.once("error", (cause) => controller.error(cause));
    },
    pull() {
      incoming.resume();
    },
    // The server stopped reading, as on a body past its limit. The reply still
    // goes out; the connection closes behind it instead of reading the rest.
    cancel() {
      incoming.pause();
    },
  });
}

function toRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string | undefined,
): Request {
  const headers = new Headers();

  for (const [name, values] of Object.entries(incoming.headersDistinct)) {
    for (const value of values ?? []) headers.append(name, value);
  }

  const controller = new AbortController();
  // A response that closes unfinished lost its client; the server aborts the
  // watch it was feeding and cancels a body it was still reading.
  outgoing.once("close", () => {
    if (!outgoing.writableFinished) controller.abort();
  });

  const method = incoming.method ?? "GET";
  const head = { method, headers, signal: controller.signal };

  const init =
    method === "GET" || method === "HEAD"
      ? head
      : { ...head, body: requestBody(incoming), duplex: "half" as const };

  // The string form: Node and Bun agree on it, and Bun's `Request` typing does not take a `URL`.
  return new Request(
    new URL(incoming.url ?? "/", origin ?? `http://${incoming.headers.host ?? "localhost"}`).href,
    init,
  );
}

async function writeResponse(
  response: Response,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  // An upload the server did not finish reading cannot precede another request.
  if (!incoming.complete) outgoing.shouldKeepAlive = false;

  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  outgoing.writeHead(response.status);

  if (response.body === null) {
    outgoing.end();

    return;
  }

  // Each frame reaches the socket as it is pulled, so a watch streams. A
  // client that leaves closes `outgoing`, which cancels the body upstream.
  const reader = response.body.getReader();

  const gone = new Promise<void>((resolve) => {
    outgoing.once("close", () => {
      void reader.cancel().catch(() => undefined);
      resolve();
    });
  });

  for (;;) {
    const { done, value } = await reader.read();

    if (done || outgoing.destroyed) break;

    if (!outgoing.write(value)) await Promise.race([once(outgoing, "drain"), gone]);
  }

  outgoing.end();
}

/** `fetch` as a Node request listener. It never throws; what it cannot serve goes to `onError`. */
export function requestListener(
  fetch: (request: Request) => Promise<Response> | Response,
  options: RequestListenerOptions = {},
): RequestListener {
  return (incoming, outgoing) => {
    const respond = async (): Promise<void> => {
      const response = await fetch(toRequest(incoming, outgoing, options.origin));
      await writeResponse(response, incoming, outgoing);
    };

    void respond().catch((cause: unknown) => {
      options.onError?.(cause);

      if (outgoing.headersSent) outgoing.destroy();
      else outgoing.writeHead(500).end();
    });
  };
}

export async function serve(options: ServeOptions): Promise<Serving> {
  const hostname = options.hostname ?? "127.0.0.1";
  const server = createNyteServer(options);
  const listener = createServer();

  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(options.port ?? 0, hostname, () => {
      listener.off("error", reject);
      resolve();
    });
  }).catch((cause: unknown) => {
    server.close();
    throw cause;
  });

  const bound = listener.address();

  if (bound === null || typeof bound === "string") {
    listener.close();
    server.close();
    throw new Error("The listener has no TCP address");
  }

  const address = `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${String(bound.port)}`;

  listener.on(
    "request",
    requestListener(async (request) => (await options.handle?.(request)) ?? server.fetch(request), {
      origin: address,
      onError: (cause) => options.onError?.({ route: "request", cause }),
    }),
  );

  return {
    address,
    disconnectClients() {
      listener.closeAllConnections();
    },
    async close() {
      // Watches end with a `closed` frame first, so a reading client hears why.
      server.close();
      const closed = new Promise<void>((resolve) => listener.close(() => resolve()));
      // A client that stopped reading would hold the listener open; cut what remains.
      const timer = setTimeout(() => listener.closeAllConnections(), DRAIN_MS);

      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
