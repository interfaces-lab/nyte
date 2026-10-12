import type { Authority, Disposer, Owned, PrincipalId } from "@nyte-ai/schema";
import {
  SdkError,
  TOKEN,
  TOKEN_AUTHORITY,
  authenticateToken,
  createConnection,
  dev,
  driveInProcess,
  redeemPairing,
} from "@nyte-ai/core";
import type { Connection, Host, Kernel, ListenOptions, Listener } from "@nyte-ai/core";
import {
  HOST_HEADER,
  asSdkError,
  createHandler,
  encodeError,
  errorStatus,
} from "@nyte-ai/protocol";
import type { HandlerOptions } from "@nyte-ai/protocol";

/** Returns one cached connection: what it serves and how it leaves the cache. */
type Cached = {
  readonly connection: Connection;
  readonly principal: PrincipalId;
  dispose: Disposer;
};

/** Returns one request on its way through the handler: the request as forwarded, the controller tied into its signal and, for the dev line, the principal it authenticated as. The flight holds the request because undici's `Request` follows the signal it was given only while the request object lives. */
type Flight = {
  readonly request: Request;
  readonly controller: AbortController;
  principal: PrincipalId | null;
};

/** Returns who a request is when no token of this listener names it: the principal and authority `authorize` gave. */
type Verdict = { readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> };

/** Returns a device token remembered by digest: its principal and authority until `expiresAt`. */
type Device = {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly expiresAt: number;
};

const DEVICE_TTL_MS = 60_000;

const encoder = new TextEncoder();

