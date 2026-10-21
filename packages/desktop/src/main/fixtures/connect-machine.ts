import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { ConnectView, HostEvent } from "@nyte-ai/app/bridge.ts";
import {
  BROKER_ROUTES,
  DESKTOP_ROUTES,
  LinkRequest,
  PROOF_HEADER,
  ReceiptClaims,
  TOKEN_TYPES,
  relayAddress,
} from "@nyte-ai/connect";
import type {
  BrokerKeys,
  EnrollmentClaims,
  ErrorCode,
  LeaseClaims,
  PublicJwk,
} from "@nyte-ai/connect";
import { RELAY_CLOSE } from "@nyte-ai/connect/relay";
import type { RelayMethod } from "@nyte-ai/connect/relay";
import {
  PrivateJwk,
  generateMachineKey,
  keyThumbprint,
  nowSeconds,
  publicKeySet,
  randomId,
  sha256,
  signClaims,
  verifyClaims,
  verifyProof,
} from "@nyte-ai/connect/signing";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DesktopHost } from "../host.ts";
import { testDesktop } from "./desktop-host.ts";
import { AccountCancelled } from "../account-session.ts";
import type { AccountSession, AccountState } from "../account-session.ts";
import type { ConnectConfig } from "../connect-config.ts";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import type { ConnectTiming, LinkAuthorizer } from "@nyte-ai/connect/host";
import { RelayServer } from "./relay-server.ts";

export const ORIGIN = "https://connect.nyte.test";

export const OWNER = { id: "user_fixture", label: "ada@example.test" } as const;

