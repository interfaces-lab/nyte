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
 * Phones call `<origin>/r/<id>/...` with their bearer token. The broker
 * forwards only what `publicRelayTarget` accepts, and only for a bearer whose
 * digest it holds for that environment: an active device for `api`, a
 * reserved or active one for `release`. The desktop still checks the digest
 * and its current lease on every request. Only the broker itself relays
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

/** Largest request body relayed, equal to the Nyte server's own limit. */
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

const SEGMENT = "/(?!\\.\\.?(?:[/?]|$))[A-Za-z0-9._~-]+";
const QUERY = "\\?(?:[A-Za-z0-9*._~+=&-]|%[0-9A-Fa-f]{2})*";

/**
 * The path and query a relayed request names. An API path is `/v1` and one
 * or more unreserved segments, none of them `.` or `..`, with no percent
 * escape, backslash, or empty segment. Its query uses only the characters
 * `URLSearchParams` writes plus well-formed percent escapes; the schema does
 * not require that exact serialization. The desktop's own routes take no query.
 */
export const RelayPath = Type.String({
  maxLength: 2048,
  pattern: `^(?:/v1(?:${SEGMENT})+(?:${QUERY})?|${DESKTOP_ROUTES.device}|${DESKTOP_ROUTES.enroll})$`,
});

const HEADER_VALUE = "^[\\x20-\\x7e]*$";

const HeaderValue = Type.String({ maxLength: 8192, pattern: HEADER_VALUE });

/** The request headers a desktop receives. Nothing else is forwarded: no cookie, host, origin, or forwarding header. */
export const RelayRequestHeaders = strict({
  authorization: Type.Optional(HeaderValue),
  "content-type": Type.Optional(HeaderValue),
  accept: Type.Optional(HeaderValue),
});

export type RelayRequestHeaders = Static<typeof RelayRequestHeaders>;

/** The response headers a phone receives. No length, encoding, cookie, location, or CORS header passes. */
export const RelayResponseHeaders = strict({
  "content-type": Type.Optional(HeaderValue),
  "cache-control": Type.Optional(HeaderValue),
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

const REQUEST_HEADER_NAMES = ["authorization", "content-type", "accept"] as const;
const RESPONSE_HEADER_NAMES = ["content-type", "cache-control"] as const;
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
  return pick(REQUEST_HEADER_NAMES, headers);
}

/** The allowlisted response headers of a desktop answer. */
export function relayResponseHeaders(headers: Headers): RelayResponseHeaders {
  return pick(RESPONSE_HEADER_NAMES, headers);
}

/**
 * What a public relay URL may reach. `api` takes `GET` and `POST`; `release`
 * is the phone dropping its own credential and takes `DELETE`.
 */
export interface PublicRelayTarget {
  readonly kind: "api" | "release";
  readonly environmentId: string;
  /** Path and query as the desktop receives them. */
  readonly path: string;
}

export const PUBLIC_RELAY_METHODS = {
  api: ["GET", "POST"],
  release: ["DELETE"],
} as const satisfies Record<PublicRelayTarget["kind"], readonly RelayMethod[]>;

const PUBLIC_URL = new RegExp(`^${RELAY_PREFIX}(${UUID_PATTERN.slice(1, -1)})(/.*)$`, "u");

/**
 * The desktop target a phone's `<origin>/r/<id>/...` URL names, or undefined
 * when the relay must not forward it: anything outside `/v1/...` and
 * `DESKTOP_ROUTES.device`, and always `DESKTOP_ROUTES.enroll`.
 */
export function publicRelayTarget(url: URL): PublicRelayTarget | undefined {
  const match = PUBLIC_URL.exec(url.pathname);

  if (match === null || url.hash !== "") return undefined;
  const [, environmentId = "", route = ""] = match;
  const path = `${route}${url.search}`;

  if (!Value.Check(RelayPath, path)) return undefined;

  if (route === DESKTOP_ROUTES.device)
    return url.search === "" ? { kind: "release", environmentId, path } : undefined;

  return route.startsWith("/v1/") ? { kind: "api", environmentId, path } : undefined;
}

/**
 * Refusals the public relay answers itself, in the Nyte server's error
 * envelope so the phone's HTTP client reads them as wire errors. Only 401
 * and 403 refuse a credential.
 */
export const RELAY_REFUSALS = {
  /** No bearer, or one the broker holds for no usable device of this environment. */
  unauthorized: { status: 401, message: "The device credential was refused" },
  /** An unlisted browser `Origin`, or a release for a revoked device. */
  forbidden: { status: 403, message: "Refused" },
  not_found: { status: 404, message: "Not found" },
  method_not_allowed: { status: 405, message: "Method not allowed" },
  payload_too_large: { status: 413, message: "The request body is too large" },
  /** The desktop is not connected, is at its channel limit, or ended the exchange before answering. */
  closed: { status: 503, message: "This Mac is not connected" },
  internal: { status: 500, message: "The relay failed" },
} as const;

export type RelayRefusalCode = keyof typeof RELAY_REFUSALS;

export function relayRefusal(code: RelayRefusalCode): Response {
  const { status, message } = RELAY_REFUSALS[code];

  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
