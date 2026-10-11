import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Authority, Disposer, Owned, PrincipalId } from "@nyte-ai/schema";
import {
  SdkError,
  TOKEN,
  TOKEN_AUTHORITY,
  authenticateToken,
  createConnection,
  driveInProcess,
  redeemPairing,
} from "@nyte-ai/core";
import type { Connection, Host, Kernel, ListenOptions, Listener } from "@nyte-ai/core";
import { asSdkError, createHandler, encodeError, errorStatus } from "@nyte-ai/protocol";
import type { HandlerOptions } from "@nyte-ai/protocol";

/** Returns one cached connection: what it serves and how it leaves the cache. */
type Cached = {
  readonly connection: Connection;
  readonly principal: PrincipalId;
  dispose: Disposer;
};

/** Returns one request on its way through the handler: the request as forwarded, the controller tied into its signal and, once it authenticated, its principal. The flight holds the request because undici's `Request` follows the signal it was given only while the request object lives, and the handler lets go of it once a streamed response starts. */
type Flight = {
  readonly request: Request;
  readonly controller: AbortController;
  principal: PrincipalId | null;
};

/** Returns a device token remembered by digest: its principal and authority until `expiresAt`. */
type Device = {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly expiresAt: number;
};

const DEVICE_TTL_MS = 60_000;

