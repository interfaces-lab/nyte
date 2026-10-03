/**
 * A broker over a real local D1 (wrangler's platform proxy), real jose
 * signatures, and a generated Clerk RSA key, run in Node with an injected
 * clock. Only the outside world is fake: the Clerk Backend API, and each
 * environment's relay, which answers enrollments as its desktop would and
 * records resets and revocations. The real relay runs in `relay.test.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_ROUTES,
  ENROLLMENT_LIFETIME_SECONDS,
  EnrollEnvelope,
  EnrollmentClaims,
  LEASE_LIFETIME_SECONDS,
  LeaseClaims,
  LeaseResponse,
  LinkResponse,
  TOKEN_TYPES,
} from "@nyte-ai/connect";
import type { BrokerKeys, PublicJwk } from "@nyte-ai/connect";
import {
  brokerKey,
  createProof,
  generateMachineKey,
  keyThumbprint,
  publicKeyOf,
  randomId,
  sha256,
  signClaims,
  verifyClaims,
} from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";
import { SignJWT, decodeJwt, exportSPKI, generateKeyPair } from "jose";
import { Value } from "typebox/value";
import { relayRefusal } from "@nyte-ai/connect/relay";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { createBroker } from "../src/broker.ts";
import type { Env } from "../src/config.ts";
import type { D1Database } from "../src/d1.ts";
import type { LogFields } from "../src/log.ts";
import { RELAY_HEADERS, RELAY_INTERNAL_ORIGIN, RELAY_OPERATIONS } from "../src/relay-stub.ts";
import type { RelayNamespace } from "../src/relay-stub.ts";
import { FakeClerkApi } from "./clerk-fake.ts";

export const ORIGIN = "https://connect.test.example";
export const ISSUER = "https://clerk.test.example";
export const AZP = "https://app.test.example";
const TABLES = [
  "devices",
  "environments",
  "owners",
  "denied_sessions",
  "proof_replays",
  "rate_limits",
] as const;

const random = (bytes = 24) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");

type RsaKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;
}

export type DesktopMode =
  | "ok"
  | "down"
  | "refuse"
  | "foreign-key"
  | "wrong-nonce"
  | "wrong-digest"
  | "huge";

/** A desktop on its relay: holds the machine key and answers enrollments. */
export class FakeDesktop {
  readonly key: PrivateJwk;
  environmentId = "";
  owner = "";
  mode: DesktopMode = "ok";
  readonly recorded: EnrollmentClaims[] = [];
  readonly consumed = new Set<string>();
  /** Runs after the desktop records an enrollment and before it answers. */
  beforeReceipt: (() => Promise<void>) | undefined;

  constructor(key: PrivateJwk) {
    this.key = key;
  }

  get publicKey(): PublicJwk {
    return publicKeyOf(this.key);
  }

  async handle(text: string, keys: BrokerKeys, now: () => number): Promise<Response> {
    if (this.mode === "down") return relayRefusal("closed");

    if (this.mode === "refuse") return Response.json({}, { status: 403 });

    if (this.mode === "huge") return new Response("x".repeat(100_000), { status: 200 });
    const body = parse(text);

    if (!Value.Check(EnrollEnvelope, body)) return Response.json({}, { status: 400 });
    const key = brokerKey(keys, body.authorization);

    if (key === undefined) return Response.json({}, { status: 401 });
    const grant = await verifyClaims({
      token: body.authorization,
      key,
      typ: TOKEN_TYPES.enrollment,
      issuer: ORIGIN,
      audience: this.environmentId,
      schema: EnrollmentClaims,
      lifetime: ENROLLMENT_LIFETIME_SECONDS,
      now: now(),
    });

    if (grant.sub !== this.owner || this.consumed.has(grant.jti))
      return Response.json({}, { status: 409 });
    this.consumed.add(grant.jti);
    this.recorded.push(grant);
    await this.beforeReceipt?.();
    const iat = Math.floor(now() / 1000);
    const signer = this.mode === "foreign-key" ? await generateMachineKey() : this.key;
    const receipt = await signClaims({
      key: signer,
      typ: TOKEN_TYPES.receipt,
      claims: {
        iss: this.environmentId,
        aud: ORIGIN,
        iat,
        exp: iat + ENROLLMENT_LIFETIME_SECONDS,
        req: grant.jti,
        nonce: this.mode === "wrong-nonce" ? randomId() : grant.nonce,
        deviceId: grant.deviceId,
        digest: this.mode === "wrong-digest" ? await sha256("other") : grant.digest,
      },
    });

    return Response.json({ receipt });
  }
}

