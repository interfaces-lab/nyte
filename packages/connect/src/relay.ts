/**
 * The relay: how phone HTTP requests reach a desktop with no inbound port.
 * The broker and the desktop import this entry; the phone never does.
 *
 * Each linked desktop holds one WebSocket to its environment's relay at
 * `BROKER_ROUTES.relay(id)`. The URL and headers carry no credential. The
 * desktop's first frame is `auth`, a `createProof` for `GET` on that exact
 * path with an empty body. The relay verifies it with the stored machine key,
 * spends its `jti`, requires an active environment, closes any earlier socket
 * for the environment with `RELAY_CLOSE.replaced` (ending all its channels),
 * and answers `ready`. Before `ready` the relay forwards nothing and accepts
 * only that one `auth` frame; anything else, or no proof within
 * `RELAY_AUTH_TIMEOUT_MS`, closes the socket.
 *
 * Phones call `<origin>/r/<id>/...`. The broker forwards only what
 * `publicRelayTarget` accepts, with the bearer `PUBLIC_RELAY_BEARER` asks
 * for: none for `discovery`, else one whose digest it holds for that
 * environment. The desktop still checks the digest and its current lease on
 * every request that carries one. Only the broker itself relays
 * `POST /_nyte/connect/enroll`.
 *
 * One HTTP exchange is one channel, and only the relay opens one. The
 * request side is `open`, any `data`, then `end`, even for a `GET`. The
 * response side is `head`, any `data`, then `end`; a status `hasNullBody`
 * names carries no `data`. Either side may `reset` a channel to end it at
 * once, for a phone that went away, an oversized body, or a desktop that
 * refuses to finish. Frames for a channel the receiver never opened or has
 * already ended are ignored, since resets race. Reusing a live channel id,
 * or opening more than `RELAY_CHANNEL_LIMIT` at once, closes the socket.
 *
 * Flow control is per channel and direction. Each sender starts with
 * `RELAY_WINDOW_BYTES` of credit; `data` spends its decoded byte count, and
 * the receiver returns `credit` only as its own reader consumes bytes.
 * Sending past the credit, or granting more than a window, closes the
 * socket. Neither side buffers more than a window per channel per
 * direction. The relay refuses a request body over `RELAY_BODY_LIMIT_BYTES`.
 *
 * When the socket closes, both sides end every channel: the relay errors
 * open phone responses and stops listing the desktop as online, and the
 * desktop aborts each relayed request. After a transient close it reconnects
 * with a fresh proof after a jittered backoff between `RELAY_RETRY_MIN_MS`
 * and `RELAY_RETRY_MAX_MS`. After `RELAY_CLOSE.replaced` it stops until the
 * user restarts it, so two instances never fight over one environment. After
 * `RELAY_CLOSE.revoked` it asks for a lease and forgets the link only when
 * the broker answers that with `revoked`.
 *
 * Cloudflare terminates TLS and this relay reads every frame: it sees bearer
 * tokens and request and response bodies in plain text. Nothing here is
 * end-to-end encrypted.
 */
import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";
import { Value } from "typebox/value";
import { base64Url, fromBase64Url } from "./encoding.ts";
import { CompactJws, DESKTOP_ROUTES, RELAY_PREFIX, UUID_PATTERN } from "./schemas.ts";

/** An unauthenticated socket that has not proven itself by then is closed. */
export const RELAY_AUTH_TIMEOUT_MS = 5_000;

/** Unauthenticated sockets one environment's relay holds at once; more are refused. */
export const RELAY_PENDING_LIMIT = 4;

/** Channels open at once on one socket. A phone request past it answers `closed`. */
export const RELAY_CHANNEL_LIMIT = 32;

/** Most decoded bytes in one `data` frame. */
export const RELAY_CHUNK_BYTES = 32_768;

/** Credit each sender starts with, per channel and direction. */
export const RELAY_WINDOW_BYTES = 262_144;

/** Largest request body relayed, equal to the host listener's default limit. */
export const RELAY_BODY_LIMIT_BYTES = 8_388_608;

