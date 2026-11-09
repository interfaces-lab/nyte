import { OPERATIONS } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";
import { Value } from "typebox/value";
import { base64Url, fromBase64Url } from "./encoding.ts";
import { CompactJws, DESKTOP_ROUTES, RELAY_PREFIX, UUID_PATTERN } from "./schemas.ts";

export const RELAY_AUTH_TIMEOUT_MS = 5_000;

export const RELAY_PENDING_LIMIT = 4;

export const RELAY_CHANNEL_LIMIT = 32;

export const RELAY_CHUNK_BYTES = 32_768;

export const RELAY_WINDOW_BYTES = 262_144;

export const RELAY_BODY_LIMIT_BYTES = 8_388_608;

export const RELAY_FRAME_CHARS = 65_536;

export const RELAY_MESSAGE_LIMIT_BYTES = 1_048_576;

export const RELAY_PING_INTERVAL_MS = 20_000;

export const RELAY_RETRY_MIN_MS = 1_000;

export const RELAY_RETRY_MAX_MS = 60_000;

export const RELAY_PING = '{"t":"ping"}';

export const RELAY_PONG = '{"t":"pong"}';

export const RELAY_CLOSE = {
  invalid: 4400,
  unauthorized: 4401,
  replaced: 4409,
  revoked: 4410,
} as const;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

export const ChannelId = Type.String({ pattern: "^[A-Za-z0-9_-]{22}$" });

const Chunk = Type.String({
  minLength: 2,
  maxLength: Math.ceil((RELAY_CHUNK_BYTES * 4) / 3),
  pattern: "^[A-Za-z0-9_-]+$",
});

const Credit = Type.Integer({ minimum: 1, maximum: RELAY_WINDOW_BYTES });

export const RelayMethod = Type.Enum(["GET", "POST", "DELETE"]);

export type RelayMethod = Static<typeof RelayMethod>;

export const RELAY_OPERATIONS: readonly string[] = Object.entries(OPERATIONS).flatMap((entry) =>
  "local" in entry[1] ? [] : [entry[0]],
);

const RELAY_DISCOVERY = {
  identity: "/.nyte/identity",
  describe: "/.nyte/describe",
} as const;

export const RELAY_STREAMS = {
  channel: "/.nyte/streams",
  cancel: "/.nyte/streams/cancel",
} as const;

export const RELAY_SOCKET = {
  socket: "/.nyte/ws",
  ticket: "/.nyte/ws/ticket",
} as const;

const literal = (text: string) => text.replaceAll(".", "\\.");
const OPERATION = RELAY_OPERATIONS.map(literal).join("|");
const QUERY = "\\?(?:[A-Za-z0-9*._~+=&-]|%[0-9A-Fa-f]{2})*";

export const RelayPath = Type.String({
  maxLength: 2048,
  pattern: `^(?:/(?:${OPERATION})|${literal(RELAY_DISCOVERY.identity)}(?:${QUERY})?|${literal(RELAY_DISCOVERY.describe)}|${literal(RELAY_STREAMS.channel)}|${literal(RELAY_STREAMS.cancel)}|${literal(RELAY_SOCKET.ticket)}|${DESKTOP_ROUTES.device}|${DESKTOP_ROUTES.enroll})$`,
});

export const RelaySocketPath = Type.String({
  maxLength: 256,
  pattern: `^${literal(RELAY_SOCKET.socket)}\\?ticket=[A-Za-z0-9_-]{1,128}$`,
});

const HEADER_VALUE = "^[\\x20-\\x7e]*$";

const HeaderValue = Type.String({ maxLength: 8192, pattern: HEADER_VALUE });

export const RelayRequestHeaders = strict({
  authorization: Type.Optional(HeaderValue),
  "content-type": Type.Optional(HeaderValue),
  accept: Type.Optional(HeaderValue),
  "x-nyte-input": Type.Optional(HeaderValue),
  "x-nyte-channel": Type.Optional(HeaderValue),
  "x-nyte-stream": Type.Optional(HeaderValue),
});

export type RelayRequestHeaders = Static<typeof RelayRequestHeaders>;

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

const RelayStatus = Type.Union([
  Type.Integer({ minimum: 200, maximum: 299 }),
  Type.Integer({ minimum: 400, maximum: 599 }),
]);

