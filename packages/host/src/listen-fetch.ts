import { ORIGIN_PATTERN, SdkError, TICKET_PATH } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type { Authority, Disposer, Owned, PrincipalId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { TOKEN, TOKEN_AUTHORITY } from "@nyte-ai/core/server";
import type { Connection, ListenOptions, Listener } from "@nyte-ai/core";
import type { ServedHost, Verdict } from "@nyte-ai/core/server";
import {
  HOST_HEADER,
  OPERATIONS_HEADER,
  asSdkError,
  encodeError,
  errorStatus,
  operationsDigest,
} from "@nyte-ai/protocol";
import type { McpService } from "./mcp-server/server.ts";
import { MCP_TOKEN_PREFIX } from "./mcp-server/token.ts";
import { allowsOrigin, createHandler } from "./serve/handler.ts";
import type { HandlerOptions } from "./serve/handler.ts";
import type { SocketPeer } from "./serve/socket.ts";
import type { TailnetControl } from "./tailnet.ts";

type Cached = {
  readonly connection: Connection;
  readonly principal: PrincipalId;
  dispose: Disposer;
};

type Flight = {
  readonly request: Request;
  readonly controller: AbortController;
  principal: PrincipalId | null;
};

type Device = {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly token: string;
};

type Identity = Device & { readonly headers?: Readonly<Record<string, string>> };

export type SocketListener = Listener & { admit(request: Request): Promise<SocketPeer> };

const TICKET_LIFETIME = 30_000;

const encoder = new TextEncoder();

/** Serves a composed host as a bare fetch handler with no socket and no `node:*` import, so a Worker can serve it (§41j): `before`, the unauthenticated identity and describe routes, then `createHandler` over one cached connection per principal and authority, every response carrying `X-Nyte-Host` (§43a, §43j). A request authenticates by a pairing code, then the listener token (compared in constant time over SHA-256 digests, granting `auth.authority`) or a device token remembered until a commit from another process moves the host's principals, then `authorize` under `custom`; a revoke aborts that principal's open requests and streams. A `token` shorter than 16 characters throws `SdkError("invalid")`; `execution` (default: run covering all) drives covered sessions in process on an `admit-only` host, covers their leases otherwise and takes nothing on a `dispatch` host (§42v); `close()` disconnects the clients and releases the execution once, after which every request answers `unavailable`. */
export async function listenFetch(
  host: ServedHost,
  options: ListenOptions & {
    readonly transport: { readonly kind: "fetch" };
    readonly local?: boolean;
    readonly tailnet?: TailnetControl;
    readonly mcpServer?: McpService;
  },
): Promise<SocketListener> {
  const { auth } = options;

  if (auth.kind === "token" && auth.token.length < 16)
    throw new SdkError("invalid", "A listener token needs at least 16 characters.");
  const origin = new RegExp(ORIGIN_PATTERN);
  const invalid = options.origins?.find((candidate) => !origin.test(candidate));

  if (invalid !== undefined)
    throw new SdkError(
      "invalid",
      `${invalid} isn't a listener origin. Use https://example.com, https://*.example.com or http://localhost:<port>.`,
    );
  const { server } = host;
  const operations = await operationsDigest();
  const cache = new Map<string, Cached>();
  const devices = new Map<string, Device>();
  const streams = new Map<PrincipalId, Set<Flight>>();
  const flights = new WeakMap<Request, Flight>();
  const tickets = new Map<string, { readonly identity: Identity; readonly expires: number }>();
  let generation = new AbortController();
  let closing: Promise<void> | null = null;
  let principalsRevision: string | null = null;
  const rechecks = serial();

  const drop = (key: string, entry: Cached, reason: SdkError): void => {
    if (cache.get(key) === entry) cache.delete(key);
    entry.dispose();

    for (const [digest, device] of devices)
      if (device.principal === entry.principal) devices.delete(digest);
    const open = streams.get(entry.principal);
    streams.delete(entry.principal);

    for (const flight of open ?? []) flight.controller.abort(reason);
    void entry.connection.close();
  };

  const land = (flight: Flight): void => {
    for (const [principal, open] of streams)
      if (open.delete(flight) && open.size === 0) streams.delete(principal);
  };

  const connectionFor = (
    flight: Flight,
    principal: PrincipalId,
    authority: ReadonlySet<Authority>,
    token: string,
  ): Connection => {
    const key = JSON.stringify([principal, [...authority].sort()]);
    const entry = cache.get(key) ?? admit(key, principal, authority, token);
    flight.principal = principal;
    const open = streams.get(principal) ?? new Set<Flight>();
    open.add(flight);
    streams.set(principal, open);

    return entry.connection;
  };

  const admit = (
    key: string,
    principal: PrincipalId,
    authority: ReadonlySet<Authority>,
    token: string,
  ): Cached => {
    const connection = server.connect({
      principal,
      authority,
      credential: { kind: "token", token },
      origin: null,
    });

    const entry: Cached = { connection, principal, dispose: () => undefined };
    const admitted = server.connections.register(principal, () =>
      drop(key, entry, new SdkError("unauthenticated", "The principal was revoked.")),
    );

    if (admitted.kind === "revoked")
      throw new SdkError("unauthenticated", "The principal was revoked.");
    entry.dispose = admitted.dispose;
    cache.set(key, entry);

    return entry;
  };

  const reread = async (token: string, digest: string): Promise<Device | null> => {
    const found = await server.authenticate(token);

    if (found === null) {
      const known = devices.get(digest);
      devices.delete(digest);

      if (known !== undefined) server.connections.revoke(known.principal);

      return null;
    }

    return { ...found, token };
  };

  const findDevice = async (
    token: string,
  ): Promise<{ readonly digest: string; readonly device: Device } | null> => {
    const digest = hex(await sha256(token));
    const device = devices.get(digest) ?? (await reread(token, digest));

    return device === null ? null : { digest, device };
  };

  const recheck = async (): Promise<void> => {
    if (devices.size === 0) return;
    const revision = await server.principalsRevision();

    if (revision === principalsRevision) return;
    principalsRevision = revision;

    await Promise.all([...devices].map(([digest, known]) => reread(known.token, digest)));
  };

  const externalCommit = (): void => {
    void rechecks
      .run(recheck)
      .catch((error) => dev("listen", "device re-check failed", { error: String(error) }));
  };

  const unwatchCommits = server.onExternalCommit(externalCommit);

  const isListenerToken: (token: string) => Promise<boolean> =
    auth.kind === "token" ? (token) => sameSecret(token, auth.token) : async () => false;

  const listenerAuthority =
    auth.kind === "token" ? (auth.authority ?? TOKEN_AUTHORITY) : TOKEN_AUTHORITY;

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

  const identify = async (request: Request): Promise<Identity> => {
    const header = request.headers.get("Authorization") ?? "";
    const pairing = /^Pairing\s+(\S+)\s*$/i.exec(header)?.[1];

    if (pairing !== undefined) {
      const redeemed = await server.redeem(pairing);

      if (redeemed === null)
        throw new SdkError("unauthenticated", "The pairing code is unknown or has expired.");
      const device = {
        principal: redeemed.principal,
        authority: redeemed.authority,
        token: redeemed.token,
      };
      devices.set(hex(await sha256(redeemed.token)), device);

      return { ...device, headers: { "X-Nyte-Credential": redeemed.token } };
    }

    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];

    if (token?.startsWith(MCP_TOKEN_PREFIX) === true)
      throw new SdkError("denied", "An MCP token answers only at /mcp.");

    if (token !== undefined) {
      if (await isListenerToken(token))
        return { principal: TOKEN, authority: listenerAuthority, token };
      const remembered = await findDevice(token);

      if (remembered !== null) {
        devices.set(remembered.digest, remembered.device);

        return remembered.device;
      }
    }

    const verdict = await fallback(request, token);

    return { principal: verdict.principal, authority: verdict.authority, token: "" };
  };

  const authenticate = async (
    request: Request,
    flight: Flight,
  ): ReturnType<HandlerOptions["connection"]> => {
    const identity = await identify(request);

    return {
      connection: connectionFor(flight, identity.principal, identity.authority, identity.token),
      authority: identity.authority,
      headers: identity.headers,
    };
  };

  const allowsCaller = (request: Request): boolean => {
    const origin = request.headers.get("Origin");

    return (
      origin === null ||
      origin === new URL(request.url).origin ||
      allowsOrigin(options.origins, origin)
    );
  };

  const issueTicket = async (request: Request): Promise<Response> => {
    if (!allowsCaller(request))
      return failure(new SdkError("denied", "This origin may not call the host."), {});
    const identity = await identify(request);
    const now = Date.now();

    for (const [key, held] of tickets) if (held.expires <= now) tickets.delete(key);
    const ticket = crypto.randomUUID();
    const expiresAt = now + TICKET_LIFETIME;
    tickets.set(ticket, { identity, expires: expiresAt });

    return json({ ticket, expiresAt }, { ...cors(request), ...identity.headers });
  };

  const redeemTicket = (ticket: string): Identity => {
    const held = tickets.get(ticket);
    tickets.delete(ticket);

    if (held === undefined || held.expires <= Date.now())
      throw new SdkError("unauthenticated", "The ticket is unknown, used or expired.");

    return held.identity;
  };

  const admitSocket = async (request: Request): Promise<SocketPeer> => {
    if (closing !== null) throw new SdkError("unavailable", "This listener is closed.");

    if (!allowsCaller(request)) throw new SdkError("denied", "This origin may not call the host.");
    const ticket = new URL(request.url).searchParams.get("ticket");
    const identity = ticket === null ? await identify(request) : redeemTicket(ticket);
    const controller = new AbortController();
    const flight: Flight = { request, controller, principal: null };

    const connection = connectionFor(
      flight,
      identity.principal,
      identity.authority,
      identity.token,
    );

    return {
      connection,
      principal: identity.principal,
      authority: identity.authority,
      local: options.local === true,
      server,
      tailnet: options.tailnet,
      mcpServer: options.mcpServer,
      signal: AbortSignal.any([generation.signal, controller.signal]),
      leave: () => land(flight),
    };
  };

  const handler = createHandler({
    server,
    local: options.local === true,
    tailnet: options.tailnet,
    mcpServer: options.mcpServer,
    origins: options.origins,
    maxBodyBytes: options.maxBodyBytes,
    connection: (request) => {
      const flight = flights.get(request);
      if (flight === undefined) throw new Error("The listener did not register this request.");
      return authenticate(request, flight);
    },
  });

  const cors = (request: Request): Readonly<Record<string, string>> => {
    const origin = request.headers.get("Origin");

    return origin !== null && allowsOrigin(options.origins, origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Expose-Headers": `${HOST_HEADER}, ${OPERATIONS_HEADER}`,
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
        { ...(await options.identity.sign(nonce)), hostId: server.hostId },
        cors(request),
      );
    }

    if (request.method === "POST" && url.pathname === TICKET_PATH) return issueTicket(request);

    if (request.method === "GET" && url.pathname === "/.nyte/describe") {
      if (options.describe === undefined)
        return failure(new SdkError("unknown", "This host describes nothing."), cors(request));

      return json(await options.describe(), cors(request));
    }

    const mcp = await options.mcpServer?.serve(request, options.origins ?? []);

    if (mcp !== undefined && mcp !== null) return mcp;

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

    return withHost(response, server.hostId, operations);
  };

  const execution = options.execution ?? { kind: "run", coverage: { kind: "all" } };

  const coverage: Owned | null =
    execution.kind === "admit-only" || server.execution.kind === "dispatch"
      ? null
      : server.execution.kind === "admit-only"
        ? server.drive(execution.coverage)
        : await host.execution.cover(execution.coverage);

  const disconnectClients = (): void => {
    for (const [key, entry] of cache)
      drop(key, entry, new SdkError("unavailable", "The host disconnected its clients."));
    devices.clear();
    generation.abort(new SdkError("unavailable", "The host disconnected its clients."));
    generation = new AbortController();
  };

  const close = (): Promise<void> => {
    closing ??= (async () => {
      unwatchCommits();
      disconnectClients();
      await coverage?.close();
    })();

    return closing;
  };

  return {
    address: null,
    fetch,
    admit: admitSocket,
    disconnectClients,
    close,
    [Symbol.asyncDispose]: close,
  };
}

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

function withHost(response: Response, hostId: string, operations: string): Response {
  const headers = new Headers(response.headers);
  headers.set(HOST_HEADER, hostId);
  headers.set(OPERATIONS_HEADER, operations);

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

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = left.length ^ right.length;

  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);

  return difference === 0;
}
