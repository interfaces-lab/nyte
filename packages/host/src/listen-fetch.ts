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

const encoder = new TextEncoder();

/** Serves a composed host as a bare fetch handler with no socket and no `node:*` import, so a Worker can serve it (§41j): everything `listen` does, and in the same order, for the `fetch` transport — `before` first, the unauthenticated `GET /.nyte/identity?nonce=` and `GET /.nyte/describe` routes, then protocol's `createHandler` with the same `connection(request)` (pairing redeemed under either auth kind with the device token in `X-Nyte-Credential`; under `token` the listener token as `TOKEN` with `TOKEN_AUTHORITY`, any other bearer a device token for `authenticateToken` remembered for 60 s and until its principal's connection drops, a remembered token no principal holds any more revoking that principal through `kernel.connections`; under `custom` a known device token first, then `authorize(request)`), one connection per principal and authority registered with `kernel.connections` (a revoke aborts that principal's open requests and streams), CORS for `origins`, `maxBodyBytes` (default 8 MiB), `execution` (default run covering all: `driveInProcess` when the kernel is `admit-only`, else `host.execution.cover`; `admit-only` takes nothing, and a `dispatch` kernel is treated as `admit-only` whatever `execution` says, with no in-process driver and no cover, §42v), `disconnectClients()` and `close()` (once; every later request answers `unavailable`) — except that the listener token is compared in constant time over Web Crypto SHA-256 digests (`crypto.subtle.digest`, every byte pair XOR-folded into one accumulator, so neither length nor content leaks) and device tokens are remembered by their Web Crypto hex digest. A `token` auth shorter than 16 characters throws `SdkError("invalid")` before anything is set up; `address` is null; `plugins` is the file loader `plugins.replace`/`plugins.check` load their wire paths through, as for `listen`. What `listen` delegates its `fetch` transport to. */
export async function listenFetch(
  host: Omit<Host, "listen"> & { readonly kernel: Kernel },
  options: ListenOptions & { readonly transport: { readonly kind: "fetch" } },
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
    const digest = hex(await sha256(token));
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
      if (auth.kind === "token" && (await sameSecret(token, auth.token)))
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
    execution.kind === "admit-only" || kernel.execution.kind === "dispatch"
      ? null
      : kernel.execution.kind === "admit-only"
        ? driveInProcess(kernel, execution.coverage)
        : await host.execution.cover(execution.coverage);

  const disconnectClients = (): void => {
    for (const [key, entry] of cache) drop(key, entry);
    devices.clear();
    generation.abort(new SdkError("unavailable", "The host disconnected its clients."));
    generation = new AbortController();
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      closed = true;
      disconnectClients();
      await coverage?.close();
    })();

    return closing;
  };

  return { address: null, fetch, disconnectClients, close, [Symbol.asyncDispose]: close };
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

/** Returns the SHA-256 digest of a string's UTF-8 bytes through Web Crypto. */
async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares a presented secret with the expected one in constant time: both are digested with SHA-256 (so the length leaks nothing) and every byte pair is XOR-folded into one accumulator before it is read. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = left.length ^ right.length;

  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);

  return difference === 0;
}
