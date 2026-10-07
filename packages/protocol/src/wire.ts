/**
 * The envelopes: how a call and its reply look as JSON, how a watch looks as
 * server-sent events, and the error every failure is reported as.
 *
 * Routes (version 1):
 *
 *   GET  {base}/v1/info                       what is answering: its version and wire version
 *   POST {base}/v1/call/{operation}          body `{ "input": <operation input> }`; omit `input` for none
 *   GET  {base}/v1/watch?sessionId=…    `&after=<seq>` to replay, `&live=1` to start at the tip
 *
 * `{operation}` is an SDK operation, or an `environment.*` operation when info
 * reports `environment: true`.
 *
 * The session id is a query parameter, not a path segment: ids are any
 * non-empty string, and `.` or `..` in a path segment would be normalized away.
 *
 * A call reply says whether the SDK returned a value. JSON has no
 * `undefined`, and `null` is a real value elsewhere (a head with no tip), so
 * the envelope carries the distinction explicitly.
 */
import { Type } from "typebox";
import type { Seq } from "./kernel.ts";
import { typed } from "./schemas.ts";
import type { SessionEvent } from "./sdk.ts";

export const WIRE_VERSION = 1;

export const INFO_ROUTE = "/v1/info";

/** `GET /v1/identity?nonce=…`: the host signs the caller's nonce with its profile key. */
export const IDENTITY_ROUTE = "/v1/identity";

export const IDENTITY_QUERY = { nonce: "nonce" } as const;

/** base64url, 16 to 64 bytes: long enough that a replayed answer never matches a fresh ask. */
export const IDENTITY_NONCE_PATTERN = "^[A-Za-z0-9_-]{22,86}$";

export const CALL_ROUTE_PREFIX = "/v1/call/";

export const WATCH_ROUTE = "/v1/watch";

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

/** Deployment properties the SDK model catalog cannot infer. */
export interface ServerDescription {
  readonly capabilities: { readonly workspace: boolean };
  readonly persistence: "durable" | "ephemeral" | "unknown";
}

const serverDescriptionProperties = {
  capabilities: Type.Object({ workspace: Type.Boolean() }, { additionalProperties: false }),
  persistence: Type.Enum(["durable", "ephemeral", "unknown"]),
};

export const ServerDescriptionSchema = typed<ServerDescription>()(
  Type.Object(serverDescriptionProperties, { additionalProperties: false }),
);

/**
 * The host release and description in the info envelope. `wireVersion`
 * restates the route prefix; another wire answers this route with `not_found`.
 */
export interface ServerInfo {
  readonly version: string;
  readonly wireVersion: typeof WIRE_VERSION;
  /**
   * Present when the server answers `environment.*` calls. It sits at the top
   * level because released clients reject unknown keys under `host`.
   */
  readonly environment?: true;
  /**
   * A host with a stable profile identity names it here. Display and
   * discovery only: the binding a client trusts is the signed answer on
   * `IDENTITY_ROUTE`, verified against the key it pinned when it paired.
   */
  readonly identity?: HostIdentity;
  /**
   * How this host targets workspaces. `registry`: roots start through
   * `environment.start` with a registered workspace id, and the shared
   * `workspace.select` cursor is refused. Absent: the cursor host of today.
   */
  readonly workspaces?: { readonly kind: "registry" };
  readonly host:
    | { readonly kind: "unspecified" }
    | ({ readonly kind: "described" } & ServerDescription);
}

/** An Ed25519 public key as a JWK; `hostId` is its RFC 7638 thumbprint. */
export interface HostIdentity {
  readonly hostId: string;
  readonly publicKey: { readonly kty: "OKP"; readonly crv: "Ed25519"; readonly x: string };
}

const hostIdentityProperties = {
  hostId: Type.String({ minLength: 1 }),
  publicKey: Type.Object(
    {
      kty: Type.Literal("OKP"),
      crv: Type.Literal("Ed25519"),
      x: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
    },
    { additionalProperties: false },
  ),
};

export const HostIdentitySchema = typed<HostIdentity>()(
  Type.Object(hostIdentityProperties, { additionalProperties: false }),
);

/**
 * The answer on `IDENTITY_ROUTE`: the identity, the caller's nonce, the
 * process epoch, and an Ed25519 signature over `identityChallengeMessage`.
 */
export interface IdentityChallenge extends HostIdentity {
  readonly nonce: string;
  /** Epoch milliseconds the host process started; a restart is visible without a new key. */
  readonly epoch: number;
  /** base64url Ed25519 signature. */
  readonly signature: string;
}

export const IdentityChallengeSchema = typed<IdentityChallenge>()(
  Type.Object(
    {
      ...hostIdentityProperties,
      nonce: Type.String({ pattern: IDENTITY_NONCE_PATTERN }),
      epoch: Type.Integer({ minimum: 0 }),
      signature: Type.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
    },
    { additionalProperties: false },
  ),
);

/** The bytes a host signs and a client verifies; both sides derive it, so neither trusts the other's framing. */
export function identityChallengeMessage(input: {
  readonly hostId: string;
  readonly nonce: string;
  readonly epoch: number;
}): string {
  return `nyte-host-identity\n${input.hostId}\n${input.nonce}\n${String(input.epoch)}`;
}

