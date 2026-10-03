/**
 * Worker bindings and their parsed form. Every string is checked on each
 * request; a bad value fails the request closed and logs only its name.
 */
import { Base64Url32, isBrokerOrigin } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { D1Database } from "./d1.ts";
import type { RelayNamespace } from "./relay-stub.ts";

export interface Env {
  readonly DB: D1Database;
  /** One relay Durable Object per environment, named by the environment id. */
  readonly RELAY: RelayNamespace;
  /** The broker's own origin: proofs, Clerk `aud`, token issuer, and relay addresses. */
  readonly CONNECT_ORIGIN: string;
  /** The exact Clerk `iss`, such as `https://clerk.example.com`. */
  readonly CLERK_ISSUER: string;
  /** Comma-separated `azp` values a session token may carry. Native sessions carry none. */
  readonly CLERK_AUTHORIZED_PARTIES: string;
  /** Clerk's PEM public key, for offline session verification. */
  readonly CLERK_JWT_KEY: string;
  /** Clerk Backend API key, for owner lookups and session revocation. */
  readonly CLERK_SECRET_KEY: string;
  readonly CLERK_WEBHOOK_SIGNING_SECRET: string;
  /** JSON array of Ed25519 private JWKs with `kid`. The first signs; all are published. */
  readonly BROKER_SIGNING_KEYS: string;
}

export const SigningKey = Type.Object({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
  d: Base64Url32,
  kid: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._-]+$" }),
});

export type SigningKey = Static<typeof SigningKey>;

const SigningKeys = Type.Array(SigningKey, { minItems: 1, maxItems: 4 });

export interface Config {
  readonly origin: string;
  readonly clerk: {
    readonly issuer: string;
    readonly jwtKey: string;
    readonly secretKey: string;
    readonly authorizedParties: readonly string[];
    readonly webhookSecret: string;
  };
  readonly signing: {
    readonly active: SigningKey;
    readonly all: readonly SigningKey[];
  };
}

const SECRET_TEXT = /^[\x21-\x7e]{16,4096}$/u;

function parseSigningKeys(text: string): SigningKey[] | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!Value.Check(SigningKeys, parsed)) return undefined;
  const kids = new Set(parsed.map((key) => key.kid));

  return kids.size === parsed.length ? parsed : undefined;
}

/** The names of the bindings that failed, or the parsed configuration. */
export function parseConfig(env: Env): Config | { readonly invalid: readonly string[] } {
  const invalid: string[] = [];
  const check = (name: keyof Env, ok: boolean) => {
    if (!ok) invalid.push(name);
  };

  check("CONNECT_ORIGIN", isBrokerOrigin(env.CONNECT_ORIGIN));
  check("CLERK_ISSUER", isBrokerOrigin(env.CLERK_ISSUER));
  check("CLERK_JWT_KEY", env.CLERK_JWT_KEY.includes("-----BEGIN PUBLIC KEY-----"));
  check("CLERK_SECRET_KEY", SECRET_TEXT.test(env.CLERK_SECRET_KEY));
  check("CLERK_WEBHOOK_SIGNING_SECRET", env.CLERK_WEBHOOK_SIGNING_SECRET.startsWith("whsec_"));
  const keys = parseSigningKeys(env.BROKER_SIGNING_KEYS);
  const active = keys?.[0];

  check("BROKER_SIGNING_KEYS", active !== undefined);

  if (invalid.length > 0 || keys === undefined || active === undefined) return { invalid };

  return {
    origin: env.CONNECT_ORIGIN,
    clerk: {
      issuer: env.CLERK_ISSUER,
      jwtKey: env.CLERK_JWT_KEY,
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: env.CLERK_AUTHORIZED_PARTIES.split(",")
        .map((party) => party.trim())
        .filter((party) => party.length > 0),
      webhookSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
    },
    signing: { active, all: keys },
  };
}