const ChannelData = strict({ t: Type.Literal("data"), ch: ChannelId, data: Chunk });
const ChannelEnd = strict({ t: Type.Literal("end"), ch: ChannelId });
const ChannelCredit = strict({ t: Type.Literal("credit"), ch: ChannelId, bytes: Credit });
const ChannelReset = strict({ t: Type.Literal("reset"), ch: ChannelId });
const SocketMessage = strict({
  t: Type.Literal("message"),
  ch: ChannelId,
  data: Chunk,
  fin: Type.Boolean(),
});
const SocketClose = strict({
  t: Type.Literal("close"),
  ch: ChannelId,
  code: Type.Integer({ minimum: 1000, maximum: 4999 }),
  reason: Type.String({ maxLength: 123 }),
});

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
  strict({ t: Type.Literal("socket"), ch: ChannelId, path: RelaySocketPath }),
  ChannelData,
  ChannelEnd,
  ChannelCredit,
  ChannelReset,
  SocketMessage,
  SocketClose,
]);

export type RelayFrame = Static<typeof RelayFrame>;

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
  SocketMessage,
  SocketClose,
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

export function parseRelayFrame(message: unknown): RelayFrame | undefined {
  return parseFrame(RelayFrame, message);
}

export function parseDesktopFrame(message: unknown): DesktopFrame | undefined {
  return parseFrame(DesktopFrame, message);
}

export function encodeChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += RELAY_CHUNK_BYTES)
    chunks.push(base64Url(bytes.subarray(offset, offset + RELAY_CHUNK_BYTES)));

  return chunks;
}

export function decodeChunk(data: string): Uint8Array | undefined {
  const bytes = fromBase64Url(data);

  return bytes === undefined || bytes.byteLength === 0 || bytes.byteLength > RELAY_CHUNK_BYTES
    ? undefined
    : bytes;
}

export function encodeMessage(text: string): { readonly data: string; readonly fin: boolean }[] {
  const chunks = encodeChunks(new TextEncoder().encode(text));

  return chunks.map((data, index) => ({ data, fin: index === chunks.length - 1 }));
}

export function sendableCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

export function hasNullBody(status: number): boolean {
  return status === 204 || status === 205;
}

export const RELAY_REQUEST_HEADER_NAMES = [
  "authorization",
  "content-type",
  "accept",
  "x-nyte-input",
  "x-nyte-channel",
  "x-nyte-stream",
] as const;

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

export function relayRequestHeaders(headers: Headers): RelayRequestHeaders {
  return pick(RELAY_REQUEST_HEADER_NAMES, headers);
}

export function relayResponseHeaders(headers: Headers): RelayResponseHeaders {
  return pick(RELAY_RESPONSE_HEADER_NAMES, headers);
}

interface PublicRelayTarget {
  readonly kind: "api" | "discovery" | "release" | "socket";
  readonly environmentId: string;
  readonly path: string;
}

export const PUBLIC_RELAY_METHODS = {
  api: ["POST"],
  discovery: ["GET"],
  release: ["DELETE"],
  socket: ["GET"],
} as const satisfies Record<PublicRelayTarget["kind"], readonly RelayMethod[]>;

export const PUBLIC_RELAY_BEARER = {
  api: "active",
  discovery: "none",
  release: "reserved-or-active",
  socket: "none",
} as const satisfies Record<PublicRelayTarget["kind"], "none" | "active" | "reserved-or-active">;

const PUBLIC_URL = new RegExp(`^${RELAY_PREFIX}(${UUID_PATTERN.slice(1, -1)})(/.*)$`, "u");

export function publicRelayTarget(url: URL): PublicRelayTarget | undefined {
  const match = PUBLIC_URL.exec(url.pathname);

  if (match === null || url.hash !== "") return undefined;
  const [, environmentId = "", route = ""] = match;
  const path = `${route}${url.search}`;

  if (route === RELAY_SOCKET.socket)
    return Value.Check(RelaySocketPath, path) ? { kind: "socket", environmentId, path } : undefined;

  if (!Value.Check(RelayPath, path) || route === DESKTOP_ROUTES.enroll) return undefined;

  if (route === DESKTOP_ROUTES.device)
    return url.search === "" ? { kind: "release", environmentId, path } : undefined;

  return route === RELAY_DISCOVERY.identity || route === RELAY_DISCOVERY.describe
    ? { kind: "discovery", environmentId, path }
    : { kind: "api", environmentId, path };
}

export const RELAY_REFUSALS = {
  unauthorized: {
    status: 401,
    code: "unauthenticated",
    message: "The device credential was refused",
  },
  forbidden: { status: 403, code: "denied", message: "Refused" },
  not_found: { status: 404, code: "unknown", message: "Not found" },
  method_not_allowed: { status: 405, code: "invalid", message: "Method not allowed" },
  payload_too_large: { status: 413, code: "invalid", message: "The request body is too large" },
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