export const ServerInfoSchema = typed<ServerInfo>()(
  Type.Object({
    version: Type.String(),
    wireVersion: Type.Literal(WIRE_VERSION),
    environment: Type.Optional(Type.Literal(true)),
    identity: Type.Optional(HostIdentitySchema),
    workspaces: Type.Optional(
      Type.Object({ kind: Type.Literal("registry") }, { additionalProperties: false }),
    ),
    host: Type.Union([
      Type.Object({ kind: Type.Literal("unspecified") }),
      Type.Object(
        { kind: Type.Literal("described"), ...serverDescriptionProperties },
        { additionalProperties: false },
      ),
    ]),
  }),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** One place the input failed its schema. `path` is a JSON pointer into the input. */
export interface Issue {
  readonly path: string;
  readonly message: string;
}

export type PlainErrorCode =
  | "unknown_operation"
  | "unknown_session"
  | "not_found"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "unauthorized"
  | "forbidden"
  | "closed"
  | "internal";

export type WireError =
  | { readonly code: "invalid_input"; readonly message: string; readonly issues: readonly Issue[] }
  /** The cursor is below the stream floor: take a snapshot and watch from its seq. */
  | { readonly code: "cursor_expired"; readonly message: string; readonly floor: Seq }
  | { readonly code: PlainErrorCode; readonly message: string };

export type ErrorCode = WireError["code"];

const plainCodes = [
  "unknown_operation",
  "unknown_session",
  "not_found",
  "method_not_allowed",
  "unsupported_media_type",
  "payload_too_large",
  "unauthorized",
  "forbidden",
  "closed",
  "internal",
] as const satisfies readonly PlainErrorCode[];

export const IssueSchema = typed<Issue>()(
  Type.Object({ path: Type.String(), message: Type.String() }),
);

export const WireErrorSchema = typed<WireError>()(
  Type.Union([
    Type.Object({
      code: Type.Literal("invalid_input"),
      message: Type.String(),
      issues: Type.Array(IssueSchema),
    }),
    Type.Object({
      code: Type.Literal("cursor_expired"),
      message: Type.String(),
      floor: Type.Integer({ minimum: 0 }),
    }),
    Type.Object({ code: Type.Enum(plainCodes), message: Type.String() }),
  ]),
);

/** The HTTP status a call reply or a refused watch carries for each error. */
export function statusFor(code: ErrorCode): number {
  switch (code) {
    case "invalid_input":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "unknown_operation":
    case "unknown_session":
    case "not_found":
      return 404;
    case "method_not_allowed":
      return 405;
    case "cursor_expired":
      return 409;
    case "payload_too_large":
      return 413;
    case "unsupported_media_type":
      return 415;
    case "internal":
      return 500;
    case "closed":
      return 503;
    default: {
      const _exhaustive: never = code;

      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** The request body. `input` absent means the operation's input is `undefined`. */
export interface CallRequest {
  readonly input?: unknown;
}

export const CallRequestSchema = typed<CallRequest>()(
  Type.Object({ input: Type.Optional(Type.Unknown()) }, { additionalProperties: false }),
);

/** The reply before the value is checked against the operation's output schema. */
export type CallReply =
  | { readonly ok: true; readonly defined: true; readonly value: unknown }
  | { readonly ok: true; readonly defined: false }
  | { readonly ok: false; readonly error: WireError };

export const CallReplySchema = typed<CallReply>()(
  Type.Union([
    Type.Object({ ok: Type.Literal(true), defined: Type.Literal(true), value: Type.Unknown() }),
    Type.Object({ ok: Type.Literal(true), defined: Type.Literal(false) }),
    Type.Object({ ok: Type.Literal(false), error: WireErrorSchema }),
  ]),
);

export const JSON_MEDIA_TYPE = "application/json";

export const EVENT_STREAM_MEDIA_TYPE = "text/event-stream";

/** The media type of a `content-type` header, without parameters; undefined when the header is absent. */
export function mediaType(header: string | null): string | undefined {
  if (header === null) return undefined;
  const semicolon = header.indexOf(";");

  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

/**
 * One server-sent event on the watch route. The SSE `event` field is the
 * frame kind; `data` is the JSON below. A stream that closes without an
 * `ended` or `error` frame was interrupted, and the client reports that.
 */
export type WatchFrame =
  | { readonly kind: "event"; readonly event: SessionEvent }
  | { readonly kind: "ended" }
  | { readonly kind: "error"; readonly error: WireError };

/** The data of an `ended` frame: an object, today empty. */
export const WatchEndedSchema = Type.Object({});

export const WatchFrameKindSchema = typed<WatchFrame["kind"]>()(
  Type.Enum(["event", "ended", "error"]),
);

export const WATCH_QUERY = {
  sessionId: "sessionId",
  after: "after",
  live: "live",
} as const;

/** The parsed watch query. `after` and `live` never both appear. */
export type WatchQuery =
  | { readonly sessionId: string; readonly afterSeq?: Seq }
  | { readonly sessionId: string; readonly live: true };
