import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ENROLLMENT_LIFETIME_SECONDS,
  EnrollEnvelope,
  EnrollmentClaims,
  LEASE_LIFETIME_SECONDS,
  LeaseClaims,
  LeaseResponse,
  LinkResponse,
  TOKEN_TYPES,
  randomUserCode,
} from "@nyte-ai/connect";
import type { BrokerKeys, PublicJwk } from "@nyte-ai/connect";
import {
  brokerKey,
  createProof,
  generateMachineKey,
  keyThumbprint,
  toPublicJwk,
  randomId,
  sha256,
  signClaims,
  verifyClaims,
} from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";
import { SignJWT, decodeJwt, exportSPKI, generateKeyPair } from "jose";
import { Value } from "typebox/value";
import { relayRefusal } from "@nyte-ai/connect/relay";
import { vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { createBroker } from "../src/broker.ts";
import { parseConfig } from "../src/config.ts";
import type { Config, Env } from "../src/config.ts";
import type { D1Database } from "../src/d1.ts";
import { RelayAdmission } from "../src/environment-api.ts";
import type { EnvironmentApi, EnvironmentNamespace } from "../src/environment-api.ts";
import { EnvironmentRecord } from "../src/environment-record.ts";
import type { DurableObjectSql, Effect, Outcome } from "../src/environment-record.ts";
import type { Logger, LogFields } from "../src/log.ts";
import {
  RELAY_HEADERS,
  RELAY_INTERNAL_ORIGIN,
  RELAY_OPERATIONS,
  bearerToken,
} from "../src/relay-stub.ts";
import { FakeClerkApi } from "./clerk-fake.ts";
import { doSqlStub } from "./do-sql-stub.ts";

export const ORIGIN = "https://connect.test.example";
export const ISSUER = "https://clerk.test.example";
export const AZP = "https://app.test.example";
const TABLES = [
  "link_transactions",
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

export class FakeDesktop {
  readonly key: PrivateJwk;
  environmentId = "";
  owner = "";
  mode: DesktopMode = "ok";
  readonly recorded: EnrollmentClaims[] = [];
  readonly consumed = new Set<string>();
  beforeReceipt: (() => Promise<void>) | undefined;

  constructor(key: PrivateJwk) {
    this.key = key;
  }

  get publicKey(): PublicJwk {
    return toPublicJwk(this.key);
  }

  async handle(text: string, keys: BrokerKeys): Promise<Response> {
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
    });

    if (grant.sub !== this.owner || this.consumed.has(grant.jti))
      return Response.json({}, { status: 409 });
    this.consumed.add(grant.jti);
    this.recorded.push(grant);
    await this.beforeReceipt?.();
    const iat = Math.floor(Date.now() / 1000);
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

export class FakeRelay {
  readonly calls: RelayCall[] = [];
  readonly desktops = new Map<string, FakeDesktop>();
  readonly connected = new Set<string>();
  readonly storages = new Map<string, DurableObjectSql>();
  readonly directory: D1Database;
  private readonly records = new Map<string, EnvironmentRecord>();
  private readonly keys: BrokerKeys;
  private readonly input: {
    readonly config: () => Config;
    readonly log: Logger;
  };

  constructor(input: {
    readonly keys: BrokerKeys;
    readonly directory: D1Database;
    readonly config: () => Config;
    readonly log: Logger;
  }) {
    this.keys = input.keys;
    this.directory = input.directory;
    this.input = input;
  }

  namespace(): EnvironmentNamespace {
    return { getByName: (name) => this.stub(name) };
  }

  reset(): void {
    this.calls.length = 0;
    this.desktops.clear();
    this.connected.clear();
    this.records.clear();
    this.storages.clear();
  }

  rows(table: "devices" | "outbox" | "proofs"): unknown[] {
    return [...this.storages].flatMap(([environmentId, storage]) =>
      storage.sql
        .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", table)
        .toArray().length === 0
        ? []
        : storage.sql.exec(`SELECT ?1 AS environment_id, * FROM ${table}`, environmentId).toArray(),
    );
  }

  private record(name: string): EnvironmentRecord {
    const existing = this.records.get(name);

    if (existing !== undefined) return existing;
    const storage = doSqlStub();
    const record = new EnvironmentRecord({
      id: name,
      storage,
      directory: this.directory,
      config: this.input.config(),
      log: this.input.log,
      exchange: async (request) => {
        this.calls.push({
          operation: RELAY_OPERATIONS.forward,
          environmentId: name,
          deviceId: null,
          path: request.path,
        });
        const desktop = this.desktops.get(name);

        if (desktop === undefined) throw new Error("The desktop is not connected");

        return desktop.handle(request.body, this.keys);
      },
    });

    this.records.set(name, record);
    this.storages.set(name, storage);

    return record;
  }

  private stub(name: string): EnvironmentApi {
    const run = async <T>(
      operation: (record: EnvironmentRecord) => Promise<Outcome<T>> | Outcome<T>,
    ) => {
      const record = this.record(name);
      let outcome: Outcome<T>;

      try {
        outcome = await operation(record);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "The relay failed");
      }

      for (const effect of outcome.effects) this.calls.push(this.effectCall(name, effect));
      await record.drain();

      return structuredClone(outcome.answer);
    };

    return {
      lease: (proof) => run((record) => record.lease(structuredClone(proof))),
      enroll: (input) => run((record) => record.enroll(structuredClone(input))),
      release: (input) => run((record) => record.release(structuredClone(input))),
      revokeDevice: (input) => run((record) => record.revokeDevice(structuredClone(input))),
      revoke: (actor) => run((record) => record.revoke(structuredClone(actor))),
      status: async (ownerId) =>
        structuredClone(this.record(name).status(ownerId, this.connected.has(name))),
      setOwner: async (standing) => {
        await run((record) => record.setOwner(structuredClone(standing)));
      },
      fetch: (request) => this.fetch(name, request),
    };
  }

  private effectCall(environmentId: string, effect: Effect): RelayCall {
    switch (effect.kind) {
      case "end-device":
        return {
          operation: RELAY_OPERATIONS.reset,
          environmentId,
          deviceId: effect.deviceId,
          path: null,
        };
      case "end-channels":
        return { operation: RELAY_OPERATIONS.reset, environmentId, deviceId: null, path: null };
      case "close":
        return { operation: "/revoke", environmentId, deviceId: null, path: null };
      default: {
        const _exhaustive: never = effect;

        return _exhaustive;
      }
    }
  }

  private async fetch(name: string, request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.origin !== RELAY_INTERNAL_ORIGIN)
      throw new Error("The broker addressed a relay wrongly");

    if (url.pathname === RELAY_OPERATIONS.reset) {
      this.calls.push({ operation: url.pathname, environmentId: name, deviceId: null, path: null });

      return new Response(null, { status: 204 });
    }

    if (url.pathname !== RELAY_OPERATIONS.forward)
      throw new Error(`The fake relay has no ${url.pathname}`);
    const path = request.headers.get(RELAY_HEADERS.path);
    const admitted = await this.record(name).admit({
      bearer: bearerToken(request.headers),
      admission: Value.Parse(RelayAdmission, request.headers.get(RELAY_HEADERS.admission)),
    });

    if (!admitted.ok) return relayRefusal(admitted.code);
    this.calls.push({
      operation: url.pathname,
      environmentId: name,
      deviceId: admitted.deviceId ?? null,
      path,
    });

    return this.desktops.has(name) ? relayRefusal("not_found") : relayRefusal("closed");
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
  release(
    desktop: FakeDesktop,
    input: { readonly deviceId: string; readonly environmentId?: string; readonly body?: string },
  ): Promise<Answer>;
  removeEnvironment(actor: Actor, environmentId: string): Promise<Answer>;
  openTransaction(input: {
    readonly desktop: FakeDesktop;
    readonly name?: string;
    readonly operationId?: string;
    readonly userCode?: string;
  }): Promise<{ readonly answer: Answer; readonly operationId: string; readonly userCode: string }>;
  lookupTransaction(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly userCode: string;
  }): Promise<Answer>;
  decideTransaction(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly transactionId: string;
    readonly decision: "approve" | "deny";
    readonly fingerprint?: string;
  }): Promise<Answer>;
  transactionCall(input: {
    readonly desktop: FakeDesktop;
    readonly transactionId: string;
    readonly step: "poll" | "complete" | "cancel";
  }): Promise<Answer>;
  webhook(
    event: unknown,
    input?: { readonly secret?: string; readonly timestamp?: number },
  ): Promise<Answer>;
  sweep(): Promise<void>;
  rows(table: (typeof TABLES)[number] | "devices" | "outbox" | "proofs"): Promise<unknown[]>;
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
  const migrations = new URL("../migrations/", import.meta.url);

  for (const file of readdirSync(migrations).toSorted()) {
    const migration = readFileSync(new URL(file, migrations), "utf8");
    await db.batch(unstable_splitSqlQuery(migration).map((statement) => db.prepare(statement)));
  }
  const clerkKeys = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const brokerSigningKey = { ...(await generateMachineKey()), kid: "broker-test-1" };
  const clerkSecretKey = `sk_test_${random()}`;
  const webhookSecret = `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`;
  const brokerKeys: BrokerKeys = {
    keys: [{ kty: "OKP", crv: "Ed25519", x: brokerSigningKey.x, kid: brokerSigningKey.kid }],
  };
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  let offset = 0;
  const clock = {
    get offsetMs() {
      return offset;
    },
    set offsetMs(value: number) {
      vi.setSystemTime(Date.now() - offset + value);
      offset = value;
    },
  };
  const now = () => Date.now();
  const logs: LogEntry[] = [];
  const record =
    (level: string) =>
    (event: string, fields: LogFields = {}) => {
      logs.push({ level, event, fields });
    };
  const log: Logger = { info: record("info"), warn: record("warn"), error: record("error") };
  const relay = new FakeRelay({
    keys: brokerKeys,
    directory: {
      prepare: (query) => db.prepare(query),
      batch: (statements) => db.batch(statements),
    },
    log,
    config: () => {
      const config = parseConfig(env);

      if ("invalid" in config) throw new Error(`Invalid test config: ${config.invalid.join(",")}`);

      return config;
    },
  });
  const env: Env = {
    DB: db,
    RELAY: relay.namespace(),
    CONNECT_ORIGIN: ORIGIN,
    CONNECT_WEB_ORIGINS: AZP,
    CLERK_ISSUER: ISSUER,
    CLERK_AUTHORIZED_PARTIES: AZP,
    CLERK_JWT_KEY: await exportSPKI(clerkKeys.publicKey),
    CLERK_SECRET_KEY: clerkSecretKey,
    CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
    BROKER_SIGNING_KEYS: JSON.stringify([brokerSigningKey]),
  };
  const clerkApi = new FakeClerkApi(clerkSecretKey);
  const egress: string[] = [];
  const broker = createBroker({
    log,
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

  const proof: Harness["proof"] = (input) => createProof({ ...input, audience: ORIGIN });

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
      vi.useRealTimers();
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

    async openTransaction(input) {
      const operationId = input.operationId ?? randomId();
      const userCode =
        input.userCode ?? randomUserCode((count) => crypto.getRandomValues(new Uint8Array(count)));
      const body = JSON.stringify({
        publicKey: input.desktop.publicKey,
        name: input.name ?? "Build box",
        operationId,
        userCode,
      });
      const answer = await send({
        method: "POST",
        path: "/v1/link-transactions",
        headers: {
          "content-type": "application/json",
          "nyte-proof": await proof({
            key: input.desktop.key,
            issuer: await keyThumbprint(input.desktop.publicKey),
            method: "POST",
            path: "/v1/link-transactions",
            body,
          }),
        },
        body,
      });

      return { answer, operationId, userCode };
    },

    async lookupTransaction(input) {
      const body = JSON.stringify({ userCode: input.userCode });

      return send({
        method: "POST",
        path: "/v1/link-transactions/lookup",
        headers: {
          authorization: `Bearer ${await sessionToken({ userId: input.userId, sessionId: input.sessionId })}`,
          "content-type": "application/json",
        },
        body,
      });
    },

    async decideTransaction(input) {
      const fingerprint = input.fingerprint ?? "0000-0000-0000-0000";
      const body = input.decision === "approve" ? JSON.stringify({ fingerprint }) : "";

      return send({
        method: "POST",
        path: `/v1/link-transactions/${input.transactionId}/${input.decision}`,
        headers: {
          authorization: `Bearer ${await sessionToken({ userId: input.userId, sessionId: input.sessionId })}`,
          ...(body === "" ? {} : { "content-type": "application/json" }),
        },
        ...(body === "" ? {} : { body }),
      });
    },

    async transactionCall(input) {
      const method = input.step === "cancel" ? "DELETE" : "POST";
      const path =
        input.step === "cancel"
          ? `/v1/link-transactions/${input.transactionId}`
          : `/v1/link-transactions/${input.transactionId}/${input.step}`;

      return send({
        method,
        path,
        headers: {
          "nyte-proof": await proof({
            key: input.desktop.key,
            issuer: await keyThumbprint(input.desktop.publicKey),
            method,
            path,
            body: "",
          }),
        },
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
      if (table === "devices" || table === "outbox" || table === "proofs") return relay.rows(table);

      return (await db.prepare(`SELECT * FROM ${table}`).all()).results;
    },
  };

  return harness;
}

export function read(value: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => field(current, key), value);
}