/** Serves a composed host as a bare fetch handler with no socket and no `node:*` import, so a Worker can serve it (§41j): `before`, the unauthenticated identity and describe routes, then protocol's `createHandler` over one cached connection per principal and authority, every response carrying `X-Nyte-Host` (§43a, §43j). A request authenticates by a pairing code, then the listener token (compared in constant time over SHA-256 digests) or a device token remembered for 60 s, then `authorize` under `custom`; a revoke aborts that principal's open requests and streams. A `token` shorter than 16 characters throws `SdkError("invalid")`; `execution` (default: run covering all) drives covered sessions in process on an `admit-only` kernel, covers their leases otherwise and takes nothing on a `dispatch` kernel (§42v); `close()` disconnects the clients and releases the execution once, after which every request answers `unavailable`. */
export async function listenFetch(
  host: Omit<Host, "listen"> & { readonly kernel: Kernel },
  options: ListenOptions & { readonly transport: { readonly kind: "fetch" } },
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
  let closing: Promise<void> | null = null;

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
    for (const [principal, open] of streams)
      if (open.delete(flight) && open.size === 0) streams.delete(principal);
  };

  const connectionFor = (
    request: Request,
    principal: PrincipalId,
    authority: ReadonlySet<Authority>,
    token: string,
  ): Connection => {
    const key = JSON.stringify([principal, [...authority].sort()]);
    const entry = cache.get(key) ?? admit(key, principal, authority, token);
    const flight = flights.get(request);

    if (flight !== undefined) {
      flight.principal = principal;
      const open = streams.get(principal) ?? new Set<Flight>();
      open.add(flight);
      streams.set(principal, open);
    }

    return entry.connection;
  };

  const admit = (
    key: string,
    principal: PrincipalId,
    authority: ReadonlySet<Authority>,
    token: string,
  ): Cached => {
    const connection = createConnection(kernel, {
      principal,
      authority,
      credential: { kind: "token", token },
      origin: null,
    });

    const entry: Cached = { connection, principal, dispose: () => undefined };
    const admitted = kernel.connections.register(principal, () => drop(key, entry));

    if (admitted.kind === "revoked")
      throw new SdkError("unauthenticated", "The principal was revoked.");
    entry.dispose = admitted.dispose;
    cache.set(key, entry);

    return entry;
  };

  const deviceOf = async (
    token: string,
  ): Promise<{ readonly digest: string; readonly device: Device } | null> => {
    const digest = hex(await sha256(token));
    const known = devices.get(digest);

    if (known !== undefined && known.expiresAt > Date.now()) return { digest, device: known };
    const found = await authenticateToken(kernel, token);

    if (found === null) {
      devices.delete(digest);

      if (known !== undefined) kernel.connections.revoke(known.principal);

      return null;
    }

    return { digest, device: { ...found, expiresAt: Date.now() + DEVICE_TTL_MS } };
  };

  const isListenerToken: (token: string) => Promise<boolean> =
    auth.kind === "token" ? (token) => sameSecret(token, auth.token) : async () => false;

  const fallback: (request: Request, token: string | undefined) => Promise<Verdict> =
    auth.kind === "custom"
      ? async (request) => {
          const verdict = await auth.authorize(request);

          if ("deny" in verdict)
            throw verdict.deny === "forbidden"
              ? new SdkError("denied", "This principal may not call the host.")
              : new SdkError("unauthenticated", "The request is not authorized.");

          return verdict;
        }
      : async (_request, token) => {
          throw new SdkError(
            "unauthenticated",
            token === undefined
              ? "Send Authorization: Bearer <token>."
              : "The token is not accepted.",
          );
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
      if (await isListenerToken(token))
        return {
          connection: connectionFor(request, TOKEN, TOKEN_AUTHORITY, token),
          authority: TOKEN_AUTHORITY,
        };
      const remembered = await deviceOf(token);

      if (remembered !== null) {
        const { digest, device } = remembered;
        const connection = connectionFor(request, device.principal, device.authority, token);
        devices.set(digest, device);

        return { connection, authority: device.authority };
      }
    }

    const verdict = await fallback(request, token);

    return {
      connection: connectionFor(request, verdict.principal, verdict.authority, ""),
      authority: verdict.authority,
    };
  };

  const handler = createHandler({
    kernel,
    origins: options.origins,
    maxBodyBytes: options.maxBodyBytes,
    connection: authenticate,
  });

  const cors = (request: Request): Readonly<Record<string, string>> => {
    const origin = request.headers.get("Origin");

    return origin !== null && (options.origins ?? []).includes(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Expose-Headers": HOST_HEADER,
          Vary: "Origin",
        }
      : {};
  };

  const serve = async (
    request: Request,
    trace: { principal: PrincipalId | null },
  ): Promise<Response> => {
    if (closing !== null)
      return failure(new SdkError("unavailable", "This listener is closed."), {});
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

      return json(
        { ...(await options.identity.sign(nonce)), hostId: kernel.hostId },
        cors(request),
      );
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
    trace.principal = flight.principal;

    return landing(response, () => land(flight));
  };

  const fetch = async (request: Request): Promise<Response> => {
    const started = Date.now();
    const trace: { principal: PrincipalId | null } = { principal: null };

    const response = await serve(request, trace).catch((error: unknown) =>
      failure(asSdkError(error), cors(request)),
    );

    dev("listen", "request", {
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      principal:
        trace.principal === null ? "none" : trace.principal === TOKEN ? "token" : "principal",
      ms: Date.now() - started,
    });

    return withHost(response, kernel.hostId);
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

  const close = (): Promise<void> => {
    closing ??= (async () => {
      disconnectClients();
      await coverage?.close();
    })();

    return closing;
  };

  return { address: null, fetch, disconnectClients, close, [Symbol.asyncDispose]: close };
}

/** Returns the response with `done` called once when its body ends, errors or is cancelled, or at once when it has none. The transformer is a plain object rather than a literal argument because the DOM lib's `Transformer` has no `cancel` yet, so this file also compiles in a DOM program. */
function landing(response: Response, done: () => void): Response {
  if (response.body === null) {
    done();

    return response;
  }

  const settles = { flush: done, cancel: done };

  return new Response(
    response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(settles)),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}

/** Returns the response with `X-Nyte-Host` set to the host's id, rebuilt around the same body because a `Response` from elsewhere may hold immutable headers. */
function withHost(response: Response, hostId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(HOST_HEADER, hostId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
