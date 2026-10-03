/**
 * The Nyte Connect wire contract. Three parties speak it:
 *
 * - the broker, a Cloudflare Worker that links desktops to Clerk accounts,
 *   leases device access, and relays phone requests to each desktop over the
 *   WebSocket that desktop opened;
 * - the desktop, which proves itself with an Ed25519 machine key and answers
 *   relayed requests, including two routes of its own;
 * - the phone, which authenticates to the broker with a Clerk session JWT and
 *   to the desktop with a bearer token only it ever held.
 *
 * Every schema here is checked with `Value.Check` or `Value.Parse`; nothing is
 * compiled, because a Worker cannot run `new Function`.
 */
import { Type } from "typebox";
import type { Static, TProperties } from "typebox";

// ---------------------------------------------------------------------------
// Lifetimes and limits
// ---------------------------------------------------------------------------

/** A signed request proof is accepted for this long after `iat`. */
export const PROOF_LIFETIME_SECONDS = 60;

/** A lease authorizes devices until `iat` plus this. The desktop fails closed once it lapses. */
export const LEASE_LIFETIME_SECONDS = 60;

/** How often a serving desktop asks for a fresh lease. Two missed beats still leave a valid one. */
export const HEARTBEAT_INTERVAL_SECONDS = 20;

/** A broker enrollment authorization is redeemable for this long after `iat`. */
export const ENROLLMENT_LIFETIME_SECONDS = 60;

/** How long a phone may retry a fresh token while the desktop's lease catches up. */
export const ENROLLMENT_READINESS_SECONDS = 10;

/** Most bytes a broker client reads from one answer. */
export const RESPONSE_LIMIT_BYTES = 65_536;

/** A broker call that takes longer than this is abandoned. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Allowed clock difference between the broker and a desktop, either way. */
export const CLOCK_TOLERANCE_SECONDS = 5;

/** A desktop without a heartbeat for this long lists as offline, even with its relay socket open. */
export const ONLINE_WINDOW_SECONDS = 90;

/** Active and reserved devices per environment. */
export const DEVICE_LIMIT = 20;

export const NAME_LIMIT = 64;

/** Bytes of CSPRNG output in a device bearer token. */
export const DEVICE_TOKEN_BYTES = 32;

/** The header that carries a desktop's request proof. */
export const PROOF_HEADER = "nyte-proof";

/** Protected-header `typ` values; a token of one kind is never accepted as another. */
export const TOKEN_TYPES = {
  proof: "nyte-proof+jwt",
  enrollment: "nyte-enrollment+jwt",
  receipt: "nyte-receipt+jwt",
  lease: "nyte-lease+jwt",
} as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Broker routes, relative to `CONNECT_ORIGIN`. Ids are UUIDs checked before
 * they reach a path. Both `DELETE` routes and `release` answer 204 with no
 * body; every other success and every failure answers JSON.
 */
export const BROKER_ROUTES = {
  environments: "/v1/environments",
  environment: (environmentId: string) => `/v1/environments/${environmentId}`,
  lease: (environmentId: string) => `/v1/environments/${environmentId}/lease`,
  /**
   * `GET` WebSocket upgrade: the desktop's relay socket. No credential rides
   * the URL or headers; the first frame carries an environment proof for
   * `GET` on this exact path with an empty body. See `./relay.ts`.
   */
  relay: (environmentId: string) => `/v1/environments/${environmentId}/relay`,
  devices: (environmentId: string) => `/v1/environments/${environmentId}/devices`,
  /**
   * `DELETE`: revoke a device. Accepts an owner's Clerk session JWT or an
   * environment proof. Also tombstones the Clerk session that enrolled the
   * device and revokes it in Clerk, so that session cannot enroll again
   * without a fresh sign-in.
   */
  device: (environmentId: string, deviceId: string) =>
    `/v1/environments/${environmentId}/devices/${deviceId}`,
  /**
   * `POST` with body `{}`: release a device. Environment proof only; a Clerk
   * JWT is refused. The desktop sends it only after the device's own bearer
   * token called `DELETE /_nyte/connect/device`. It ends that device like a
   * revocation (status revoked, policy advanced, absent from every later
   * lease) but leaves the enrolling Clerk session alone: no tombstone, no
   * Clerk revocation, and an existing tombstone is never cleared. 204, also
   * when the device is already revoked or released.
   */
  release: (environmentId: string, deviceId: string) =>
    `/v1/environments/${environmentId}/devices/${deviceId}/release`,
  webhook: "/v1/clerk/webhook",
  keys: "/.well-known/jwks.json",
} as const;

/**
 * Where phones reach a desktop: `<CONNECT_ORIGIN>/r/<environmentId>`, under
 * which the Nyte HTTP client appends `/v1/...` and the phone appends
 * `DESKTOP_ROUTES.device`. The broker forwards nothing else under it.
 */
export const RELAY_PREFIX = "/r/";