/** Serves a composed host, the `Host.listen` h3's `openHost` attaches; `plugins` is the file loader `plugins.replace`/`plugins.check` load their wire paths through (§40b, §41b; absent, those rows answer `unavailable`). A `token` auth shorter than 16 characters throws `SdkError("invalid")` before anything binds. Each request goes to `before` first (its response answered as is); then, unauthenticated, `GET /.nyte/identity?nonce=<nonce>` answers `identity.sign(nonce)` as JSON and `GET /.nyte/describe` answers `describe()` (each `unknown`, 404, when its option is absent or the nonce is missing; an allowed `Origin` gets `Access-Control-Allow-Origin`); everything else goes to protocol's `createHandler` with the host's `kernel`, `host.plugins`/`host.principals` as the maintenance surface, `plugins`, `origins` and `maxBodyBytes` (default 8 MiB). Its `connection(request)` resolves a principal: `Authorization: Pairing <code>` (under either auth kind) redeems the code with `redeemPairing` (unknown or expired, `unauthenticated`) and answers the device token in `X-Nyte-Credential` through the handler's `headers` (decision 11, §40j, §40t); under `token`, `Authorization: Bearer <token>` equal to the token, compared in constant time over SHA-256 digests (so neither length nor content leaks), is `TOKEN` with `TOKEN_AUTHORITY`, any other bearer is a device token for `authenticateToken` (remembered by digest for 60 s and until its principal's connection drops, so a revoke through another host on the same store is seen within a minute and `lastSeenAt` is written once a minute per device, never on every request; when a remembered token's re-check finds no principal holding it, that principal is revoked here too through `kernel.connections.revoke`, so its open streams end and its connection drops, §41j), and anything else is `unauthenticated`; under `custom`, a `Bearer` device token is accepted the same way first (decision 11's exchange behind a relay, §41j), and only a request without one, or with a token no principal holds, goes to `authorize(request)`, which names the principal and authority, `deny: "unauthorized"` answering `unauthenticated` (401) and `"forbidden"` `denied` (403). One connection per principal and authority, `createConnection(kernel, { principal, authority, credential, origin: null })` with the token it presented as the credential (empty for a principal `authorize` names), is cached and registered with `kernel.connections`; each request's signal is tied to its principal until its response body ends, so `principals.revoke` (`kernel.connections.revoke`) aborts that principal's open requests and streams, `head.watch` included, and drops its connection from the cache, while accepted work continues. `execution` (default run covering all, §41b): when the kernel's own execution is `admit-only` the listener drives the covered sessions with `driveInProcess`, else it only takes their leases with `host.execution.cover`; `admit-only` takes nothing, and a `dispatch` kernel is treated as `admit-only` whatever `execution` says: no in-process driver and no cover (§42v). `http` binds `node:http` on `hostname` (default 127.0.0.1) and `port` (default 0), adapting each `IncomingMessage` to a `Request` whose body streams in and whose signal aborts when the client goes away, and streaming each `Response` body back chunk by chunk with its headers flushed first, so event and octet streams never buffer; `address` is `http://<host>:<port>` read from the bound socket, and a failed bind throws `SdkError("unavailable")` after releasing the execution. `fetch` binds nothing and `address` is null. `disconnectClients()` closes every cached connection, aborts every open response (each request's signal is tied to the listener's) and forgets the device tokens: accepted work continues and the next request authenticates again. `close()` and `[Symbol.asyncDispose]` disconnect the clients, release the execution and close the socket, once; never a durable stop. After it, every request answers `unavailable`. */
export async function listen(
  host: Omit<Host, "listen"> & { readonly kernel: Kernel },
  options: ListenOptions,
  plugins?: NonNullable<HandlerOptions["plugins"]>,
): Promise<Listener> {
  const { auth } = options;

  if (auth.kind === "token" && auth.token.length < 16)
    throw new SdkError("invalid", "A listener token needs at least 16 characters.");
  const { kernel } = host;
  const cache = new Map<string, Cached>();
  const devices = new Map<string, Device>();
  const flights = new WeakMap<Request, Flight>();
  const streams = new Map<PrincipalId, Set<Flight>>();
  const responses = new Set<ServerResponse>();
  let generation = new AbortController();
  let closed = false;

  const drop = (key: string, entry: Cached): void => {
    if (cache.get(key) === entry) cache.delete(key);
    entry.dispose();

    for (const [digest, device] of devices)
      if (device.principal === entry.principal) devices.delete(digest);
    const open = streams.get(entry.principal);
    streams.delete(entry.principal);

    for (const flight of open ?? [])
      flight.controller.abort(
        new SdkError("unavailable", "The principal's connection was dropped."),
      );
    void entry.connection.close();
  };

  const land = (flight: Flight): void => {
    const open = flight.principal === null ? undefined : streams.get(flight.principal);
    open?.delete(flight);

    if (open?.size === 0 && flight.principal !== null) streams.delete(flight.principal);
  };

  const connectionFor = (
    request: Request,
    principal: PrincipalId,
    authority: ReadonlySet<Authority>,
    token: string,
  ): Connection => {
    const flight = flights.get(request);

    if (flight !== undefined && flight.principal === null) {
      flight.principal = principal;
      const open = streams.get(principal) ?? new Set<Flight>();
      open.add(flight);
      streams.set(principal, open);
    }

    const key = JSON.stringify([principal, [...authority].sort()]);
    const known = cache.get(key);

    if (known !== undefined) return known.connection;

    const connection = createConnection(kernel, {
      principal,
      authority,
      credential: { kind: "token", token },
      origin: null,
    });

    const entry: Cached = { connection, principal, dispose: () => undefined };
    cache.set(key, entry);
    entry.dispose = kernel.connections.register(principal, () => drop(key, entry));

    return connection;
  };

  const deviceOf = async (token: string): Promise<Device | null> => {
    const digest = digestOf(token);
    const known = devices.get(digest);

    if (known !== undefined && known.expiresAt > Date.now()) return known;
    const found = await authenticateToken(kernel, token);

    if (found === null) {
      devices.delete(digest);

      if (known !== undefined) kernel.connections.revoke(known.principal);

      return null;
    }

    const device = { ...found, expiresAt: Date.now() + DEVICE_TTL_MS };
    devices.set(digest, device);

    return device;
  };

  const authenticate: HandlerOptions["connection"] = async (request) => {
    const header = request.headers.get("Authorization") ?? "";
    const pairing = /^Pairing\s+(\S+)\s*$/i.exec(header)?.[1];

    if (pairing !== undefined) {
      const redeemed = await redeemPairing(kernel, pairing);

      if (redeemed === null)
        throw new SdkError("unauthenticated", "The pairing code is unknown or has expired.");

      return {
        connection: connectionFor(request, redeemed.principal, redeemed.authority, redeemed.token),
        authority: redeemed.authority,
        headers: { "X-Nyte-Credential": redeemed.token },
      };
    }

    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];

    if (token !== undefined) {
      if (auth.kind === "token" && sameSecret(token, auth.token))
        return {
          connection: connectionFor(request, TOKEN, TOKEN_AUTHORITY, token),
          authority: TOKEN_AUTHORITY,
        };
      const device = await deviceOf(token);

      if (device !== null)
        return {
          connection: connectionFor(request, device.principal, device.authority, token),
          authority: device.authority,
        };
    }

    if (auth.kind === "custom") {
      const verdict = await auth.authorize(request);

      if ("deny" in verdict)
        throw verdict.deny === "forbidden"
          ? new SdkError("denied", "This principal may not call the host.")
          : new SdkError("unauthenticated", "The request is not authorized.");

      return {
        connection: connectionFor(request, verdict.principal, verdict.authority, ""),
        authority: verdict.authority,
      };
    }

    throw new SdkError(
      "unauthenticated",
      token === undefined ? "Send Authorization: Bearer <token>." : "The token is not accepted.",
    );
  };

  const handler = createHandler({
    kernel,
    host: { plugins: host.plugins, principals: host.principals },
    plugins,
    origins: options.origins,
    maxBodyBytes: options.maxBodyBytes,
    connection: authenticate,
  });

  const cors = (request: Request): Readonly<Record<string, string>> => {
    const origin = request.headers.get("Origin");

    return origin !== null && (options.origins ?? []).includes(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
  };

  const serve = async (request: Request): Promise<Response> => {
    if (closed) return failure(new SdkError("unavailable", "This listener is closed."), {});
    const early = await options.before?.(request);

    if (early !== undefined) return early;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/.nyte/identity") {
      const nonce = url.searchParams.get("nonce");

      if (options.identity === undefined || nonce === null || nonce === "")
        return failure(
          new SdkError("unknown", "This host answers no identity challenge."),
          cors(request),
        );

      return json(await options.identity.sign(nonce), cors(request));
    }

    if (request.method === "GET" && url.pathname === "/.nyte/describe") {
      if (options.describe === undefined)
        return failure(new SdkError("unknown", "This host describes nothing."), cors(request));

      return json(await options.describe(), cors(request));
    }

    const controller = new AbortController();

    const forwarded = new Request(request, {
      signal: AbortSignal.any([request.signal, generation.signal, controller.signal]),
    });

    const flight: Flight = { request: forwarded, controller, principal: null };
    flights.set(forwarded, flight);
    const response = await handler(forwarded);

    return flight.principal === null ? response : landing(response, () => land(flight));
  };

  const fetch = async (request: Request): Promise<Response> => {
    try {
      return await serve(request);
    } catch (error) {
      return failure(asSdkError(error), cors(request));
    }
  };

  const execution = options.execution ?? { kind: "run", coverage: { kind: "all" } };

  const coverage: Owned | null =
    execution.kind === "admit-only"
      ? null
      : kernel.execution.kind === "admit-only"
        ? driveInProcess(kernel, execution.coverage)
        : await host.execution.cover(execution.coverage);

  let server: Server | null = null;
  let address: string | null = null;

  if (options.transport.kind === "http") {
    const bound = await bind(options.transport, fetch, responses).catch(async (error: unknown) => {
      await coverage?.close();

      throw new SdkError(
        "unavailable",
        `Cannot listen: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    server = bound.server;
    address = bound.address;
  }

  const disconnectClients = (): void => {
    for (const [key, entry] of cache) drop(key, entry);
    devices.clear();
    generation.abort(new SdkError("unavailable", "The host disconnected its clients."));
    generation = new AbortController();

    for (const response of responses) response.destroy();
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      closed = true;
      disconnectClients();
      await coverage?.close();
      const open = server;

      if (open !== null)
        await new Promise<void>((done) => {
          open.close(() => done());
          open.closeAllConnections();
        });
    })();

    return closing;
  };

  return { address, fetch, disconnectClients, close, [Symbol.asyncDispose]: close };
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
      failure(new SdkError("invalid", error instanceof Error ? error.message : String(error)), {}),
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

/** Returns the response with `done` called once when its body ends, errors or is cancelled, or at once when it has none. */
function landing(response: Response, done: () => void): Response {
  if (response.body === null) {
    done();

    return response;
  }

  return new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({ flush: done, cancel: done }),
    ),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}

function json(value: unknown, headers: Readonly<Record<string, string>>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function failure(error: SdkError, headers: Readonly<Record<string, string>>): Response {
  return new Response(JSON.stringify(encodeError(error)), {
    status: errorStatus[error.code],
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Compares a presented secret with the expected one in constant time over their SHA-256 digests. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