export interface RelayCall {
  readonly operation: string;
  readonly environmentId: string;
  readonly deviceId: string | null;
  readonly path: string | null;
}

/**
 * Every environment's relay as the broker sees it: enrollments reach the
 * environment's desktop, and resets and revocations are recorded.
 */
export class FakeRelay {
  readonly calls: RelayCall[] = [];
  readonly desktops = new Map<string, FakeDesktop>();
  private readonly keys: BrokerKeys;
  private readonly now: () => number;

  constructor(input: { keys: BrokerKeys; now: () => number }) {
    this.keys = input.keys;
    this.now = input.now;
  }

  namespace(): RelayNamespace {
    return { getByName: (name) => ({ fetch: (request) => this.handle(name, request) }) };
  }

  reset(): void {
    this.calls.length = 0;
    this.desktops.clear();
  }

  private async handle(name: string, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const environmentId = request.headers.get(RELAY_HEADERS.environment) ?? "";

    if (url.origin !== RELAY_INTERNAL_ORIGIN || environmentId !== name)
      throw new Error("The broker addressed a relay wrongly");
    this.calls.push({
      operation: url.pathname,
      environmentId,
      deviceId: request.headers.get(RELAY_HEADERS.device),
      path: request.headers.get(RELAY_HEADERS.path),
    });

    if (url.pathname !== RELAY_OPERATIONS.forward) return new Response(null, { status: 204 });
    const desktop = this.desktops.get(environmentId);

    if (desktop === undefined) return relayRefusal("closed");

    if (request.headers.get(RELAY_HEADERS.path) !== DESKTOP_ROUTES.enroll)
      return relayRefusal("not_found");

    return desktop.handle(await request.text(), this.keys, this.now);
  }
}

export interface LogEntry {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields;
}

export interface Answer {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
  readonly headers: Headers;
}

export type Actor =
  | { readonly as: "owner"; readonly userId: string; readonly sessionId?: string }
  | { readonly as: "desktop"; readonly desktop: FakeDesktop };

export interface Harness {
  readonly db: D1Database;
  readonly env: Env;
  readonly secrets: readonly string[];
  readonly relay: FakeRelay;
  readonly clerkApi: FakeClerkApi;
  readonly logs: LogEntry[];
  /** Every URL the broker fetched. */
  readonly egress: string[];
  readonly clock: { offsetMs: number };
  readonly brokerKeys: BrokerKeys;
  now(): number;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  send(input: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly env?: Partial<Env>;
  }): Promise<Answer>;
  sessionToken(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly claims?: Record<string, unknown>;
    readonly omit?: readonly string[];
    readonly key?: RsaKey;
    readonly lifetimeSeconds?: number;
  }): Promise<string>;
  proof(input: {
    readonly key: PrivateJwk;
    readonly issuer: string;
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly body: string;
  }): Promise<string>;
  newDesktop(): Promise<FakeDesktop>;
  link(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly desktop?: FakeDesktop;
    readonly name?: string;
  }): Promise<{
    readonly answer: Answer;
    readonly desktop: FakeDesktop;
    readonly link?: LinkResponse;
  }>;
  lease(
    desktop: FakeDesktop,
  ): Promise<{ readonly answer: Answer; readonly claims?: LeaseClaims; readonly jti: string }>;
  enroll(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly environmentId: string;
    readonly clientId?: string;
    readonly digest?: string;
  }): Promise<Answer>;
  removeDevice(
    actor: Actor,
    input: { readonly environmentId: string; readonly deviceId: string },
  ): Promise<Answer>;
  /** The desktop relays a phone's own release of its device. */
  release(
    desktop: FakeDesktop,
    input: { readonly deviceId: string; readonly environmentId?: string; readonly body?: string },
  ): Promise<Answer>;
  removeEnvironment(actor: Actor, environmentId: string): Promise<Answer>;
  webhook(
    event: unknown,
    input?: { readonly secret?: string; readonly timestamp?: number },
  ): Promise<Answer>;
  sweep(): Promise<void>;
  rows(table: (typeof TABLES)[number]): Promise<unknown[]>;
}

