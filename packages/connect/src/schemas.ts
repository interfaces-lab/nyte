import { Type } from "typebox";
import type { Static, TProperties } from "typebox";

export const PROOF_LIFETIME_SECONDS = 60;

export const LEASE_LIFETIME_SECONDS = 60;

export const HEARTBEAT_INTERVAL_SECONDS = 20;

export const ENROLLMENT_LIFETIME_SECONDS = 60;

export const ENROLLMENT_READINESS_SECONDS = 10;

export const RESPONSE_LIMIT_BYTES = 65_536;

export const REQUEST_TIMEOUT_MS = 15_000;

export const CLOCK_TOLERANCE_SECONDS = 5;

export const ONLINE_WINDOW_SECONDS = 90;

export const DEVICE_LIMIT = 20;

export const NAME_LIMIT = 64;

export const DEVICE_TOKEN_BYTES = 32;

export const PROOF_HEADER = "nyte-proof";

export const TOKEN_TYPES = {
  proof: "nyte-proof+jwt",
  enrollment: "nyte-enrollment+jwt",
  receipt: "nyte-receipt+jwt",
  lease: "nyte-lease+jwt",
} as const;

export const BROKER_ROUTES = {
  environments: "/v1/environments",
  environment: (environmentId: string) => `/v1/environments/${environmentId}`,
  lease: (environmentId: string) => `/v1/environments/${environmentId}/lease`,
  relay: (environmentId: string) => `/v1/environments/${environmentId}/relay`,
  devices: (environmentId: string) => `/v1/environments/${environmentId}/devices`,
  device: (environmentId: string, deviceId: string) =>
    `/v1/environments/${environmentId}/devices/${deviceId}`,
  release: (environmentId: string, deviceId: string) =>
    `/v1/environments/${environmentId}/devices/${deviceId}/release`,
  webhook: "/v1/clerk/webhook",
  keys: "/.well-known/jwks.json",
  linkTransactions: "/v1/link-transactions",
  linkTransactionLookup: "/v1/link-transactions/lookup",
  linkTransactionApprove: (transactionId: string) =>
    `/v1/link-transactions/${transactionId}/approve`,
  linkTransactionDeny: (transactionId: string) => `/v1/link-transactions/${transactionId}/deny`,
  linkTransactionPoll: (transactionId: string) => `/v1/link-transactions/${transactionId}/poll`,
  linkTransactionComplete: (transactionId: string) =>
    `/v1/link-transactions/${transactionId}/complete`,
  linkTransaction: (transactionId: string) => `/v1/link-transactions/${transactionId}`,
} as const;

export const LINK_TRANSACTION_LIFETIME_SECONDS = 300;

export const LINK_AUTHORIZATION_LIFETIME_SECONDS = 60;

export const LINK_POLL_INTERVAL_SECONDS = 5;

const USER_CODE_ALPHABET = "0123456789BCDFGHJKMNPQRSTVWXZ";

const USER_CODE_LENGTH = 8;

export const RELAY_PREFIX = "/r/";

export const DESKTOP_ROUTES = {
  prefix: "/_nyte/connect/",
  enroll: "/_nyte/connect/enroll",
  device: "/_nyte/connect/device",
} as const;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

export const Uuid = Type.String({ pattern: UUID_PATTERN });

export const Base64Url32 = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });

export const RandomId = Type.String({ pattern: "^[A-Za-z0-9_-]{22,86}$" });

export const CompactJws = Type.String({
  maxLength: 8192,
  pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
});

export const Name = Type.String({ minLength: 1, maxLength: NAME_LIMIT });

export const ClientId = Type.String({ pattern: "^[A-Za-z0-9_-]{16,64}$" });

export const DeviceToken = Base64Url32;

const Seconds = Type.Integer({ minimum: 0 });

const Party = Type.String({ minLength: 1, maxLength: 256 });

const Subject = Type.String({ minLength: 1, maxLength: 128 });

export const PublicJwk = strict({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
});

export type PublicJwk = Static<typeof PublicJwk>;

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

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "revoked",
  "owner_disabled",
  "session_revoked",
  "limit",
  "rate_limited",
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

export const LinkRequest = strict({ publicKey: PublicJwk, name: Name });

export type LinkRequest = Static<typeof LinkRequest>;

const LinkedEnvironment = Type.Object({
  id: Uuid,
  name: Name,
});

export const UserCode = Type.String({ pattern: "^[A-Za-z0-9]{4}[- ]?[A-Za-z0-9]{4}$" });

export type UserCode = Static<typeof UserCode>;

export const LinkTransactionRequest = strict({
  publicKey: PublicJwk,
  name: Name,
  operationId: RandomId,
  userCode: UserCode,
});

export type LinkTransactionRequest = Static<typeof LinkTransactionRequest>;

export const LINK_TRANSACTION_STATES = [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
  "consumed",
] as const;

export type LinkTransactionState = (typeof LINK_TRANSACTION_STATES)[number];

export const LinkTransactionOpened = Type.Object({
  transactionId: Uuid,
  verifyUrl: Type.String({ maxLength: 2048 }),
  expiresAt: Type.Integer({ minimum: 0 }),
  pollIntervalMs: Type.Integer({ minimum: 1000 }),
  state: Type.Enum(LINK_TRANSACTION_STATES),
});

export type LinkTransactionOpened = Static<typeof LinkTransactionOpened>;