/** Longest frame text either side parses. */
export const RELAY_FRAME_CHARS = 65_536;

/** The desktop sends `RELAY_PING` this often and reconnects when no pong arrives within the next interval. */
export const RELAY_PING_INTERVAL_MS = 20_000;

export const RELAY_RETRY_MIN_MS = 1_000;

export const RELAY_RETRY_MAX_MS = 60_000;

/** Exact frame texts, so the relay can answer pings with `setWebSocketAutoResponse` without waking. */
export const RELAY_PING = '{"t":"ping"}';

export const RELAY_PONG = '{"t":"pong"}';

/** Close codes the relay sends. Any other close is transient: back off and reconnect. */
export const RELAY_CLOSE = {
  /** A frame broke this contract. */
  invalid: 4400,
  /** No valid proof in time, or a proof that did not verify or was spent. */
  unauthorized: 4401,
  /** A newer authenticated socket took over this environment. Do not reconnect on your own. */
  replaced: 4409,
  /** The environment looks unlinked or removed. Confirm with a lease request before forgetting the link. */
  revoked: 4410,
} as const;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

/** 128 random bits, unpadded base64url: `randomId()` from `@nyte-ai/connect/signing`. */
export const ChannelId = Type.String({ pattern: "^[A-Za-z0-9_-]{22}$" });

const Chunk = Type.String({
  minLength: 2,
  maxLength: Math.ceil((RELAY_CHUNK_BYTES * 4) / 3),
  pattern: "^[A-Za-z0-9_-]+$",
});

const Credit = Type.Integer({ minimum: 1, maximum: RELAY_WINDOW_BYTES });

export const RelayMethod = Type.Enum(["GET", "POST", "DELETE"]);

export type RelayMethod = Static<typeof RelayMethod>;

/**
 * The operations a phone may call, each at exactly `POST /<name>`: every row
 * of protocol's declarations table. The names are spelled out so the Worker
 * does not bundle protocol; a connect test holds them equal to the table.
 */
export const RELAY_OPERATIONS = [
  "connection.watch",
  "connection.blob",
  "models.list",
  "models.accounts",
  "models.selectAccount",
  "models.usage",
  "models.refresh",
  "models.setDefault",
  "models.verify",
  "models.login",
  "models.logout",
  "login.steps",
  "login.answer",
  "settings.apply",
  "workspaces.list",
  "workspaces.inspect",
  "workspaces.add",
  "workspaces.forget",
  "sessions.watch",
  "sessions.create",
  "sessions.list",
  "session.info",
  "session.update",
  "session.remove",
  "session.stop",
  "session.command",
  "head.send",
  "head.configure",
  "head.view",
  "head.watch",
  "head.history",
  "head.tree",
  "head.move",
  "head.compact",
  "heads.create",
  "heads.merge",
  "heads.remove",
  "run.stop",
  "run.settled",
  "receipt.status",
  "receipt.settled",
  "receipt.stop",
  "receipt.landed",
  "parts.create",
  "part.update",
  "part.act",
  "part.answer",
  "part.close",
  "workspace.info",
  "workspace.watch",
  "mcp.watch",
  "mcp.reconnect",
  "mcp.setEnabled",
  "mcp.login",
  "mcp.logout",
  "mcp.add",
  "mcp.remove",
  "workspace.update",
  "workspace.reload",
  "workspace.changes",
  "workspace.patches",
  "workspace.files",
  "workspace.git",
  "workspace.browser",
  "jobs.start",
  "jobs.recover",
  "jobs.list",
  "jobs.watch",
  "job.write",
  "job.output",
  "job.resize",
  "job.idle",
  "job.stop",
  "job.settled",
  "files.read",
  "files.bytes",
  "files.stat",
  "files.write",
  "files.remove",
  "files.batch",
  "files.format",
  "files.scan",
  "files.find",
  "files.search",
  "files.watch",
  "files.upload",
  "git.status",
  "git.watch",
  "git.changes",
  "git.watchChanges",
  "git.patches",
  "git.contents",
  "git.log",
  "git.refs",
  "git.blame",
  "git.stage",
  "git.unstage",
  "git.discard",
  "git.commit",
  "git.branch",
  "git.push",
  "browser.open",
  "browser.adopt",
  "browser.list",
  "browser.watch",
  "page.view",
  "page.watch",
  "page.snapshot",
  "page.navigate",
  "page.back",
  "page.forward",
  "page.reload",
  "page.stopLoading",
  "page.click",
  "page.type",
  "page.press",
  "page.scroll",
  "page.wait",
  "page.console",
  "page.capture",
  "page.evaluate",
  "page.close",
  "plugins.replace",
  "plugins.check",
  "principals.list",
  "principals.pair",
  "principals.revoke",
] as const;