export function sessionJwt(sub: string): string {
  const part = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ sub, sid: randomId() })}.${randomId()}`;
}

export const SESSION_JWT = sessionJwt(OWNER.id);

export const CONFIG: ConnectConfig = {
  origin: ORIGIN,
  clerk: { publishableKey: "pk_test_Y2xlcmsubnl0ZS50ZXN0JA", frontendApiHost: "clerk.nyte.test" },
};

const cleanups: (() => Promise<void> | void)[] = [];

export async function cleanUp(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
}

class FixtureAccount implements AccountSession {
  token = SESSION_JWT;
  requests = 0;
  focused = 0;
  hold = false;
  closed = 0;

  focus(): void {
    this.focused += 1;
  }

  requestSessionToken(input: { readonly signal: AbortSignal }): Promise<string> {
    this.requests += 1;

    if (!this.hold) return Promise.resolve(this.token);

    return new Promise((_, reject) => {
      input.signal.addEventListener("abort", () => reject(new AccountCancelled()), { once: true });
    });
  }

  state(): AccountState {
    return { kind: "signed_in", label: OWNER.label };
  }

  async signOut(): Promise<void> {}

  async close(): Promise<void> {
    this.closed += 1;
  }
}

interface BrokerEnvironment {
  readonly id: string;
  readonly publicKey: PublicJwk;
  readonly thumbprint: string;
  removed: boolean;
}

type LeaseMode = "ok" | "offline" | "owner_disabled";

export type LeaseCraft = (input: {
  readonly req: string;
  readonly claims: LeaseClaims;
}) => Promise<string>;

function refusal(status: number, code: ErrorCode): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

class Broker {
  readonly signing: PrivateJwk;
  readonly keys: BrokerKeys;
  relay: RelayServer | undefined;
  env: BrokerEnvironment | undefined;
  readonly envs = new Map<string, BrokerEnvironment>();
  readonly active = new Set<string>();
  generation = 1;
  policy = 1;
  leaseMode: LeaseMode = "ok";
  leaseAge = 0;
  craft: LeaseCraft | undefined;
  offline = false;
  removalOffline = false;
  readonly sessions = new Set([SESSION_JWT]);
  readonly revokedKeys = new Set<string>();
  linkGate: Promise<void> | undefined;
  holdNextLease: Promise<void> | undefined;
  readonly calls: string[] = [];
  readonly bearers: string[] = [];
  readonly leases: string[] = [];
  private readonly proofs = new Set<string>();

  private constructor(signing: PrivateJwk) {
    this.signing = signing;
    this.keys = publicKeySet([signing]);
  }

  static async create(): Promise<Broker> {
    return new Broker({ ...(await generateMachineKey()), kid: "broker-1" });
  }

  count(call: string): number {
    return this.calls.filter((entry) => entry === call).length;
  }

  readonly relayAuth = async (input: {
    readonly environmentId: string;
    readonly proof: string;
  }): Promise<number | undefined> => {
    const env = this.envs.get(input.environmentId);

    if (env === undefined) return RELAY_CLOSE.unauthorized;

    try {
      const claims = await verifyProof({
        token: input.proof,
        key: env.publicKey,
        issuer: env.id,
        audience: ORIGIN,
        method: "GET",
        path: BROKER_ROUTES.relay(env.id),
        body: "",
      });

      if (this.proofs.has(claims.jti)) return RELAY_CLOSE.unauthorized;
      this.proofs.add(claims.jti);
    } catch {
      return RELAY_CLOSE.unauthorized;
    }

    return env.removed ? RELAY_CLOSE.revoked : undefined;
  };

  readonly fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const call = new Request(input, init);
    const url = new URL(call.url);
    assert.equal(url.origin, ORIGIN);
    this.calls.push(`${call.method} ${url.pathname}`);
    const authorization = call.headers.get("authorization");

    if (authorization !== null) this.bearers.push(`${url.pathname} ${authorization}`);

    if (this.offline) throw new TypeError("fetch failed");
    const routed = this.route(call, url.pathname);
    routed.catch(() => undefined);
    const { signal } = call;

    return Promise.race([
      routed,
      new Promise<never>((_, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));

        if (signal.aborted) abort();
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  };

  private async verified(
    call: Request,
    path: string,
    body: string,
    env: BrokerEnvironment,
  ): Promise<string | undefined> {
    const proof = call.headers.get(PROOF_HEADER);

    if (proof === null) return undefined;

    try {
      const method = call.method === "DELETE" ? "DELETE" : "POST";

      const claims = await verifyProof({
        token: proof,
        key: env.publicKey,
        issuer: env.id,
        audience: ORIGIN,
        method,
        path,
        body,
      });

      if (this.proofs.has(claims.jti)) return undefined;
      this.proofs.add(claims.jti);

      return claims.jti;
    } catch {
      return undefined;
    }
  }

  private async route(call: Request, path: string): Promise<Response> {
    const body = call.method === "GET" ? "" : await call.text();

    if (path === BROKER_ROUTES.keys) return Response.json(this.keys);

    if (path === BROKER_ROUTES.environments && call.method === "POST") {
      const parsed: unknown = JSON.parse(body);

      if (!Value.Check(LinkRequest, parsed)) return refusal(400, "invalid");
      const thumbprint = await keyThumbprint(parsed.publicKey);
      const proof = call.headers.get(PROOF_HEADER) ?? "";
      await verifyProof({
        token: proof,
        key: parsed.publicKey,
        issuer: thumbprint,
        audience: ORIGIN,
        method: "POST",
        path,
        body,
      });
      const bearer = call.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";

      if (!this.sessions.has(bearer)) return refusal(401, "unauthorized");

      if (this.revokedKeys.has(thumbprint)) return refusal(410, "revoked");
      const resumed = [...this.envs.values()].find((entry) => entry.thumbprint === thumbprint);
      this.env = resumed ?? {
        id: randomUUID(),
        publicKey: parsed.publicKey,
        thumbprint,
        removed: false,
      };
      this.envs.set(this.env.id, this.env);
      await this.linkGate;

      return Response.json(
        {
          environment: { id: this.env.id, name: parsed.name },
          owner: OWNER,
          brokerKeys: this.keys,
        },
        { status: 201 },
      );
    }

    const env = this.envs.get(/^\/v1\/environments\/([0-9a-f-]{36})/u.exec(path)?.[1] ?? "");

    if (env === undefined) return refusal(404, "not_found");
    const jti = await this.verified(call, path, body, env);

    if (jti === undefined) return refusal(401, "unauthorized");

    if (env.removed) return refusal(410, "revoked");

    if (path === BROKER_ROUTES.lease(env.id)) {
      if (this.leaseMode === "offline") throw new TypeError("fetch failed");

      if (this.leaseMode === "owner_disabled") return refusal(403, "owner_disabled");
      const iat = nowSeconds() - this.leaseAge;

      const claims = {
        iss: ORIGIN,
        aud: env.id,
        sub: OWNER.id,
        iat,
        exp: iat + 60,
        req: jti,
        generation: this.generation,
        policy: this.policy,
        devices: [...this.active],
      };

      const hold = this.holdNextLease;
      this.holdNextLease = undefined;
      await hold;

      const lease =
        this.craft === undefined
          ? await signClaims({ key: this.signing, typ: TOKEN_TYPES.lease, claims })
          : await this.craft({ req: jti, claims });

      this.leases.push(lease);

      return Response.json({ lease });
    }

    if (path === BROKER_ROUTES.environment(env.id) && call.method === "DELETE") {
      if (this.removalOffline) throw new TypeError("fetch failed");
      env.removed = true;

      if (env === this.env) this.active.clear();

      return new Response(null, { status: 204 });
    }

    const device = /\/devices\/([0-9a-f-]{36})$/u.exec(path)?.[1];

    if (device !== undefined && call.method === "DELETE") {
      if (this.active.delete(device)) this.policy += 1;

      return new Response(null, { status: 204 });
    }

    const released = /\/devices\/([0-9a-f-]{36})\/release$/u.exec(path)?.[1];

    if (released !== undefined && call.method === "POST") {
      if (body !== "{}") return refusal(400, "invalid");

      if (this.active.delete(released)) this.policy += 1;

      return new Response(null, { status: 204 });
    }

    return refusal(404, "not_found");
  }

  async grant(input: {
    readonly token: string;
    readonly clientId?: string;
    readonly deviceId?: string;
    readonly change?: Partial<EnrollmentClaims>;
    readonly key?: PrivateJwk;
  }): Promise<{ readonly deviceId: string; readonly authorization: string }> {
    const env = this.env;
    assert.ok(env, "not linked");
    const deviceId = input.deviceId ?? randomUUID();
    const iat = nowSeconds();

    const authorization = await signClaims({
      key: input.key ?? this.signing,
      typ: TOKEN_TYPES.enrollment,
      claims: {
        iss: ORIGIN,
        aud: env.id,
        sub: OWNER.id,
        iat,
        exp: iat + 60,
        jti: randomId(),
        nonce: randomId(),
        generation: this.generation,
        deviceId,
        clientId: input.clientId ?? `client-${randomBytes(8).toString("hex")}`,
        clientName: "iPhone",
        digest: await sha256(input.token),
        ...input.change,
      },
    });

    return { deviceId, authorization };
  }

  async enrollRoute(input: {
    readonly method?: RelayMethod;
    readonly contentType?: string;
    readonly body?: string;
  }): Promise<{ readonly status: number; readonly body: string }> {
    assert.ok(this.relay);

    const response = await this.relay.exchange({
      method: input.method ?? "POST",
      path: DESKTOP_ROUTES.enroll,
      headers: { "content-type": input.contentType ?? "application/json" },
      body: input.body === undefined ? undefined : new TextEncoder().encode(input.body),
    });

    return { status: response.status, body: await response.text() };
  }

  async enroll(
    authorization: string,
    deviceId: string,
    options: { readonly activate?: boolean } = {},
  ): Promise<{ readonly status: number; readonly body: string }> {
    const env = this.env;
    assert.ok(env, "not linked");
    const answer = await this.enrollRoute({ body: JSON.stringify({ authorization }) });

    if (answer.status !== 200) return answer;
    const { receipt } = JSON.parse(answer.body);

    const claims = await verifyClaims({
      token: receipt,
      key: env.publicKey,
      typ: TOKEN_TYPES.receipt,
      issuer: env.id,
      audience: ORIGIN,
      schema: ReceiptClaims,
      lifetime: 60,
    });

    assert.equal(claims.deviceId, deviceId);

    if (options.activate !== false && !this.active.has(deviceId)) {
      this.active.add(deviceId);
      this.policy += 1;
    }

    return answer;
  }

  async phone(clientId?: string): Promise<{ readonly token: string; readonly deviceId: string }> {
    const token = randomBytes(32).toString("base64url");
    const { deviceId, authorization } = await this.grant({ token, clientId });
    const answer = await this.enroll(authorization, deviceId);
    assert.equal(answer.status, 200, answer.body);

    return { token, deviceId };
  }
}

export interface Fixture {
  readonly root: string;
  readonly state: string;
  readonly account: FixtureAccount;
  readonly broker: Broker;
  readonly relay: RelayServer;
}

export async function fixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-connect-")));
  cleanups.push(async () => {
    await chmod(join(root, "state"), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const broker = await Broker.create();
  const relay = await RelayServer.start({ origin: ORIGIN, authenticate: broker.relayAuth });
  cleanups.push(() => relay.stop());
  broker.relay = relay;

  return { root, state, account: new FixtureAccount(), broker, relay };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DROP_DELAY_MS = 50;

export const releaseDropped = () => sleep(DROP_DELAY_MS);

const FAST: Partial<ConnectTiming> = {
  heartbeatMs: 150,
  retryMs: 100,
  dropDelayMs: DROP_DELAY_MS,
  relay: { retryMinMs: 20, retryMaxMs: 100 },
};

interface Desktop {
  readonly host: DesktopHost;
  readonly runtime: ConnectRuntime;
  readonly events: HostEvent[];
}

const sessionAuthorizer = (account: AccountSession | undefined): LinkAuthorizer | undefined =>
  account === undefined ? undefined : { kind: "session", account };

export async function desktop(
  setup: Fixture,
  options: {
    readonly timing?: Partial<ConnectTiming>;
    readonly config?: ConnectConfig | undefined;
    readonly account?: AccountSession | undefined;
  } = {},
): Promise<Desktop> {
  vi.stubEnv("NYTE_HOME", setup.state);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(setup.root, "claude"));
  vi.stubEnv("CODEX_HOME", join(setup.root, "codex"));
  const events: HostEvent[] = [];

  const runtime = new ConnectRuntime({
    config: "config" in options ? options.config : CONFIG,
    home: setup.state,
    authorizer: sessionAuthorizer("account" in options ? options.account : setup.account),
    onChange: () => events.push({ kind: "remote_access_changed" }),
    name: "Fixture Mac",
    fetch: setup.broker.fetch,
    dial: setup.relay.dial,
    timing: { ...FAST, ...options.timing },
  });

  const made = await testDesktop({
    connect: runtime,
    emitHostEvent: (event) => events.push(event),
  });

  const { host } = made;
  cleanups.push(() => made.close());

  return { host, runtime, events };
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

export async function view(host: DesktopHost): Promise<ConnectView> {
  return host.call(1, "host.connect.state", undefined);
}

export async function linked(host: DesktopHost): Promise<Linked> {
  const current = await view(host);
  assert.equal(current.kind, "linked");

  if (current.kind !== "linked") throw new Error("not linked");

  return current;
}

export async function serve(desktop: Desktop): Promise<Linked> {
  const afterLink = await desktop.host.call(1, "host.connect.link", undefined);
  assert.equal(afterLink.kind, "linked");
  await desktop.host.call(1, "host.connect.setEnabled", { enabled: true });

  return vi.waitFor(async () => {
    const current = await linked(desktop.host);
    assert.equal(current.connection.kind, "connected");
    assert.equal(current.lease.kind, "current");

    return current;
  });
}

export function address(setup: Fixture): string {
  assert.ok(setup.broker.env);

  return relayAddress(ORIGIN, setup.broker.env.id);
}

export function phoneFetch(
  setup: Fixture,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return setup.relay.fetch(`${address(setup)}${path}`, init);
}

export async function info(
  setup: Fixture,
  token: string | undefined,
): Promise<{ readonly status: number; readonly code: string | undefined }> {
  const headers = new Headers({ "content-type": "application/json" });

  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

  const response = await phoneFetch(setup, "/sessions.list", {
    method: "POST",
    headers,
    body: "{}",
  });

  const body: unknown = await response.json();
  const code = Value.Check(Type.Object({ code: Type.String() }), body) ? body.code : undefined;

  return { status: response.status, code };
}

export async function watch(
  setup: Fixture,
  _host: DesktopHost,
  token: string,
): Promise<{ readonly ended: Promise<string> }> {
  const response = await phoneFetch(setup, "/connection.watch", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();

  const ended = (async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read());
  })().then(
    () => "ended",
    () => "ended",
  );

  return { ended };
}

export async function forget(setup: Fixture, bearer: string | undefined): Promise<number> {
  const response = await phoneFetch(setup, DESKTOP_ROUTES.device, {
    method: "DELETE",
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });

  return response.status;
}

export async function relayGone(setup: Fixture): Promise<void> {
  await vi.waitFor(() => assert.equal(setup.relay.connected(), undefined));
  const auths = setup.relay.auths;
  await sleep(250);
  assert.equal(setup.relay.connected(), undefined);
  assert.equal(setup.relay.auths, auths);
}

export async function stored(setup: Fixture): Promise<string> {
  return readFile(join(setup.state, "connect.json"), "utf8");
}

export const denied = { status: 403, code: "denied" } as const;

export const allowed = { status: 200, code: undefined } as const;