/**
 * Desktop routes, outside the Nyte server's `/v1`, reached only through the
 * relay. They run before the server's own auth and grant nothing on their
 * own: enrollment needs a broker signature, and `DELETE device` removes only
 * the device whose bearer token it presents. The public relay never forwards
 * `enroll`; only the broker originates it. Removing a device is a release:
 * the desktop refuses the token at once, closes its streams, and queues the
 * broker's `release` route, never the stronger `device` revocation. A phone
 * uses it to drop its own credential (a cancelled connect, a failed probe, a
 * switch to another Mac) without signing itself out.
 */
export const DESKTOP_ROUTES = {
  prefix: "/_nyte/connect/",
  enroll: "/_nyte/connect/enroll",
  device: "/_nyte/connect/device",
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/** A lowercase v4 UUID, as `crypto.randomUUID()` writes it. */
export const Uuid = Type.String({ pattern: UUID_PATTERN });

/** 32 bytes as unpadded base64url: a SHA-256 digest or an Ed25519 public key. */
export const Base64Url32 = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });

/** A random identifier of at least 128 bits, unpadded base64url. */
export const RandomId = Type.String({ pattern: "^[A-Za-z0-9_-]{22,86}$" });

/** A compact JWS: three base64url segments. */
export const CompactJws = Type.String({
  maxLength: 8192,
  pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
});

export const Name = Type.String({ minLength: 1, maxLength: NAME_LIMIT });

/** One install of the phone app, generated once and kept in its Keychain. */
export const ClientId = Type.String({ pattern: "^[A-Za-z0-9_-]{16,64}$" });

/** A device bearer token: `DEVICE_TOKEN_BYTES` of CSPRNG output as unpadded base64url. */
export const DeviceToken = Base64Url32;

const Seconds = Type.Integer({ minimum: 0 });

/** An origin or other issuer/audience string inside a signed token. */
const Party = Type.String({ minLength: 1, maxLength: 256 });

/** A Clerk user id. */
const Subject = Type.String({ minLength: 1, maxLength: 128 });

/** An Ed25519 public key. Private parameters are refused, not ignored. */
export const PublicJwk = strict({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
});

export type PublicJwk = Static<typeof PublicJwk>;

/** A broker signing key as its key set publishes it. */
export const BrokerJwk = Type.Object({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
  kid: Type.String({ minLength: 1, maxLength: 128 }),
});

export type BrokerJwk = Static<typeof BrokerJwk>;

export const BrokerKeys = Type.Object({
  keys: Type.Array(BrokerJwk, { minItems: 1, maxItems: 4 }),
});

export type BrokerKeys = Static<typeof BrokerKeys>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  /** No credential, or one that does not verify. */
  "unauthorized",
  /** A verified caller that may not do this. */
  "forbidden",
  /** Absent, or not this caller's to see. */
  "not_found",
  /** A concurrent change won; nothing was granted. */
  "conflict",
  /** The environment was unlinked or removed. Stop and forget the link. */
  "revoked",
  /** The owner is banned, locked, or deleted in Clerk. */
  "owner_disabled",
  /** This Clerk session was used by a device that has since been revoked. Sign in again. */
  "session_revoked",
  "limit",
  "rate_limited",
  /** The desktop did not answer, or answered without a valid signature. */
  "unreachable",
  "invalid",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorBody = Type.Object({
  error: Type.Object({
    code: Type.Enum(ERROR_CODES),
    message: Type.String({ maxLength: 512 }),
  }),
});

export type ErrorBody = Static<typeof ErrorBody>;

// ---------------------------------------------------------------------------
// Desktop ↔ broker (machine-key proofs)
// ---------------------------------------------------------------------------

/**
 * `POST /v1/environments` with `Authorization: Bearer <Clerk session JWT>` and a
 * proof signed by the key being registered, whose `iss` is that key's RFC 7638
 * thumbprint. Retrying with the same key resumes an unfinished link.
 */
export const LinkRequest = strict({ publicKey: PublicJwk, name: Name });

export type LinkRequest = Static<typeof LinkRequest>;

/** Its relay address is not sent: every client derives it with `relayAddress`. */
export const LinkedEnvironment = Type.Object({
  id: Uuid,
  name: Name,
});

export type LinkedEnvironment = Static<typeof LinkedEnvironment>;

export const LinkResponse = Type.Object({
  environment: LinkedEnvironment,
  /** The Clerk user the link belongs to: `sub` and a display label. */
  owner: Type.Object({
    id: Subject,
    label: Type.String({ maxLength: 320 }),
  }),
  brokerKeys: BrokerKeys,
});

export type LinkResponse = Static<typeof LinkResponse>;

/**
 * `POST /v1/environments/:id/lease` with an environment proof and an empty
 * JSON object as its body. The only call a serving desktop makes on a
 * schedule.
 *
 * Readiness after enrollment: the broker answers the phone's enrollment only
 * after the device is active, so any lease requested after the phone's first
 * request arrives lists it. When a request presents a recorded device that the
 * held lease does not list and that was recorded after the held lease's
 * request was sent, the desktop requests a lease before deciding (at most one
 * such refresh per device every 30 seconds, waiting at most 5 seconds). The
 * phone may retry the same token for 10 seconds after enrolling; a refusal
 * after that means revoked, and the phone asks the user to reconnect.
 */