/** The host's discovery routes, each a `GET`; only `identity` takes a query, its `?nonce=`. */
export const RELAY_DISCOVERY = {
  identity: "/.nyte/identity",
  describe: "/.nyte/describe",
} as const;

export const RELAY_STREAMS = {
  channel: "/.nyte/streams",
  cancel: "/.nyte/streams/cancel",
} as const;

const literal = (text: string) => text.replaceAll(".", "\\.");
const OPERATION = RELAY_OPERATIONS.map(literal).join("|");
const QUERY = "\\?(?:[A-Za-z0-9*._~+=&-]|%[0-9A-Fa-f]{2})*";

/**
 * The path and query a relayed request names: `/<operation>` with no query,
 * `RELAY_DISCOVERY.identity` with an optional query, `RELAY_DISCOVERY.describe`,
 * or one of the desktop's own routes. A query uses only the characters
 * `URLSearchParams` writes plus well-formed percent escapes.
 */
export const RelayPath = Type.String({
  maxLength: 2048,
  pattern: `^(?:/(?:${OPERATION})|${literal(RELAY_DISCOVERY.identity)}(?:${QUERY})?|${literal(RELAY_DISCOVERY.describe)}|${literal(RELAY_STREAMS.channel)}|${literal(RELAY_STREAMS.cancel)}|${DESKTOP_ROUTES.device}|${DESKTOP_ROUTES.enroll})$`,
});

const HEADER_VALUE = "^[\\x20-\\x7e]*$";

const HeaderValue = Type.String({ maxLength: 8192, pattern: HEADER_VALUE });

/** The request headers a desktop receives. Nothing else is forwarded: no cookie, host, origin, or forwarding header. */
export const RelayRequestHeaders = strict({
  authorization: Type.Optional(HeaderValue),
  "content-type": Type.Optional(HeaderValue),
  accept: Type.Optional(HeaderValue),
  "last-event-id": Type.Optional(HeaderValue),
  "x-nyte-input": Type.Optional(HeaderValue),
  "x-nyte-channel": Type.Optional(HeaderValue),
  "x-nyte-stream": Type.Optional(HeaderValue),
});

export type RelayRequestHeaders = Static<typeof RelayRequestHeaders>;

/** The response headers a phone receives. No length, encoding, cookie, location, or CORS header passes. */
export const RelayResponseHeaders = strict({
  "content-type": Type.Optional(HeaderValue),
  "cache-control": Type.Optional(HeaderValue),
  "x-nyte-host": Type.Optional(HeaderValue),
  "x-nyte-credential": Type.Optional(HeaderValue),
  "x-nyte-version": Type.Optional(HeaderValue),
  "x-nyte-mime": Type.Optional(HeaderValue),
  "x-nyte-channel": Type.Optional(HeaderValue),
});

export type RelayResponseHeaders = Static<typeof RelayResponseHeaders>;

/** Success or failure only: no informational or redirect status can be relayed. */
export const RelayStatus = Type.Union([
  Type.Integer({ minimum: 200, maximum: 299 }),
  Type.Integer({ minimum: 400, maximum: 599 }),
]);

const ChannelData = strict({ t: Type.Literal("data"), ch: ChannelId, data: Chunk });
const ChannelEnd = strict({ t: Type.Literal("end"), ch: ChannelId });
const ChannelCredit = strict({ t: Type.Literal("credit"), ch: ChannelId, bytes: Credit });
const ChannelReset = strict({ t: Type.Literal("reset"), ch: ChannelId });