export const LinkTransactionLookupRequest = strict({ userCode: UserCode });

export type LinkTransactionLookupRequest = Static<typeof LinkTransactionLookupRequest>;

export const LinkTransactionLookup = Type.Object({
  transactionId: Uuid,
  hostName: Name,
  fingerprint: Type.String({ minLength: 1, maxLength: 64 }),
  expiresAt: Type.Integer({ minimum: 0 }),
});

export type LinkTransactionLookup = Static<typeof LinkTransactionLookup>;

export const LinkTransactionApproveRequest = strict({
  fingerprint: Type.String({ minLength: 1, maxLength: 64 }),
});

export type LinkTransactionApproveRequest = Static<typeof LinkTransactionApproveRequest>;

export const LinkTransactionStatus = Type.Object({ state: Type.Enum(LINK_TRANSACTION_STATES) });

export type LinkTransactionStatus = Static<typeof LinkTransactionStatus>;

export const DeviceRole = Type.Union([Type.Literal("controller"), Type.Literal("owner")]);

export type DeviceRole = Static<typeof DeviceRole>;

export const LinkResponse = Type.Object({
  environment: LinkedEnvironment,
  owner: Type.Object({
    id: Subject,
    label: Type.String({ maxLength: 320 }),
  }),
  brokerKeys: BrokerKeys,
});

export type LinkResponse = Static<typeof LinkResponse>;

export const LinkTransactionCompletion = Type.Union([
  Type.Object({ state: Type.Literal("consumed"), link: LinkResponse }),
  Type.Object({
    state: Type.Enum(["pending", "approved", "denied", "expired", "cancelled"]),
  }),
]);

export type LinkTransactionCompletion = Static<typeof LinkTransactionCompletion>;

export const LeaseResponse = Type.Object({ lease: CompactJws });

export type LeaseResponse = Static<typeof LeaseResponse>;

export const LeaseClaims = Type.Object({
  iss: Party,
  aud: Uuid,
  sub: Subject,
  iat: Seconds,
  exp: Seconds,
  req: RandomId,
  generation: Type.Integer({ minimum: 1 }),
  policy: Type.Integer({ minimum: 1 }),
  devices: Type.Array(Uuid, { maxItems: DEVICE_LIMIT }),
});

export type LeaseClaims = Static<typeof LeaseClaims>;

export const ProofClaims = Type.Object({
  iss: Type.String({ minLength: 1, maxLength: 128 }),
  aud: Party,
  iat: Seconds,
  exp: Seconds,
  jti: RandomId,
  htm: Type.Enum(["GET", "POST", "DELETE"]),
  htu: Type.String({ minLength: 1, maxLength: 256 }),
  bh: Base64Url32,
});

export type ProofClaims = Static<typeof ProofClaims>;

export const EnvironmentSummary = Type.Object({
  id: Uuid,
  name: Name,
  online: Type.Boolean(),
  lastSeenAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});

export type EnvironmentSummary = Static<typeof EnvironmentSummary>;

export const EnvironmentList = Type.Object({
  environments: Type.Array(EnvironmentSummary, { maxItems: 64 }),
});

export type EnvironmentList = Static<typeof EnvironmentList>;

export const EnrollRequest = strict({
  clientId: ClientId,
  clientName: Name,
  digest: Base64Url32,
  role: Type.Optional(DeviceRole),
});

export type EnrollRequest = Static<typeof EnrollRequest>;

export const EnrollResponse = Type.Object({
  environmentId: Uuid,
  deviceId: Uuid,
});

export type EnrollResponse = Static<typeof EnrollResponse>;

export const EnrollEnvelope = strict({ authorization: CompactJws });

export type EnrollEnvelope = Static<typeof EnrollEnvelope>;

export const EnrollmentClaims = Type.Object({
  iss: Party,
  aud: Uuid,
  sub: Subject,
  iat: Seconds,
  exp: Seconds,
  jti: RandomId,
  nonce: RandomId,
  generation: Type.Integer({ minimum: 1 }),
  deviceId: Uuid,
  clientId: ClientId,
  clientName: Name,
  digest: Base64Url32,
  role: Type.Optional(DeviceRole),
});

export type EnrollmentClaims = Static<typeof EnrollmentClaims>;

export const ReceiptEnvelope = Type.Object({ receipt: CompactJws });

export type ReceiptEnvelope = Static<typeof ReceiptEnvelope>;

export const ReceiptClaims = Type.Object({
  iss: Uuid,
  aud: Party,
  iat: Seconds,
  exp: Seconds,
  req: RandomId,
  nonce: RandomId,
  deviceId: Uuid,
  digest: Base64Url32,
});

export type ReceiptClaims = Static<typeof ReceiptClaims>;

export function keyFingerprint(thumbprint: string): string {
  return thumbprint.slice(0, 16).replace(/(.{4})(?=.)/gu, "$1-");
}

export function randomUserCode(randomBytes: (count: number) => Uint8Array): string {
  const raw = Array.from(
    randomBytes(USER_CODE_LENGTH),
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length],
  ).join("");

  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const USER_CODE = new RegExp(`^[${USER_CODE_ALPHABET}]{${String(USER_CODE_LENGTH)}}$`, "u");

export function normalizeUserCode(input: string): string | undefined {
  const raw = input.toUpperCase().replaceAll("-", "").replaceAll(" ", "");

  if (!USER_CODE.test(raw)) return undefined;

  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
