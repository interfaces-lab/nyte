import { Buffer } from "node:buffer";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, STATUS_CODES } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import process from "node:process";
import type { Duplex } from "node:stream";
import { SdkError, SOCKET_LIMITS, SOCKET_PATH } from "@nyte-ai/schema";
import type { ListenOptions, Listener } from "@nyte-ai/core";
import type { ServedHost } from "@nyte-ai/core/server";
import { asSdkError, encodeError, errorStatus } from "@nyte-ai/protocol";
import { WebSocketServer } from "ws";
import { listenFetch } from "./listen-fetch.ts";
import { readErrorCode } from "./local/tree.ts";
import { sharedListeners } from "./serve/listeners.ts";
import { serveSession } from "./serve/socket.ts";
import type { SocketPeer } from "./serve/socket.ts";
import type { TailnetControl } from "./tailnet.ts";

export type HostListenOptions = ListenOptions & { readonly tailnet?: TailnetControl };

/** Serves a composed host, the `Host.listen` `openHost` attaches: everything but the socket is `listenFetch`'s, and the `fetch` transport answers with it directly. The `http` transport binds `node:http` on `hostname` (default 127.0.0.1) and `port` (default 0); the `socket` transport binds a unix socket at `path`, owner-only, replacing a stale one, and is the one route that answers `local` operations. Both stream each request body in and each response body out chunk by chunk, with a client gone aborting its request; a failed bind throws `SdkError("unavailable")` after releasing the execution. `disconnectClients()` also destroys every open Node response, and `close()` closes the socket once. */
export async function listen(host: ServedHost, options: HostListenOptions): Promise<Listener> {
  const transport = options.transport;

  const inner = await listenFetch(host, {
    ...options,
    transport: { kind: "fetch" },
    local: transport.kind === "socket",
  });

  if (transport.kind === "fetch") return inner;

  const fetch = (request: Request): Promise<Response> => inner.fetch(request);

  const admit = (request: Request): Promise<SocketPeer> => inner.admit(request);

  const served = await (
    transport.kind === "socket"
      ? serveSocket(transport.path, fetch, "http", admit)
      : serveNode(fetch, "http", (server) => listenPort(server, transport), admit)
  ).catch(async (error: unknown) => {
    await inner.close();

    throw new SdkError(
      "unavailable",
      `Cannot listen: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const unlist = sharedListeners(host.server).add(served.address);

  const disconnectClients = (): void => {
    inner.disconnectClients();
    served.disconnect();
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      unlist();
      disconnectClients();
      await inner.close();
      await served.close();
    })();

    return closing;
  };

  return {
    address: served.address,
    fetch,
    disconnectClients,
    close,
    [Symbol.asyncDispose]: close,
  };
}

type Served = {
  readonly address: string;
  disconnect(): void;
  close(): Promise<void>;
};

type Admit = (request: Request) => Promise<SocketPeer>;

export function serveSocket(
  path: string,
  fetch: (request: Request) => Promise<Response>,
  scheme: "http" | "https",
  admit: Admit,
): Promise<Served> {
  return serveNode(
    fetch,
    scheme,
    async (server) => {
      await listenSocket(server, path);

      return { address: path, origin: `${scheme}://localhost` };
    },
    admit,
  );
}

async function serveNode(
  fetch: (request: Request) => Promise<Response>,
  scheme: "http" | "https",
  start: (server: Server) => Promise<{ readonly address: string; readonly origin: string }>,
  admit: Admit,
): Promise<Served> {
  const responses = new Set<ServerResponse>();
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: SOCKET_LIMITS.maxFrameBytes,
  });
  let origin = "";

  const server = createServer({ noDelay: true }, (incoming, outgoing) => {
    void respond(incoming, outgoing, { scheme, origin }, fetch, responses);
  });

  server.on("upgrade", (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    void upgrade(incoming, socket, { scheme, origin }, admit).then((peer) => {
      if (peer === null) return;

      if (socket.destroyed) {
        peer.leave();

        return;
      }

      sockets.handleUpgrade(incoming, socket, head, (opened) => serveSession(opened, peer));
    });
  });

  const started = await start(server);
  origin = started.origin;

  return {
    address: started.address,
    disconnect() {
      for (const response of responses) response.destroy();

      for (const opened of sockets.clients) opened.terminate();
    },
    close: () =>
      new Promise<void>((done) => {
        for (const opened of sockets.clients) opened.terminate();
        sockets.close();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

async function upgrade(
  incoming: IncomingMessage,
  socket: Duplex,
  origin: { readonly scheme: "http" | "https"; readonly origin: string },
  admit: Admit,
): Promise<SocketPeer | null> {
  socket.on("error", () => socket.destroy());

  try {
    const request = readRequest(incoming, origin, new AbortController().signal);
    const path = new URL(request.url).pathname;

    if (path !== SOCKET_PATH) throw new SdkError("unknown", `No socket answers ${path}.`);

    return await admit(request);
  } catch (error) {
    refuse(socket, asSdkError(error));

    return null;
  }
}

function refuse(socket: Duplex, error: SdkError): void {
  const body = JSON.stringify(encodeError(error));
  const status = errorStatus[error.code];

  socket.end(
    [
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}`,
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n"),
  );
}

async function listenPort(
  server: Server,
  transport: { readonly hostname?: string; readonly port?: number },
): Promise<{ readonly address: string; readonly origin: string }> {
  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(transport.port ?? 0, transport.hostname ?? "127.0.0.1", () => {
      server.off("error", failed);
      listening();
    });
  });

  const info = server.address();

  if (info === null || typeof info === "string") {
    server.close();

    throw new Error("the socket has no address");
  }

  const hostname = info.address.includes(":") ? `[${info.address}]` : info.address;
  const origin = `http://${hostname}:${info.port}`;

  return { address: origin, origin };
}

async function listenSocket(server: Server, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  await bindPath(server, path).catch(async (error: unknown) => {
    if (readErrorCode(error) !== "EADDRINUSE" || (await answers(path))) throw error;
    await rm(path, { force: true });
    await bindPath(server, path);
  });

  if (process.platform !== "win32") await chmod(path, 0o600);
}

function bindPath(server: Server, path: string): Promise<void> {
  return new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(path, () => {
      server.off("error", failed);
      listening();
    });
  });
}

function answers(path: string): Promise<boolean> {
  return new Promise<boolean>((done) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.destroy();
      done(true);
    });
    probe.once("error", () => done(false));
  });
}