export const LeaseResponse = Type.Object({ lease: CompactJws });

export type LeaseResponse = Static<typeof LeaseResponse>;

/**
 * What a lease says, signed by the broker. Only listed devices may use the
 * listener. `req` binds it to the proof that asked for it, so an old lease
 * cannot be replayed; `policy` orders leases, so a slower answer to an earlier
 * request cannot undo a newer one.
 */
export const LeaseClaims = Type.Object({
  iss: Party,
  aud: Uuid,
  sub: Subject,
  iat: Seconds,
  exp: Seconds,
  /** The `jti` of the lease request's proof. */
  req: RandomId,
  /** The environment's lifecycle generation; it only grows. */
  generation: Type.Integer({ minimum: 1 }),
  /**
   * Grows with every device activation, revocation, or replacement and every
   * lifecycle change. A desktop refuses a lease whose policy is lower than one
   * it already holds.
   */
  policy: Type.Integer({ minimum: 1 }),
  devices: Type.Array(Uuid, { maxItems: DEVICE_LIMIT }),
});

export type LeaseClaims = Static<typeof LeaseClaims>;

/** A desktop's request proof, signed by its machine key. */
export const ProofClaims = Type.Object({
  /** The environment id, or the key thumbprint while linking. */
  iss: Type.String({ minLength: 1, maxLength: 128 }),
  /** `CONNECT_ORIGIN`. */
  aud: Party,
  iat: Seconds,
  exp: Seconds,
  jti: RandomId,
  htm: Type.Enum(["GET", "POST", "DELETE"]),
  /** The request path, without query. */
  htu: Type.String({ minLength: 1, maxLength: 256 }),
  /** base64url SHA-256 of the exact request body bytes; of the empty string when there is none. */
  bh: Base64Url32,
});

export type ProofClaims = Static<typeof ProofClaims>;

// ---------------------------------------------------------------------------
// Phone ↔ broker (Clerk session JWT)
// ---------------------------------------------------------------------------

export const EnvironmentSummary = Type.Object({
  id: Uuid,
  name: Name,
  /** The desktop's relay socket is authenticated and its last heartbeat is within `ONLINE_WINDOW_SECONDS`. */
  online: Type.Boolean(),
  /** Milliseconds since the epoch of the last heartbeat, or null before the first. */
  lastSeenAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});

export type EnvironmentSummary = Static<typeof EnvironmentSummary>;

/** `GET /v1/environments`: the caller's active environments. */
export const EnvironmentList = Type.Object({
  environments: Type.Array(EnvironmentSummary, { maxItems: 64 }),
});

export type EnvironmentList = Static<typeof EnvironmentList>;

/**
 * `POST /v1/environments/:id/devices`. The phone generated a 256-bit token
 * with a native CSPRNG and sends only its digest; the token itself never
 * reaches the broker. An earlier device with the same `clientId` is revoked.
 */
export const EnrollRequest = strict({ clientId: ClientId, clientName: Name, digest: Base64Url32 });

export type EnrollRequest = Static<typeof EnrollRequest>;

export const EnrollResponse = Type.Object({
  environmentId: Uuid,
  deviceId: Uuid,
});

export type EnrollResponse = Static<typeof EnrollResponse>;

// ---------------------------------------------------------------------------
// Broker → desktop (over the relay)
// ---------------------------------------------------------------------------

/** `POST /_nyte/connect/enroll` body, relayed by the broker itself and never from a phone. */
export const EnrollEnvelope = strict({ authorization: CompactJws });

export type EnrollEnvelope = Static<typeof EnrollEnvelope>;

/** What the broker authorizes the desktop to record. Recording grants nothing until a lease lists the device. */
export const EnrollmentClaims = Type.Object({
  iss: Party,
  aud: Uuid,
  /** The owner's Clerk user id; must equal the link's. */
  sub: Subject,
  iat: Seconds,
  exp: Seconds,
  /** Consumed durably by the desktop, so a replay cannot restore a revoked device. */
  jti: RandomId,
  nonce: RandomId,
  generation: Type.Integer({ minimum: 1 }),
  deviceId: Uuid,
  clientId: ClientId,
  clientName: Name,
  digest: Base64Url32,
});

export type EnrollmentClaims = Static<typeof EnrollmentClaims>;

/** The desktop's answer, written only after the device record is on disk. */
export const ReceiptEnvelope = Type.Object({ receipt: CompactJws });

export type ReceiptEnvelope = Static<typeof ReceiptEnvelope>;

export const ReceiptClaims = Type.Object({
  /** The environment id. */
  iss: Uuid,
  /** `CONNECT_ORIGIN`. */
  aud: Party,
  iat: Seconds,
  exp: Seconds,
  /** The enrollment's `jti`. */
  req: RandomId,
  nonce: RandomId,
  deviceId: Uuid,
  digest: Base64Url32,
});

export type ReceiptClaims = Static<typeof ReceiptClaims>;