async function webhookSignature(input: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(input.secret.replace(/^whsec_/u, ""), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.body}`),
  );

  return `v1,${Buffer.from(signature).toString("base64")}`;
}

export async function createHarness(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    envFiles: [],
    remoteBindings: false,
  });
  const db = proxy.env.DB;
  const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

  await db.batch(unstable_splitSqlQuery(migration).map((statement) => db.prepare(statement)));
  const clerkKeys = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const brokerSigningKey = { ...(await generateMachineKey()), kid: "broker-test-1" };
  const clerkSecretKey = `sk_test_${random()}`;
  const webhookSecret = `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`;
  const brokerKeys: BrokerKeys = {
    keys: [{ kty: "OKP", crv: "Ed25519", x: brokerSigningKey.x, kid: brokerSigningKey.kid }],
  };
  const clock = { offsetMs: 0 };
  const now = () => Date.now() + clock.offsetMs;
  const relay = new FakeRelay({ keys: brokerKeys, now });
  const env: Env = {
    DB: db,
    RELAY: relay.namespace(),
    CONNECT_ORIGIN: ORIGIN,
    CLERK_ISSUER: ISSUER,
    CLERK_AUTHORIZED_PARTIES: AZP,
    CLERK_JWT_KEY: await exportSPKI(clerkKeys.publicKey),
    CLERK_SECRET_KEY: clerkSecretKey,
    CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
    BROKER_SIGNING_KEYS: JSON.stringify([brokerSigningKey]),
  };
  const clerkApi = new FakeClerkApi(clerkSecretKey);
  const logs: LogEntry[] = [];
  const egress: string[] = [];
  const record =
    (level: string) =>
    (event: string, fields: LogFields = {}) => {
      logs.push({ level, event, fields });
    };
  const broker = createBroker({
    now,
    log: { info: record("info"), warn: record("warn"), error: record("error") },
    fetch: async (input, init) => {
      egress.push(input);
      const url = new URL(input);

      if (url.origin === "https://api.clerk.com") return clerkApi.handle(url, init);

      throw new TypeError(`Unexpected egress to ${url.origin}`);
    },
  });
  const pending: Promise<unknown>[] = [];
  const execution = { waitUntil: (task: Promise<unknown>) => void pending.push(task) };
  const settle = async () => {
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
  };

  const send: Harness["send"] = async (input) => {
    const response = await broker.fetch(
      new Request(`${ORIGIN}${input.path}`, {
        method: input.method,
        headers: input.headers,
        body: input.body,
      }),
      { ...env, ...input.env },
      execution,
    );

    await settle();
    const text = await response.text();

    return { status: response.status, text, body: parse(text), headers: response.headers };
  };

  const sessionToken: Harness["sessionToken"] = async (input) => {
    const iat = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: ISSUER,
      sub: input.userId,
      sid: input.sessionId ?? `sess_${input.userId}`,
      aud: ORIGIN,
      sts: "active",
      v: 2,
      iat,
      nbf: iat - 5,
      exp: iat + (input.lifetimeSeconds ?? 60),
      ...input.claims,
    };

    for (const name of input.omit ?? []) delete claims[name];

    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "ins_test", typ: "JWT" })
      .sign(input.key ?? clerkKeys.privateKey);
  };

  const proof: Harness["proof"] = (input) =>
    createProof({ ...input, audience: ORIGIN, now: now() });

  const actorHeaders = async (
    actor: Actor,
    input: { method: "DELETE"; path: string },
  ): Promise<Record<string, string>> =>
    actor.as === "owner"
      ? {
          authorization: `Bearer ${await sessionToken({ userId: actor.userId, sessionId: actor.sessionId })}`,
        }
      : {
          "nyte-proof": await proof({
            key: actor.desktop.key,
            issuer: actor.desktop.environmentId,
            method: input.method,
            path: input.path,
            body: "",
          }),
        };

  const harness: Harness = {
    db,
    env,
    secrets: [clerkSecretKey, webhookSecret, brokerSigningKey.d, webhookSecret.slice(6)],
    relay,
    clerkApi,
    logs,
    egress,
    clock,
    brokerKeys,
    now,
    send,
    sessionToken,
    proof,

    async reset() {
      await db.batch(TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));
      relay.reset();
      clerkApi.reset();
      logs.length = 0;
      egress.length = 0;
      clock.offsetMs = 0;
    },

    async dispose() {
      await proxy.dispose();
    },

    async newDesktop() {
      return new FakeDesktop(await generateMachineKey());
    },

    async link(input) {
      if (!clerkApi.users.has(input.userId))
        clerkApi.users.set(input.userId, {
          banned: false,
          locked: false,
          updated_at: 1,
          email: `${input.userId}@example.com`,
        });
      const desktop = input.desktop ?? (await harness.newDesktop());
      const body = JSON.stringify({
        publicKey: desktop.publicKey,
        name: input.name ?? "Studio Mac",
      });
      const answer = await send({
        method: "POST",
        path: "/v1/environments",
        headers: {
          authorization: `Bearer ${await sessionToken({ userId: input.userId, sessionId: input.sessionId })}`,
          "content-type": "application/json",
          "nyte-proof": await proof({
            key: desktop.key,
            issuer: await keyThumbprint(desktop.publicKey),
            method: "POST",
            path: "/v1/environments",
            body,
          }),
        },
        body,
      });

      if (answer.status !== 201 || !Value.Check(LinkResponse, answer.body))
        return { answer, desktop };
      desktop.environmentId = answer.body.environment.id;
      desktop.owner = answer.body.owner.id;
      relay.desktops.set(desktop.environmentId, desktop);

      return { answer, desktop, link: answer.body };
    },

    async lease(desktop) {
      const path = `/v1/environments/${desktop.environmentId}/lease`;
      const token = await proof({
        key: desktop.key,
        issuer: desktop.environmentId,
        method: "POST",
        path,
        body: "{}",
      });
      const jti = decodeJwt(token).jti ?? "";
      const answer = await send({
        method: "POST",
        path,
        headers: { "content-type": "application/json", "nyte-proof": token },
        body: "{}",
      });

      if (answer.status !== 200 || !Value.Check(LeaseResponse, answer.body)) return { answer, jti };
      const key = brokerKey(brokerKeys, answer.body.lease);

      if (key === undefined) throw new Error("Lease names an unknown broker key");
      const claims = await verifyClaims({
        token: answer.body.lease,
        key,
        typ: TOKEN_TYPES.lease,
        issuer: ORIGIN,
        audience: desktop.environmentId,
        schema: LeaseClaims,
        lifetime: LEASE_LIFETIME_SECONDS,
        now: now(),
      });

      return { answer, claims, jti };
    },

    async enroll(input) {
      const body = JSON.stringify({
        clientId: input.clientId ?? "phone-install-0001",
        clientName: "Pocket",
        digest: input.digest ?? (await sha256(random(32))),
      });

      return send({
        method: "POST",
        path: `/v1/environments/${input.environmentId}/devices`,
        headers: {
          authorization: `Bearer ${await sessionToken({ userId: input.userId, sessionId: input.sessionId })}`,
          "content-type": "application/json",
        },
        body,
      });
    },

    async removeDevice(actor, input) {
      const path = `/v1/environments/${input.environmentId}/devices/${input.deviceId}`;

      return send({
        method: "DELETE",
        path,
        headers: await actorHeaders(actor, { method: "DELETE", path }),
      });
    },

    async release(desktop, input) {
      const path = `/v1/environments/${input.environmentId ?? desktop.environmentId}/devices/${input.deviceId}/release`;
      const body = input.body ?? "{}";

      return send({
        method: "POST",
        path,
        headers: {
          "content-type": "application/json",
          "nyte-proof": await proof({
            key: desktop.key,
            issuer: desktop.environmentId,
            method: "POST",
            path,
            body,
          }),
        },
        body,
      });
    },

    async removeEnvironment(actor, environmentId) {
      const path = `/v1/environments/${environmentId}`;

      return send({
        method: "DELETE",
        path,
        headers: await actorHeaders(actor, { method: "DELETE", path }),
      });
    },

    async webhook(event, input = {}) {
      const body = JSON.stringify(event);
      const id = `msg_${random(12)}`;
      const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);

      return send({
        method: "POST",
        path: "/v1/clerk/webhook",
        headers: {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": String(timestamp),
          "svix-signature": await webhookSignature({
            secret: input.secret ?? webhookSecret,
            id,
            timestamp,
            body,
          }),
        },
        body,
      });
    },

    async sweep() {
      await broker.scheduled(undefined, env, execution);
      await settle();
    },

    async rows(table) {
      return (await db.prepare(`SELECT * FROM ${table}`).all()).results;
    },
  };

  return harness;
}

/** A field of an unknown JSON value, for assertions. */
export function read(value: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => field(current, key), value);
}
