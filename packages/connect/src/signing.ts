import {
  SignJWT,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";
import type { JWTPayload } from "jose";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { base64Url } from "./encoding.ts";
import {
  Base64Url32,
  CLOCK_TOLERANCE_SECONDS,
  PROOF_LIFETIME_SECONDS,
  ProofClaims,
  PublicJwk,
  TOKEN_TYPES,
} from "./schemas.ts";
import type { BrokerJwk, BrokerKeys } from "./schemas.ts";

export const PrivateJwk = Type.Object({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
  d: Base64Url32,
  kid: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type PrivateJwk = Static<typeof PrivateJwk>;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

class VerificationFailed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "VerificationFailed";
  }
}

export function toPublicJwk(key: PrivateJwk): PublicJwk {
  return { kty: "OKP", crv: "Ed25519", x: key.x };
}

export function publicKeySet(keys: readonly PrivateJwk[]): BrokerKeys {
  const published: BrokerJwk[] = keys.map((key) => {
    if (key.kid === undefined) throw new VerificationFailed("A broker signing key needs a kid");

    return { kty: "OKP", crv: "Ed25519", x: key.x, kid: key.kid };
  });

  return { keys: published };
}

export async function generateMachineKey(): Promise<PrivateJwk> {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const exported: unknown = await exportJWK(pair.privateKey);

  if (!Value.Check(PrivateJwk, exported)) throw new VerificationFailed("Unexpected Ed25519 export");

  return { kty: "OKP", crv: "Ed25519", x: exported.x, d: exported.d };
}

export function keyThumbprint(key: PublicJwk): Promise<string> {
  return calculateJwkThumbprint({ kty: key.kty, crv: key.crv, x: key.x }, "sha256");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

  return base64Url(new Uint8Array(digest));
}

export function randomId(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function nowSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1000);
}

export async function signClaims(input: {
  readonly key: PrivateJwk;
  readonly typ: TokenType;
  readonly claims: JWTPayload;
}): Promise<string> {
  const header =
    input.key.kid === undefined
      ? { alg: "EdDSA", typ: input.typ }
      : { alg: "EdDSA", typ: input.typ, kid: input.key.kid };

  return new SignJWT(input.claims).setProtectedHeader(header).sign(input.key);
}

function tokenKeyId(token: string): string | undefined {
  try {
    const header = decodeProtectedHeader(token);

    return typeof header.kid === "string" ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

export async function verifyClaims<S extends TSchema>(input: {
  readonly token: string;
  readonly key: PublicJwk;
  readonly typ: TokenType;
  readonly issuer: string;
  readonly audience: string;
  readonly schema: S;
  readonly lifetime: number;
  readonly now?: number;
}): Promise<Static<S>> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(input.token, input.key, {
      algorithms: ["EdDSA"],
      typ: input.typ,
      issuer: input.issuer,
      audience: input.audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: input.lifetime + CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["iat", "exp"],
      currentDate: new Date(input.now ?? Date.now()),
    }));
  } catch (cause) {
    throw new VerificationFailed(cause instanceof Error ? cause.message : "Token did not verify");
  }

  if (
    payload.iat === undefined ||
    payload.exp === undefined ||
    payload.exp - payload.iat > input.lifetime
  )
    throw new VerificationFailed("Token lifetime exceeds the contract");

  if (!Value.Check(input.schema, payload))
    throw new VerificationFailed("Token claims do not match the contract");

  return payload;
}

export async function createProof(input: {
  readonly key: PrivateJwk;
  readonly issuer: string;
  readonly audience: string;
  readonly method: ProofClaims["htm"];
  readonly path: string;
  readonly body: string;
  readonly now?: number;
}): Promise<string> {
  const iat = nowSeconds(input.now);
  const claims: ProofClaims = {
    iss: input.issuer,
    aud: input.audience,
    iat,
    exp: iat + PROOF_LIFETIME_SECONDS,
    jti: randomId(),
    htm: input.method,
    htu: input.path,
    bh: await sha256(input.body),
  };

  return signClaims({ key: input.key, typ: TOKEN_TYPES.proof, claims });
}

export async function verifyProof(input: {
  readonly token: string;
  readonly key: PublicJwk;
  readonly issuer: string;
  readonly audience: string;
  readonly method: ProofClaims["htm"];
  readonly path: string;
  readonly body: string;
  readonly now?: number;
}): Promise<ProofClaims> {
  const claims = await verifyClaims({
    token: input.token,
    key: input.key,
    typ: TOKEN_TYPES.proof,
    issuer: input.issuer,
    audience: input.audience,
    schema: ProofClaims,
    lifetime: PROOF_LIFETIME_SECONDS,
    now: input.now,
  });

  if (claims.htm !== input.method || claims.htu !== input.path)
    throw new VerificationFailed("Proof names another request");

  if (claims.bh !== (await sha256(input.body)))
    throw new VerificationFailed("Proof names another body");

  return claims;
}

export function brokerKey(keys: BrokerKeys, token: string): PublicJwk | undefined {
  const kid = tokenKeyId(token);
  const key = keys.keys.find((entry) => entry.kid === kid);

  return key === undefined ? undefined : { kty: "OKP", crv: "Ed25519", x: key.x };
}
