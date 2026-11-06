import { Base64Url32, namesBrokerOrigin } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { D1Database } from "./d1.ts";
import type { EnvironmentNamespace } from "./environment-api.ts";

export interface Env {
  readonly DB: D1Database;
  readonly RELAY: EnvironmentNamespace;
  readonly CONNECT_ORIGIN: string;
  readonly CONNECT_WEB_ORIGINS: string;
  readonly CLERK_ISSUER: string;
  readonly CLERK_AUTHORIZED_PARTIES: string;
  readonly CLERK_JWT_KEY: string;
  readonly CLERK_SECRET_KEY: string;
  readonly CLERK_WEBHOOK_SIGNING_SECRET: string;
  readonly BROKER_SIGNING_KEYS: string;
}

const SigningKey = Type.Object({
  kty: Type.Literal("OKP"),
  crv: Type.Literal("Ed25519"),
  x: Base64Url32,
  d: Base64Url32,
  kid: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._-]+$" }),
});

type SigningKey = Static<typeof SigningKey>;

const SigningKeys = Type.Array(SigningKey, { minItems: 1, maxItems: 4 });

export interface Config {
  readonly origin: string;
  readonly webOrigins: readonly string[];
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

export function parseWebOrigins(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const origins = value.split(",").map((origin) => origin.trim());

  if (value === "") return [];

  for (const origin of origins) {
    if (namesBrokerOrigin(origin)) continue;
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      return undefined;
    }

    if (
      url.protocol !== "http:" ||
      !(url.hostname === "localhost" || url.hostname === "127.0.0.1") ||
      url.username !== "" ||
      url.password !== "" ||
      url.origin !== origin
    )
      return undefined;
  }

  return new Set(origins).size === origins.length ? origins : undefined;
}

export function parseConfig(env: Env): Config | { readonly invalid: readonly string[] } {
  const invalid: string[] = [];
  const check = (name: keyof Env, ok: boolean) => {
    if (!ok) invalid.push(name);
  };

  const webOrigins = parseWebOrigins(env.CONNECT_WEB_ORIGINS);
  check("CONNECT_WEB_ORIGINS", webOrigins !== undefined);
  check("CONNECT_ORIGIN", namesBrokerOrigin(env.CONNECT_ORIGIN));
  check("CLERK_ISSUER", namesBrokerOrigin(env.CLERK_ISSUER));
  check("CLERK_JWT_KEY", env.CLERK_JWT_KEY.includes("-----BEGIN PUBLIC KEY-----"));
  check("CLERK_SECRET_KEY", SECRET_TEXT.test(env.CLERK_SECRET_KEY));
  check("CLERK_WEBHOOK_SIGNING_SECRET", env.CLERK_WEBHOOK_SIGNING_SECRET.startsWith("whsec_"));
  const keys = parseSigningKeys(env.BROKER_SIGNING_KEYS);
  const active = keys?.[0];

  check("BROKER_SIGNING_KEYS", active !== undefined);

  if (invalid.length > 0 || keys === undefined || active === undefined || webOrigins === undefined)
    return { invalid };

  return {
    origin: env.CONNECT_ORIGIN,
    webOrigins,
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
