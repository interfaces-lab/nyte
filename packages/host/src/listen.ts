import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SdkError } from "@nyte-ai/core";
import type { Host, Kernel, ListenOptions, Listener } from "@nyte-ai/core";
import { encodeError, errorStatus } from "@nyte-ai/protocol";
import { listenFetch } from "./listen-fetch.ts";

/** Serves a composed host, the `Host.listen` h3's `openHost` attaches; `plugins.replace`/`plugins.check` load their wire paths through the kernel's `loadPlugins` (§40b, §47m; absent, a file answers `unavailable`). A `token` auth shorter than 16 characters throws `SdkError("invalid")` before anything binds. Each request goes to `before` first (its response answered as is); then, unauthenticated, `GET /.nyte/identity?nonce=<nonce>` answers `{ hostId, publicKey, nonce, signature }` as JSON (the host's id with what `identity.sign(nonce)` answers, §43a) and `GET /.nyte/describe` answers `describe()` (each `unknown`, 404, when its option is absent or the nonce is missing; an allowed `Origin` gets `Access-Control-Allow-Origin`); everything else goes to protocol's `createHandler` with the host's `kernel`, `origins` and `maxBodyBytes` (default 8 MiB). Its `connection(request)` resolves a principal: `Authorization: Pairing <code>` (under either auth kind) redeems the code with `redeemPairing` (unknown or expired, `unauthenticated`) and answers the device token in `X-Nyte-Credential` through the handler's `headers` (decision 11, §40j, §40t); under `token`, `Authorization: Bearer <token>` equal to the token, compared in constant time over Web Crypto SHA-256 digests (so neither length nor content leaks), is `TOKEN` with `TOKEN_AUTHORITY`, any other bearer is a device token for `authenticateToken` (remembered by digest for 60 s and until its principal's connection drops, so a revoke through another host on the same store is seen within a minute and `lastSeenAt` is written once a minute per device, never on every request; when a remembered token's read finds no principal holding it, that principal is revoked here too through `kernel.connections.revoke`, so its open streams end and its connection drops, §41j), and anything else is `unauthenticated`; under `custom`, a `Bearer` device token is accepted the same way first (decision 11's exchange behind a relay, §41j), and only a request without one, or with a token no principal holds, goes to `authorize(request)`, which names the principal and authority, `deny: "unauthorized"` answering `unauthenticated` (401) and `"forbidden"` `denied` (403). One connection per principal and authority, `createConnection(kernel, { principal, authority, credential, origin: null })` with the token it presented as the credential (empty for a principal `authorize` names), is cached and registered with `kernel.connections`; each request's signal is tied to its principal until its response body ends, so `principals.revoke` (`kernel.connections.revoke`) aborts that principal's open requests and streams, `head.watch` included, and drops its connection from the cache, while accepted work continues. `execution` (default run covering all, §41b): when the kernel's own execution is `admit-only` the listener drives the covered sessions with `driveInProcess`, else it only takes their leases with `host.execution.cover`; `admit-only` takes nothing, and a `dispatch` kernel is treated as `admit-only` whatever `execution` says: no in-process driver and no cover (§42v). Everything but the socket is `listenFetch`'s: `listen` calls it with the `fetch` transport and, for `http`, binds `node:http` on `hostname` (default 127.0.0.1) and `port` (default 0), adapting each `IncomingMessage` to a `Request` whose body streams in and whose signal aborts when the client goes away, and streaming each `Response` body back chunk by chunk with its headers flushed first, so event and octet streams never buffer; `address` is `http://<host>:<port>` read from the bound socket, and a failed bind throws `SdkError("unavailable")` after releasing the execution. `fetch` binds nothing, `address` is null and the listener is `listenFetch`'s own. `disconnectClients()` closes every cached connection, aborts every open response (each request's signal is tied to the listener's, and over `http` each Node response is destroyed) and forgets the device tokens: accepted work continues and the next request authenticates again. `close()` and `[Symbol.asyncDispose]` disconnect the clients, release the execution and close the socket, once; never a durable stop. After it, every request answers `unavailable`. Every response, `before`'s included, carries `X-Nyte-Host` with the host's id, as `listenFetch` says (§43a, §43j). */
export async function listen(
  host: Omit<Host, "listen"> & { readonly kernel: Kernel },
  options: ListenOptions,
): Promise<Listener> {
  const inner = await listenFetch(host, { ...options, transport: { kind: "fetch" } });

  if (options.transport.kind === "fetch") return inner;
  const responses = new Set<ServerResponse>();

  const bound = await bind(options.transport, (request) => inner.fetch(request), responses).catch(
    async (error: unknown) => {
      await inner.close();

      throw new SdkError(
        "unavailable",
        `Cannot listen: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );

  const disconnectClients = (): void => {
    inner.disconnectClients();

    for (const response of responses) response.destroy();
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      disconnectClients();
      await inner.close();
      await new Promise<void>((done) => {
        bound.server.close(() => done());
        bound.server.closeAllConnections();
      });
    })();

    return closing;
  };

  return {
    address: bound.address,
    fetch: (request) => inner.fetch(request),
    disconnectClients,
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Binds `node:http` and resolves the server with its `http://<host>:<port>` address. */
async function bind(
  transport: { readonly hostname?: string; readonly port?: number },
  fetch: (request: Request) => Promise<Response>,
  responses: Set<ServerResponse>,
): Promise<{ readonly server: Server; readonly address: string }> {
  let origin = "http://127.0.0.1";

  const server = createServer({ noDelay: true }, (incoming, outgoing) => {
    void respond(incoming, outgoing, origin, fetch, responses);
  });

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
  origin = `http://${hostname}:${info.port}`;

  return { server, address: origin };
}

/** Answers one Node request through `fetch`: the request adapted with a streamed body and a signal that aborts when the client goes away, the response written back as its body streams. */
async function respond(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string,
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
    request = requestOf(incoming, origin, controller.signal);
  } catch (error) {
    await write(
      failure(new SdkError("invalid", error instanceof Error ? error.message : String(error))),
      outgoing,
    );

    return;
  }

  await write(await fetch(request), outgoing);
}

function requestOf(incoming: IncomingMessage, origin: string, signal: AbortSignal): Request {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (name.startsWith(":") || value === undefined) continue;

    if (Array.isArray(value)) for (const each of value) headers.append(name, each);
    else headers.set(name, value);
  }

  const host = incoming.headers.host;
  const url = new URL(incoming.url ?? "/", host === undefined ? origin : `http://${host}`);
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? null : bodyOf(incoming);

  return new Request(url, { method, headers, body, duplex: "half", signal });
}

/** Returns a Node request's body as a stream that pauses the socket while the reader is full. */
function bodyOf(incoming: IncomingMessage): ReadableStream<Uint8Array> {
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

/** Writes a `Response` to a Node response: status and headers flushed at once, then each body chunk as it arrives, waiting for the socket to drain; a client gone cancels the body. */
async function write(response: Response, outgoing: ServerResponse): Promise<void> {
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
          outgoing.once("drain", drained);
          outgoing.once("close", drained);
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