/** What the relay sends a desktop. */
export const RelayFrame = Type.Union([
  strict({ t: Type.Literal("ready") }),
  strict({ t: Type.Literal("pong") }),
  strict({
    t: Type.Literal("open"),
    ch: ChannelId,
    method: RelayMethod,
    path: RelayPath,
    headers: RelayRequestHeaders,
  }),
  ChannelData,
  ChannelEnd,
  ChannelCredit,
  ChannelReset,
]);

export type RelayFrame = Static<typeof RelayFrame>;

/** What a desktop sends the relay. */
export const DesktopFrame = Type.Union([
  strict({ t: Type.Literal("auth"), proof: CompactJws }),
  strict({ t: Type.Literal("ping") }),
  strict({
    t: Type.Literal("head"),
    ch: ChannelId,
    status: RelayStatus,
    headers: RelayResponseHeaders,
  }),
  ChannelData,
  ChannelEnd,
  ChannelCredit,
  ChannelReset,
]);

export type DesktopFrame = Static<typeof DesktopFrame>;

function parseFrame<S extends TSchema>(schema: S, message: unknown): Static<S> | undefined {
  if (typeof message !== "string" || message.length > RELAY_FRAME_CHARS) return undefined;
  let frame: unknown;

  try {
    frame = JSON.parse(message);
  } catch {
    return undefined;
  }

  return Value.Check(schema, frame) ? frame : undefined;
}

/** A WebSocket message from the relay, or undefined when it breaks the contract (binary included). */
export function parseRelayFrame(message: unknown): RelayFrame | undefined {
  return parseFrame(RelayFrame, message);
}

/** A WebSocket message from a desktop, or undefined when it breaks the contract (binary included). */
export function parseDesktopFrame(message: unknown): DesktopFrame | undefined {
  return parseFrame(DesktopFrame, message);
}

/** `data` values for `bytes`, each at most `RELAY_CHUNK_BYTES`. Empty bytes give none. */
export function encodeChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += RELAY_CHUNK_BYTES)
    chunks.push(base64Url(bytes.subarray(offset, offset + RELAY_CHUNK_BYTES)));

  return chunks;
}

/** The bytes of a `data` value, or undefined when it is not one. */
export function decodeChunk(data: string): Uint8Array | undefined {
  const bytes = fromBase64Url(data);

  return bytes === undefined || bytes.byteLength === 0 || bytes.byteLength > RELAY_CHUNK_BYTES
    ? undefined
    : bytes;
}

/** Statuses whose response has no body: `head` is followed by `end` alone. */
export function hasNullBody(status: number): boolean {
  return status === 204 || status === 205;
}

/** The names `relayRequestHeaders` forwards, lowercase. */
export const RELAY_REQUEST_HEADER_NAMES = [
  "authorization",
  "content-type",
  "accept",
  "last-event-id",
  "x-nyte-input",
  "x-nyte-channel",
  "x-nyte-stream",
] as const;

/** The names `relayResponseHeaders` passes back, lowercase. */
export const RELAY_RESPONSE_HEADER_NAMES = [
  "content-type",
  "cache-control",
  "x-nyte-host",
  "x-nyte-credential",
  "x-nyte-version",
  "x-nyte-mime",
  "x-nyte-channel",
] as const;
const HEADER_TEXT = new RegExp(HEADER_VALUE, "u");

function pick<const N extends string>(
  names: readonly N[],
  headers: Headers,
): Partial<Record<N, string>> {
  const picked: Partial<Record<N, string>> = {};

  for (const name of names) {
    const value = headers.get(name);

    if (value !== null && value.length <= 8192 && HEADER_TEXT.test(value)) picked[name] = value;
  }

  return picked;
}

/** The allowlisted request headers of an incoming phone request. */
export function relayRequestHeaders(headers: Headers): RelayRequestHeaders {
  return pick(RELAY_REQUEST_HEADER_NAMES, headers);
}