async function respond(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: { readonly scheme: "http" | "https"; readonly origin: string },
  fetch: (request: Request) => Promise<Response>,
  responses: Set<ServerResponse>,
): Promise<void> {
  const controller = new AbortController();
  responses.add(outgoing);
  outgoing.on("close", () => {
    responses.delete(outgoing);

    if (!outgoing.writableFinished) controller.abort();
  });

  let request: Request;

  try {
    request = readRequest(incoming, origin, controller.signal);
  } catch (error) {
    await write(
      failure(new SdkError("invalid", error instanceof Error ? error.message : String(error))),
      outgoing,
    );

    return;
  }

  await write(await fetch(request), outgoing);
}

function readRequest(
  incoming: IncomingMessage,
  origin: { readonly scheme: "http" | "https"; readonly origin: string },
  signal: AbortSignal,
): Request {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (name.startsWith(":") || value === undefined) continue;

    if (Array.isArray(value)) for (const each of value) headers.append(name, each);
    else headers.set(name, value);
  }

  const host = incoming.headers.host;
  const url = new URL(
    incoming.url ?? "/",
    host === undefined ? origin.origin : `${origin.scheme}://${host}`,
  );
  const method = incoming.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD"
      ? {}
      : { body: streamBody(incoming), duplex: "half" as const };

  return new Request(url.href, { method, headers, signal, ...body });
}

function streamBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));

        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.on("end", () => controller.close());
      incoming.on("error", (error) => controller.error(error));
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      incoming.destroy();
    },
  });
}

async function write(response: Response, outgoing: ServerResponse): Promise<void> {
  if (outgoing.destroyed) {
    await response.body?.cancel().catch(() => undefined);

    return;
  }

  const headers: Record<string, string | string[]> = {};

  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();

  if (cookies.length > 0) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.flushHeaders();

  if (response.body === null) {
    outgoing.end();

    return;
  }

  const reader = response.body.getReader();

  const cancel = (): void => {
    reader.cancel().catch(() => undefined);
  };

  outgoing.on("close", cancel);

  try {
    for (;;) {
      const read = await reader.read();

      if (read.done) break;

      if (!outgoing.write(read.value))
        await new Promise<void>((drained) => {
          const done = (): void => {
            outgoing.off("drain", done);
            outgoing.off("close", done);
            drained();
          };

          outgoing.on("drain", done);
          outgoing.on("close", done);
        });

      if (outgoing.destroyed) return;
    }

    outgoing.end();
  } catch {
    outgoing.destroy();
  } finally {
    outgoing.off("close", cancel);
  }
}

function failure(error: SdkError): Response {
  return new Response(JSON.stringify(encodeError(error)), {
    status: errorStatus[error.code],
    headers: { "Content-Type": "application/json" },
  });
}