/** The allowlisted response headers of a desktop answer. */
export function relayResponseHeaders(headers: Headers): RelayResponseHeaders {
  return pick(RELAY_RESPONSE_HEADER_NAMES, headers);
}

/**
 * What a public relay URL may reach. `api` is an operation and takes `POST`;
 * `discovery` is the host's identity or description and takes `GET`;
 * `release` is the phone dropping its own credential and takes `DELETE`.
 */
export interface PublicRelayTarget {
  readonly kind: "api" | "discovery" | "release";
  readonly environmentId: string;
  /** Path and query as the desktop receives them. */
  readonly path: string;
}

export const PUBLIC_RELAY_METHODS = {
  api: ["POST"],
  discovery: ["GET"],
  release: ["DELETE"],
} as const satisfies Record<PublicRelayTarget["kind"], readonly RelayMethod[]>;

/**
 * The device a public relay request's bearer must belong to, by target kind:
 * an active one for `api`, a reserved or active one for `release`, and none
 * for `discovery`. The broker forwards `GET /.nyte/identity` and
 * `/.nyte/describe` without reading a bearer, as the host answers them
 * unauthenticated, so `verifyIdentity` can check a host before it holds a
 * credential for it (§51g).
 */
export const PUBLIC_RELAY_BEARER = {
  api: "active",
  discovery: "none",
  release: "reserved-or-active",
} as const satisfies Record<PublicRelayTarget["kind"], "none" | "active" | "reserved-or-active">;

const PUBLIC_URL = new RegExp(`^${RELAY_PREFIX}(${UUID_PATTERN.slice(1, -1)})(/.*)$`, "u");

/**
 * The desktop target a phone's `<origin>/r/<id>/...` URL names, or undefined
 * when the relay must not forward it: anything `RelayPath` refuses, a query
 * on `DESKTOP_ROUTES.device`, and always `DESKTOP_ROUTES.enroll`.
 */
export function publicRelayTarget(url: URL): PublicRelayTarget | undefined {
  const match = PUBLIC_URL.exec(url.pathname);

  if (match === null || url.hash !== "") return undefined;
  const [, environmentId = "", route = ""] = match;
  const path = `${route}${url.search}`;

  if (!Value.Check(RelayPath, path) || route === DESKTOP_ROUTES.enroll) return undefined;

  if (route === DESKTOP_ROUTES.device)
    return url.search === "" ? { kind: "release", environmentId, path } : undefined;

  return route === RELAY_DISCOVERY.identity || route === RELAY_DISCOVERY.describe
    ? { kind: "discovery", environmentId, path }
    : { kind: "api", environmentId, path };
}

/**
 * Refusals the public relay answers itself, each as the host's wire error
 * (`{ code, message, hostId, issues, correlation }`) so a protocol client
 * rethrows it as the `SdkError` it names. `code` is that wire code; only 401
 * and 403 refuse a credential.
 */
export const RELAY_REFUSALS = {
  /** No bearer where `PUBLIC_RELAY_BEARER` asks for one, or one the broker holds for no usable device of this environment. */
  unauthorized: {
    status: 401,
    code: "unauthenticated",
    message: "The device credential was refused",
  },
  /** An unlisted browser `Origin`, or a release for a revoked device. */
  forbidden: { status: 403, code: "denied", message: "Refused" },
  not_found: { status: 404, code: "unknown", message: "Not found" },
  method_not_allowed: { status: 405, code: "invalid", message: "Method not allowed" },
  payload_too_large: { status: 413, code: "invalid", message: "The request body is too large" },
  /** The desktop is not connected, is at its channel limit, or ended the exchange before answering. */
  closed: { status: 503, code: "unavailable", message: "This Mac is not connected" },
  internal: { status: 500, code: "internal", message: "The relay failed" },
} as const;

export type RelayRefusalCode = keyof typeof RELAY_REFUSALS;

export function relayRefusal(refusal: RelayRefusalCode): Response {
  const { status, code, message } = RELAY_REFUSALS[refusal];

  return new Response(
    JSON.stringify({ code, message, hostId: null, issues: [], correlation: null }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
