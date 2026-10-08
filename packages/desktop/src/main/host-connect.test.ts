/**
 * Account remote access end to end on this machine: the real host, its real
 * loopback listener and relay connection, a `ws` stand-in for the broker's
 * relay, and an in-process broker that verifies every proof and signs every
 * lease and enrollment with real Ed25519 keys. Phones reach the desktop only
 * through that relay, as they do in production. Only the sign-in dialog and the
 * broker's network are replaced; nothing bypasses a
 * signature or the server's own auth.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient } from "@nyte-ai/client";
import { environmentId } from "@nyte-ai/host";
import type { Api, Model } from "@nyte-ai/schema";
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
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { AccountCancelled } from "./account-session.ts";
import type { AccountSession, AccountState } from "./account-session.ts";
import { readConnectConfig } from "./connect-config.ts";
import type { ConnectConfig } from "./connect-config.ts";
import { connectRouteHandler } from "@nyte-ai/connect/host";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import type { ConnectTiming, LinkAuthorizer } from "@nyte-ai/connect/host";
import { RelayServer } from "./fixtures/relay-server.ts";

const ORIGIN = "https://connect.nyte.test";

const OWNER = { id: "user_fixture", label: "ada@example.test" } as const;

/** Session-JWT shaped; only the broker would verify it. */
function sessionJwt(sub: string): string {
  const part = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ sub, sid: randomId() })}.${randomId()}`;
}

const SESSION_JWT = sessionJwt(OWNER.id);

const CONFIG: ConnectConfig = {
  origin: ORIGIN,
  clerk: { publishableKey: "pk_test_Y2xlcmsubnl0ZS50ZXN0JA", frontendApiHost: "clerk.nyte.test" },
};

const model: Model<Api> = {
  id: "echo",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const failing: Provider["stream"] = () => {
  throw new Error("No provider in the connect test");
};

function localModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });

  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: failing,
    streamSimple: failing,
  });

  return models;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// The sign-in dialog: the external boundary
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The broker and its relay
// ---------------------------------------------------------------------------

interface BrokerEnvironment {
  readonly id: string;
  readonly publicKey: PublicJwk;
  readonly thumbprint: string;
  removed: boolean;
}

type LeaseMode = "ok" | "offline" | "owner_disabled";

type LeaseCraft = (input: {
  readonly req: string;
  readonly claims: LeaseClaims;
}) => Promise<string>;

function refusal(status: number, code: ErrorCode): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

class Broker {
  readonly signing: PrivateJwk;
  readonly keys: BrokerKeys;
  /** Where the broker reaches desktops; set once the fixture starts it. */
  relay: RelayServer | undefined;
  /** The latest environment linked; earlier ones stay in `envs`. */
  env: BrokerEnvironment | undefined;
  readonly envs = new Map<string, BrokerEnvironment>();
  readonly active = new Set<string>();
  generation = 1;
  policy = 1;
  leaseMode: LeaseMode = "ok";
  /** Seconds a signed lease is already old, so it expires that much sooner. */
  leaseAge = 0;
  craft: LeaseCraft | undefined;
  /** Every call fails as if the network were down. */
  offline = false;
  /** Only removing an environment fails as if the network were down. */
  removalOffline = false;
  /** Session JWTs the broker accepts. */
  readonly sessions = new Set([SESSION_JWT]);
  /** Machine-key thumbprints the broker has tombstoned. */
  readonly revokedKeys = new Set<string>();
  linkGate: Promise<void> | undefined;
  /** Holds the next lease answer, already snapshotted, until it resolves. */
  holdNextLease: Promise<void> | undefined;
  readonly calls: string[] = [];
  /** `Authorization` headers the broker saw, by path. */
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

  /** The relay's check of a desktop's first frame: a fresh proof for this environment's relay path. */
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
    // Like a real fetch, an abort rejects at once; the broker may still finish its side.
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
      // Committed before answering, so an answer lost to a cancel leaves the environment behind.
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

  /** What the broker would sign for a phone that sent `token`'s digest. */
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

  /** The broker's own relayed call to the desktop's enroll route. */
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

  /** Send a grant through the relay; on a valid receipt, activate the device unless told not to. */
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

  /** A phone enrolled and activated, with its own bearer token. */
  async phone(clientId?: string): Promise<{ readonly token: string; readonly deviceId: string }> {
    const token = randomBytes(32).toString("base64url");
    const { deviceId, authorization } = await this.grant({ token, clientId });
    const answer = await this.enroll(authorization, deviceId);
    assert.equal(answer.status, 200, answer.body);

    return { token, deviceId };
  }
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

interface Fixture {
  readonly root: string;
  readonly state: string;
  readonly account: FixtureAccount;
  readonly broker: Broker;
  readonly relay: RelayServer;
}

async function fixture(): Promise<Fixture> {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FAST: Partial<ConnectTiming> = {
  heartbeatMs: 150,
  retryMs: 100,
  dropDelayMs: 50,
  relay: { retryMinMs: 20, retryMaxMs: 100 },
};

interface Desktop {
  readonly host: DesktopHost;
  readonly runtime: ConnectRuntime;
  readonly events: HostEvent[];
}

const sessionAuthorizer = (account: AccountSession | undefined): LinkAuthorizer | undefined =>
  account === undefined ? undefined : { kind: "session", account };

async function desktop(
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

  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: localModels,
    appVersion: "test",
    connect: runtime,
    emitHostEvent: (event) => events.push(event),
    emitWatchEvent: () => undefined,
    openExternal: () => undefined,
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    confirmExternal: () => Promise.resolve("cancel"),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser is not used by connect tests");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      find: () => Promise.resolve({ active: 0, total: 0 }),
      cancelDownload: () => undefined,
      login: () => undefined,
      history: async () => [],
      forgetHistory: async () => undefined,
      focusPage: () => undefined,
      settingsChanged: () => undefined,
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      releaseWindow: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });

  cleanups.push(() => host.close());

  return { host, runtime, events };
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

async function view(host: DesktopHost): Promise<ConnectView> {
  return host.call(1, "host.connect.state", undefined);
}

async function linked(host: DesktopHost): Promise<Linked> {
  const current = await view(host);
  assert.equal(current.kind, "linked");

  if (current.kind !== "linked") throw new Error("not linked");

  return current;
}

/** Link, turn on, and wait for a connected relay and a current lease. */
async function serve(desktop: Desktop): Promise<Linked> {
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

/** Where phones reach the linked environment. */
function address(setup: Fixture): string {
  assert.ok(setup.broker.env);

  return relayAddress(ORIGIN, setup.broker.env.id);
}

/** A phone request through the relay. */
function phoneFetch(setup: Fixture, path: string, init: RequestInit = {}): Promise<Response> {
  return setup.relay.fetch(`${address(setup)}${path}`, init);
}

async function info(
  setup: Fixture,
  token: string | undefined,
): Promise<{ readonly status: number; readonly code: string | undefined }> {
  const response = await phoneFetch(setup, "/v1/info", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

  const body: unknown = await response.json();

  const code = Value.Check(Type.Object({ error: Type.Object({ code: Type.String() }) }), body)
    ? body.error.code
    : undefined;

  return { status: response.status, code };
}

/** A live watch for `token` through the relay; `ended` resolves once the desktop drops it. */
async function watch(
  setup: Fixture,
  host: DesktopHost,
  token: string,
): Promise<{ readonly ended: Promise<string> }> {
  const session = await host.call(1, "sessions.create", { name: "watched" });
  const client = createNyteClient({ baseUrl: address(setup), token, fetch: setup.relay.fetch });
  const seen: string[] = [];

  const ended = (async () => {
    for await (const event of client.watch({ sessionId: session.sessionId, live: true })) {
      seen.push(event.kind);
    }
  })().then(
    () => "ended",
    () => "ended",
  );

  await vi.waitFor(() => assert.ok(seen.includes("synced")));

  return { ended };
}

/** A phone dropping its own credential. */
async function forget(setup: Fixture, bearer: string | undefined): Promise<number> {
  const response = await phoneFetch(setup, DESKTOP_ROUTES.device, {
    method: "DELETE",
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });

  return response.status;
}

/** No desktop holds the relay, and none comes back for a while. */
async function relayGone(setup: Fixture): Promise<void> {
  await vi.waitFor(() => assert.equal(setup.relay.connected(), undefined));
  const auths = setup.relay.auths;
  await sleep(250);
  assert.equal(setup.relay.connected(), undefined);
  assert.equal(setup.relay.auths, auths);
}

async function stored(setup: Fixture): Promise<string> {
  return readFile(join(setup.state, "connect.json"), "utf8");
}

const denied = { status: 403, code: "forbidden" } as const;

const allowed = { status: 200, code: undefined } as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test("a linked Mac serves only leased devices, and no session secret reaches disk or the renderer", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  const serving = await serve(desktop_);
  const { broker } = setup;

  assert.equal(serving.owner.id, OWNER.id);
  assert.equal(serving.enabled, true);
  assert.equal(serving.environment.address, address(setup));
  // Only the link carried the session JWT; the heartbeat and the relay sign with the machine key.
  assert.deepEqual(broker.bearers, [`${BROKER_ROUTES.environments} Bearer ${SESSION_JWT}`]);
  assert.equal(setup.relay.connected(), serving.environment.id);

  assert.deepEqual(await info(setup, undefined), { status: 401, code: "unauthorized" });
  assert.deepEqual(await info(setup, randomBytes(32).toString("base64url")), denied);
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);

  const file = await stored(setup);
  assert.equal((await stat(join(setup.state, "connect.json"))).mode & 0o777, 0o600);
  const parsed = JSON.parse(file);
  assert.equal(file.includes(SESSION_JWT), false);
  assert.equal(file.includes(phone.token), false);
  assert.deepEqual(parsed.link.environment, { id: serving.environment.id, name: "Fixture Mac" });
  assert.ok(Value.Check(PrivateJwk, parsed.link.key));
  assert.equal(await keyThumbprint(parsed.link.key), broker.env?.thumbprint);
  assert.equal(parsed.link.devices[0].digest, await sha256(phone.token));

  const after = await linked(desktop_.host);
  assert.deepEqual(
    after.devices.map((device) => [device.id, device.authorized]),
    [[phone.deviceId, true]],
  );
  const renderer = JSON.stringify([after, desktop_.events]);

  for (const hidden of [SESSION_JWT, phone.token, parsed.link.key.d])
    assert.equal(renderer.includes(hidden), false);
  assert.ok(desktop_.events.some((event) => event.kind === "remote_access_changed"));
  assert.deepEqual(setup.relay.violations, []);
});

test("a phone's first request after enrolling waits for one fresh lease instead of being refused", async () => {
  const setup = await fixture();
  // A slow heartbeat, so only the readiness refresh can bring the new device in.
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const leases = setup.broker.count(`POST ${BROKER_ROUTES.lease(setup.broker.env?.id ?? "")}`);

  const phone = await setup.broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  const lease = `POST ${BROKER_ROUTES.lease(setup.broker.env?.id ?? "")}`;
  assert.equal(setup.broker.count(lease), leases + 1);

  // Recorded but never activated: one shared refresh, then refused; no refresh again for 30 s.
  const token = randomBytes(32).toString("base64url");
  const grant = await setup.broker.grant({ token });
  assert.equal(
    (await setup.broker.enroll(grant.authorization, grant.deviceId, { activate: false })).status,
    200,
  );
  const answers = await Promise.all([info(setup, token), info(setup, token), info(setup, token)]);
  assert.deepEqual(answers, [denied, denied, denied]);
  assert.equal(setup.broker.count(lease), leases + 2);
  assert.deepEqual(await info(setup, token), denied);
  assert.equal(setup.broker.count(lease), leases + 2);
});

test("a device the broker activates after a lease was snapshotted gets in on a lease asked for after its request", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 300 } });
  await serve(desktop_);
  const { broker } = setup;
  const lease = `POST ${BROKER_ROUTES.lease(broker.env?.id ?? "")}`;
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });

  // Recorded here, not yet active at the broker; a lease asked for after that still omits it.
  assert.equal(
    (await broker.enroll(grant.authorization, grant.deviceId, { activate: false })).status,
    200,
  );
  const recorded = broker.count(lease);
  await vi.waitFor(() => assert.ok(broker.count(lease) >= recorded + 2));
  // The next answer is snapshotted without the device and held in flight.
  const held = Promise.withResolvers<void>();
  broker.holdNextLease = held.promise;
  const before = broker.count(lease);
  await vi.waitFor(() => assert.equal(broker.count(lease), before + 1));

  // The broker activates it and answers the phone, whose first request arrives now.
  broker.active.add(grant.deviceId);
  broker.policy += 1;
  const began = Date.now();
  assert.deepEqual(await info(setup, token), allowed);
  assert.ok(Date.now() - began < 2_000, "the request waited on the stale lease");

  // The older answer lands last and changes nothing.
  held.resolve();
  await vi.waitFor(() => assert.ok(broker.count(lease) >= before + 3));
  assert.deepEqual(await info(setup, token), allowed);
});

test("showing the sign-in dialog while a link waits on it does not replace that request", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  setup.account.hold = true;
  const waiting = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(setup.account.requests, 1));

  await host.call(1, "host.connect.openAccount", undefined);
  assert.equal(setup.account.focused, 1);
  assert.equal(setup.account.requests, 1);
  const current = await view(host);
  assert.ok(current.kind === "unlinked" && current.linking.kind === "waiting_for_account");

  await host.call(1, "host.connect.cancel", undefined);
  assert.equal((await waiting).kind, "unlinked");
});

test("a readiness refresh that fails may be tried again within the phone's retry window", async () => {
  const setup = await fixture();

  const desktop_ = await desktop(setup, {
    timing: { heartbeatMs: 60_000, retryMs: 60_000, readinessRetryMs: 100 },
  });

  await serve(desktop_);
  const { broker } = setup;

  broker.leaseMode = "offline";
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), denied);
  broker.leaseMode = "ok";
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(await info(setup, phone.token), allowed);
});

test("devices the broker no longer has active are forgotten once their grant could not still land", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const { broker } = setup;
  const stale = randomBytes(32).toString("base64url");
  const staleGrant = await broker.grant({ token: stale });
  assert.equal(
    (await broker.enroll(staleGrant.authorization, staleGrant.deviceId, { activate: false }))
      .status,
    200,
  );
  const kept = await broker.phone();
  await first.host.close();

  // Recorded two minutes ago in an earlier run; the broker never activated it.
  const path = join(setup.state, "connect.json");
  const file = JSON.parse(await readFile(path, "utf8"));

  for (const device of file.link.devices)
    if (device.id === staleGrant.deviceId) device.createdAt = Date.now() - 120_000;
  await writeFile(path, JSON.stringify(file));
  const fresh = randomBytes(32).toString("base64url");

  const second = await desktop(setup);
  await second.host.autostartConnect(1);
  await vi.waitFor(async () => assert.deepEqual(await info(setup, kept.token), allowed));
  const freshGrant = await broker.grant({ token: fresh });
  assert.equal(
    (await broker.enroll(freshGrant.authorization, freshGrant.deviceId, { activate: false }))
      .status,
    200,
  );

  await vi.waitFor(async () =>
    assert.deepEqual(
      JSON.parse(await stored(setup)).link.devices.map((device: { id: string }) => device.id),
      [kept.deviceId, freshGrant.deviceId],
    ),
  );
  assert.deepEqual(await info(setup, stale), denied);
});

test("after a restart a recorded device is refused until a lease verifies", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const phone = await setup.broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  await first.host.close();
  await relayGone(setup);

  setup.broker.leaseMode = "offline";
  const second = await desktop(setup);
  await second.host.autostartConnect(1);
  await vi.waitFor(async () =>
    assert.equal((await linked(second.host)).connection.kind, "connected"),
  );
  // The relay is up on the machine key alone, and nobody gets in.
  assert.equal((await linked(second.host)).lease.kind, "pending");
  assert.deepEqual(await info(setup, phone.token), denied);

  setup.broker.leaseMode = "ok";
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
});

test("a lease that drops a device ends its streams; one that lapses ends everyone's", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const revoked = await broker.phone();
  const kept = await broker.phone();
  const { ended: revokedWatch } = await watch(setup, desktop_.host, revoked.token);
  const { ended: keptWatch } = await watch(setup, desktop_.host, kept.token);
  const auths = setup.relay.auths;

  // Revoked from the phone's account, at the broker; the desktop hears it in the next lease.
  broker.active.delete(revoked.deviceId);
  broker.policy += 1;
  assert.equal(await revokedWatch, "ended");
  assert.equal(await keptWatch, "ended");
  assert.deepEqual(await info(setup, revoked.token), denied);
  assert.deepEqual(await info(setup, kept.token), allowed);

  // Leases signed 58 s ago lapse within 2 s once the broker stops answering. A newer policy
  // orders them after the fresh ones, as any device change at the broker would.
  broker.leaseAge = 58;
  broker.policy += 1;
  await vi.waitFor(async () => {
    const current = await linked(desktop_.host);
    assert.ok(current.lease.kind === "current" && current.lease.expiresAt < Date.now() + 2_500);
  });
  const { ended: lapsing } = await watch(setup, desktop_.host, kept.token);
  broker.leaseMode = "offline";
  const began = Date.now();
  assert.equal(await lapsing, "ended");
  assert.ok(Date.now() - began < 3_000, "the stream outlived its lease");
  assert.deepEqual((await linked(desktop_.host)).lease, { kind: "lapsed", reason: "offline" });
  assert.deepEqual(await info(setup, kept.token), denied);

  // The same relay socket throughout.
  assert.equal(setup.relay.auths, auths);
  assert.equal(setup.relay.connected(), broker.env?.id);
  assert.deepEqual(setup.relay.violations, []);
});

test("replayed, older, or misaddressed leases never bring a dropped device back", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  const listing = broker.leases.at(-1);
  assert.ok(listing);
  const policyWithPhone = broker.policy;
  broker.active.delete(phone.deviceId);
  broker.policy += 1;
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), denied));
  const other = await generateMachineKey();
  const forged = { ...other, kid: "broker-1" };
  const lease = `POST ${BROKER_ROUTES.lease(broker.env?.id ?? "")}`;

  const crafts: readonly [string, LeaseCraft][] = [
    ["a replayed lease", async () => listing],
    [
      "a lower policy",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, policy: policyWithPhone, devices: [phone.deviceId] },
        }),
    ],
    [
      "an older generation",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, generation: 0, devices: [phone.deviceId] },
        }),
    ],
    [
      "another environment",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, aud: randomUUID(), policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "another owner",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, sub: "user_other", policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "a key that is not the broker's",
      ({ claims }) =>
        signClaims({
          key: forged,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "an enrollment presented as a lease",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.enrollment,
          claims: { ...claims, policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "another request's lease",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, req: randomId(), policy: 999, devices: [phone.deviceId] },
        }),
    ],
  ];

  for (const [name, craft] of crafts) {
    broker.craft = craft;
    const before = broker.count(lease);
    await vi.waitFor(() => assert.ok(broker.count(lease) >= before + 2, name));
    assert.deepEqual(await info(setup, phone.token), denied, name);
  }
});

test("the enroll route takes only a fresh, signed grant for this environment", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });

  const status = async (input: {
    readonly authorization?: string;
    readonly method?: RelayMethod;
    readonly contentType?: string;
    readonly body?: string;
  }) =>
    (
      await broker.enrollRoute({
        method: input.method,
        contentType: input.contentType,
        body:
          input.body ??
          (input.method === undefined
            ? JSON.stringify({ authorization: input.authorization ?? grant.authorization })
            : undefined),
      })
    ).status;

  assert.equal(await status({ method: "GET" }), 405);
  assert.equal(await status({ contentType: "text/plain" }), 415);
  assert.equal(await status({ body: "x".repeat(20_000) }), 413);
  assert.equal(await status({ body: JSON.stringify({ authorization: "a.b.c", extra: 1 }) }), 400);
  // Phones never reach it; only the broker relays it.
  assert.equal(
    (await phoneFetch(setup, DESKTOP_ROUTES.enroll, { method: "POST", body: "{}" })).status,
    404,
  );

  const forged = await broker.grant({
    token,
    key: { ...(await generateMachineKey()), kid: "broker-1" },
  });

  assert.equal(await status({ authorization: forged.authorization }), 401);
  const elsewhere = await broker.grant({ token, change: { aud: randomUUID() } });
  assert.equal(await status({ authorization: elsewhere.authorization }), 401);

  const stale = await broker.grant({
    token,
    change: { iat: nowSeconds() - 120, exp: nowSeconds() - 60 },
  });

  assert.equal(await status({ authorization: stale.authorization }), 401);
  const foreign = await broker.grant({ token, change: { sub: "user_other" } });
  assert.equal(await status({ authorization: foreign.authorization }), 403);
  const unsigned = `${grant.authorization.split(".").slice(0, 2).join(".")}.${"A".repeat(86)}`;
  assert.equal(await status({ authorization: unsigned }), 401);
  assert.equal((await linked(desktop_.host)).devices.length, 0);

  // Accepted once; the broker's retry gets a receipt again and records nothing new.
  assert.equal((await broker.enroll(grant.authorization, grant.deviceId)).status, 200);
  assert.equal((await broker.enroll(grant.authorization, grant.deviceId)).status, 200);
  assert.equal((await linked(desktop_.host)).devices.length, 1);
  assert.deepEqual(await info(setup, token), allowed);
  const sameDigest = await broker.grant({ token });
  assert.equal(await status({ authorization: sameDigest.authorization }), 409);

  // A replay after a revoke restores nothing.
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: grant.deviceId });
  assert.equal(await status({ authorization: grant.authorization }), 409);
  assert.deepEqual(await info(setup, token), denied);
  assert.equal((await linked(desktop_.host)).devices.length, 0);
  assert.equal(JSON.parse(await stored(setup)).link.devices.length, 0);
  assert.deepEqual(setup.relay.violations, []);
});

test("on the loopback listener the desktop routes refuse browsers, other hosts, and forwarded requests", async () => {
  let bound: string | undefined;
  const reached: string[] = [];

  const handle = connectRouteHandler({
    host: () => bound,
    enroll: async () => {
      reached.push("enroll");

      return { kind: "empty" };
    },
    forget: async () => {
      reached.push("forget");

      return { kind: "empty" };
    },
  });

  const status = async (headers: Record<string, string>, url = "http://127.0.0.1:4100") => {
    const response = await handle(
      new Request(`${url}${DESKTOP_ROUTES.device}`, {
        method: "DELETE",
        headers: { authorization: "Bearer device", ...headers },
      }),
    );

    return response?.status;
  };

  const host = { host: "127.0.0.1:4100" };

  assert.equal(await status(host), 403, "before the listener is bound");
  bound = "127.0.0.1:4100";
  assert.equal(await status({ ...host, origin: "http://127.0.0.1:4100" }), 403);
  assert.equal(await status({ host: "attacker.example" }), 403);
  assert.equal(await status({ host: "127.0.0.1:4101" }), 403);
  assert.equal(await status({ host: "localhost:4100" }), 403);
  assert.equal(await status(host, "http://attacker.example"), 403);
  assert.equal(await status({ ...host, forwarded: "host=attacker.example" }), 403);
  assert.equal(await status({ ...host, "x-forwarded-host": "127.0.0.1:4100" }), 403);
  assert.deepEqual(reached, []);
  assert.equal(await status(host), 204);
  assert.deepEqual(reached, ["forget"]);
});

test("a phone releases only itself, even before a lease lists it, without being signed out", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const env = broker.env;
  assert.ok(env);
  const kept = await broker.phone();
  const token = randomBytes(32).toString("base64url");
  const pending = await broker.grant({ token });
  assert.equal(
    (await broker.enroll(pending.authorization, pending.deviceId, { activate: false })).status,
    200,
  );

  assert.equal(await forget(setup, undefined), 401);
  assert.equal(await forget(setup, randomBytes(32).toString("base64url")), 403);
  assert.equal(await forget(setup, token), 204);
  assert.equal(await forget(setup, token), 403);

  const after = await linked(desktop_.host);
  assert.deepEqual(
    after.devices.map((device) => device.id),
    [kept.deviceId],
  );
  assert.deepEqual(await info(setup, kept.token), allowed);
  // A release, never the revocation that would sign the phone's account out.
  await vi.waitFor(() =>
    assert.ok(broker.calls.includes(`POST ${BROKER_ROUTES.release(env.id, pending.deviceId)}`)),
  );
  assert.equal(broker.count(`DELETE ${BROKER_ROUTES.device(env.id, pending.deviceId)}`), 0);
  await vi.waitFor(async () =>
    assert.deepEqual(JSON.parse(await stored(setup)).link.revocations, []),
  );

  // An active phone releasing itself loses its streams too, once its answer is out.
  const { ended: streaming } = await watch(setup, desktop_.host, kept.token);
  assert.equal(await forget(setup, kept.token), 204);
  assert.equal(await streaming, "ended");
  assert.deepEqual(await info(setup, kept.token), denied);
  await vi.waitFor(() => assert.equal(broker.active.has(kept.deviceId), false));
});

test("a local revoke refuses at once, stays queued while the broker is offline, and outranks a release", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const env = broker.env;
  assert.ok(env);
  const phone = await broker.phone();
  const released = await broker.phone();
  const { ended: streaming } = await watch(setup, desktop_.host, phone.token);

  const queued = async () =>
    JSON.parse(await stored(setup)).link.revocations.map(
      (entry: { deviceId: string; kind: string }) => [entry.deviceId, entry.kind],
    );

  broker.offline = true;
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: phone.deviceId });
  assert.equal(await streaming, "ended");
  assert.deepEqual(await info(setup, phone.token), denied);
  assert.equal(await forget(setup, released.token), 204);
  assert.deepEqual(await queued(), [
    [phone.deviceId, "revoke"],
    [released.deviceId, "release"],
  ]);
  // The user removing a device that released itself still signs its session out.
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: released.deviceId });
  assert.deepEqual(await queued(), [
    [phone.deviceId, "revoke"],
    [released.deviceId, "revoke"],
  ]);

  // Still listed by the broker's leases, still refused here.
  broker.offline = false;
  assert.deepEqual(await info(setup, phone.token), denied);
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: phone.deviceId });
  await vi.waitFor(async () => assert.deepEqual(await queued(), []));
  assert.equal(broker.active.has(phone.deviceId), false);
  assert.equal(broker.active.has(released.deviceId), false);
  assert.equal(broker.count(`POST ${BROKER_ROUTES.release(env.id, released.deviceId)}`), 0);
  assert.equal(broker.count(`DELETE ${BROKER_ROUTES.device(env.id, released.deviceId)}`), 1);
});

test("a store that cannot be written refuses everyone and stops serving", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  const { ended: streaming } = await watch(setup, desktop_.host, phone.token);

  await chmod(setup.state, 0o500);
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });
  const answer = await broker.enroll(grant.authorization, grant.deviceId);
  assert.equal(answer.status, 500);
  assert.equal(answer.body.includes("receipt"), false);
  assert.equal(await streaming, "ended");
  await relayGone(setup);
  assert.deepEqual(await view(desktop_.host), { kind: "unavailable", reason: "store_failed" });
  await assert.rejects(desktop_.host.call(1, "host.connect.setEnabled", { enabled: true }));
});

test("cancel, disable, and quit win over work still in flight", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  const { broker, account } = setup;
  const { host } = desktop_;

  account.hold = true;
  const waiting = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(async () => {
    const current = await view(host);
    assert.ok(current.kind === "unlinked" && current.linking.kind === "waiting_for_account");
  });
  await host.call(1, "host.connect.cancel", undefined);
  const cancelled = await waiting;
  assert.ok(cancelled.kind === "unlinked");
  assert.deepEqual(cancelled.linking, { kind: "failed", reason: "cancelled" });
  assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 0);

  // Cancelled while the broker answers: nothing links, and the next try resumes the same environment.
  account.hold = false;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const inFlight = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  assert.equal((await inFlight).kind, "unlinked");
  const firstEnvironment = broker.env?.id;
  broker.linkGate = undefined;
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.equal(broker.env?.id, firstEnvironment);

  // On and off at once: off wins, and nothing is left bound or running.
  const [on, off] = await Promise.allSettled([
    host.call(1, "host.connect.setEnabled", { enabled: true }),
    host.call(1, "host.connect.setEnabled", { enabled: false }),
  ]);

  assert.equal(on.status, "fulfilled");
  assert.equal(off.status, "fulfilled");
  const settled = await linked(host);
  assert.equal(settled.enabled, false);
  assert.deepEqual(settled.lease, { kind: "stopped" });
  assert.deepEqual(settled.connection, { kind: "stopped" });
  await relayGone(setup);

  // Quit while turning on: the relay is gone afterwards.
  const turning = host.call(1, "host.connect.setEnabled", { enabled: true }).catch(() => undefined);
  await host.close();
  await turning;
  await relayGone(setup);
  // Quitting is not unlinking.
  assert.equal(JSON.parse(await stored(setup)).link.environment.id, firstEnvironment);
  assert.equal(account.closed, 1);
});

test("a tombstoned key from an abandoned link is replaced, not retried forever", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const abandoned = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.ok(broker.env));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  await abandoned;
  broker.linkGate = undefined;
  assert.ok(broker.env);
  broker.revokedKeys.add(broker.env.thumbprint);

  const refused = await host.call(1, "host.connect.link", undefined);
  assert.ok(refused.kind === "unlinked" && refused.linking.kind === "failed");
  assert.equal(JSON.parse(await stored(setup)).linkKey, null);
  const relinked = await host.call(1, "host.connect.link", undefined);
  assert.equal(relinked.kind, "linked");
  assert.equal(broker.env.removed, false);
  assert.notEqual(broker.env.thumbprint, [...broker.revokedKeys][0]);
});

test("a link another account began is not resumed under this one", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker, account } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const abandoned = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.ok(broker.env));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  await abandoned;
  broker.linkGate = undefined;
  const first = broker.env;
  assert.ok(first);

  account.token = sessionJwt("user_other");
  broker.sessions.add(account.token);
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.notEqual(broker.env?.thumbprint, first.thumbprint);
});

test("full removal queues refuse new links and enrollments instead of dropping what is pending", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;

  const queued = async (): Promise<readonly string[]> =>
    JSON.parse(await stored(setup)).link.revocations.map((entry: { kind: string }) => entry.kind);

  // The broker cannot be told, so every removed device stays queued.
  broker.offline = true;
  let refusedAt: number | undefined;

  for (let round = 0; refusedAt === undefined && round < 80; round += 1) {
    const token = randomBytes(32).toString("base64url");
    const grant = await broker.grant({ token });
    const answer = await broker.enroll(grant.authorization, grant.deviceId, { activate: false });

    if (answer.status === 429) refusedAt = round;
    else await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: grant.deviceId });
  }

  assert.equal(refusedAt, 64);
  assert.deepEqual(
    await queued(),
    Array.from({ length: 64 }, () => "revoke"),
  );

  broker.offline = false;
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: randomUUID() });
  await vi.waitFor(async () => assert.deepEqual(await queued(), []), { timeout: 10_000 });
  assert.equal(broker.count(`DELETE ${BROKER_ROUTES.devices(broker.env?.id ?? "")}`), 0);
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
}, 60_000);

test("pending unlinks are kept until the broker confirms them, and a full queue holds new links back", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker, account } = setup;
  broker.removalOffline = true;
  const removed: string[] = [];

  for (let round = 0; round < 8; round += 1) {
    assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
    removed.push(broker.env?.id ?? "");
    await host.call(1, "host.connect.unlink", undefined);
  }

  const pending = async (): Promise<readonly string[]> =>
    JSON.parse(await stored(setup)).unlinks.map(
      (entry: { environmentId: string }) => entry.environmentId,
    );

  assert.deepEqual(await pending(), removed);

  const requests = account.requests;
  const held = await host.call(1, "host.connect.link", undefined);
  assert.ok(held.kind === "unlinked" && held.linking.kind === "failed");
  assert.equal(account.requests, requests);
  assert.deepEqual(await pending(), removed);

  broker.removalOffline = false;
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.deepEqual(await pending(), []);
}, 30_000);

test("sessions keep this Mac's environment id while it links and unlinks", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const before = await host.call(1, "sessions.create", {});
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  const whileLinked = await host.call(1, "sessions.create", {});
  const linkId = setup.broker.env?.id;
  assert.ok(linkId);
  await host.call(1, "host.connect.unlink", undefined);
  const after = await host.call(1, "sessions.create", {});
  assert.equal(before.workspace.id, await environmentId());
  assert.notEqual(before.workspace.id, linkId);
  assert.equal(whileLinked.workspace.id, before.workspace.id);
  assert.equal(after.workspace.id, before.workspace.id);
});

test("a linked Mac keeps serving with its machine key when the sign-in dialog is unavailable", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const phone = await setup.broker.phone();
  await first.host.close();

  const second = await desktop(setup, { account: undefined });
  await second.host.autostartConnect(1);
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
  const current = await linked(second.host);
  assert.deepEqual(current.account, { kind: "unavailable" });
  await assert.rejects(
    second.host
      .call(1, "host.connect.unlink", undefined)
      .then(() => second.host.call(1, "host.connect.link", undefined)),
  );
});

test("serving outlives the window that turned it on", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const phone = await setup.broker.phone();

  desktop_.host.closeWindow(1);
  assert.deepEqual(await info(setup, phone.token), allowed);
  assert.equal((await linked(desktop_.host)).connection.kind, "connected");
});

test("unlink refuses at once, closes the relay, and retries the broker on a later run", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  const serving = await serve(first);
  const { broker } = setup;
  const phone = await broker.phone();

  broker.offline = true;
  await first.host.call(1, "host.connect.unlink", undefined);
  const after = await view(first.host);
  assert.ok(after.kind === "unlinked");
  assert.deepEqual(after.notice, { kind: "unlink_pending" });
  await relayGone(setup);
  const file = JSON.parse(await stored(setup));
  assert.equal(file.link, null);
  assert.equal(file.enabled, false);
  assert.deepEqual(
    file.unlinks.map((entry: { environmentId: string }) => entry.environmentId),
    [serving.environment.id],
  );
  assert.equal(JSON.stringify(file).includes(phone.deviceId), false);
  await first.host.close();

  broker.offline = false;
  const second = await desktop(setup);
  await second.host.autostartConnect(1);
  await vi.waitFor(async () => {
    const current = await view(second.host);
    assert.ok(current.kind === "unlinked" && current.notice.kind === "none");
  });
  assert.equal(broker.env?.removed, true);
  assert.deepEqual(JSON.parse(await stored(setup)).unlinks, []);
});

test("a removed environment is forgotten; a disabled owner only lapses", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();

  broker.leaseMode = "owner_disabled";
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).lease, {
      kind: "lapsed",
      reason: "owner_disabled",
    }),
  );
  assert.deepEqual(await info(setup, phone.token), denied);
  assert.equal(setup.relay.connected(), broker.env?.id);
  broker.leaseMode = "ok";
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));

  assert.ok(broker.env);
  broker.env.removed = true;
  await vi.waitFor(async () => {
    const current = await view(desktop_.host);
    assert.ok(current.kind === "unlinked");
    assert.deepEqual(current.notice, { kind: "revoked" });
  });
  await relayGone(setup);
  const file = JSON.parse(await stored(setup));
  assert.equal(file.link, null);
  assert.deepEqual(file.unlinks, []);
});

test("a relay that says revoked is checked with a lease, and only the broker's answer forgets the link", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const { broker } = setup;
  assert.ok(broker.env);
  const lease = `POST ${BROKER_ROUTES.lease(broker.env.id)}`;
  const leases = broker.count(lease);
  const auths = setup.relay.auths;

  // Not removed at the broker: one lease right away, and the relay comes back.
  setup.relay.close(RELAY_CLOSE.revoked);
  await vi.waitFor(() => assert.equal(broker.count(lease), leases + 1));
  await vi.waitFor(() => assert.equal(setup.relay.auths, auths + 1));
  const current = await linked(desktop_.host);
  assert.equal(current.lease.kind, "current");
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" }),
  );

  broker.env.removed = true;
  setup.relay.close(RELAY_CLOSE.revoked);
  await vi.waitFor(async () => {
    const after = await view(desktop_.host);
    assert.ok(after.kind === "unlinked");
    assert.deepEqual(after.notice, { kind: "revoked" });
  });
  await relayGone(setup);
  assert.equal(JSON.parse(await stored(setup)).link, null);
});

test("another instance taking the relay over stops this one, wake included, until it is turned on again", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const phone = await setup.broker.phone();
  const { ended } = await watch(setup, desktop_.host, phone.token);

  setup.relay.close(RELAY_CLOSE.replaced);
  assert.equal(await ended, "ended");
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, {
      kind: "failed",
      reason: "replaced",
    }),
  );
  const auths = setup.relay.auths;
  desktop_.runtime.resume();
  await sleep(300);
  assert.equal(setup.relay.auths, auths);
  assert.deepEqual(await info(setup, phone.token), { status: 503, code: "closed" });

  await desktop_.host.call(1, "host.connect.setEnabled", { enabled: false });
  await desktop_.host.call(1, "host.connect.setEnabled", { enabled: true });
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
  assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" });
});

test("waking refuses everyone until a fresh lease and dials the relay again", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  const { ended } = await watch(setup, desktop_.host, phone.token);
  const auths = setup.relay.auths;
  const held = Promise.withResolvers<void>();
  broker.holdNextLease = held.promise;

  desktop_.runtime.resume();
  assert.equal(await ended, "ended");
  await vi.waitFor(() => assert.equal(setup.relay.auths, auths + 1));
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" }),
  );
  assert.deepEqual((await linked(desktop_.host)).lease, { kind: "pending" });
  assert.deepEqual(await info(setup, phone.token), denied);

  held.resolve();
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
});

test("a cancelled link keeps its key on disk, and a restart resumes the same environment with it", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  const { broker } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const inFlight = first.host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1));
  const pending = JSON.parse(await stored(setup)).linkKey;
  assert.ok(Value.Check(PrivateJwk, pending.key));
  assert.equal(await keyThumbprint(pending.key), broker.env?.thumbprint);
  await first.host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  assert.equal((await inFlight).kind, "unlinked");
  await first.host.close();
  broker.linkGate = undefined;
  const environment = broker.env?.id;
  assert.deepEqual(JSON.parse(await stored(setup)).linkKey.key, pending.key);

  const second = await desktop(setup);
  assert.equal((await second.host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.equal(broker.env?.id, environment);
  const file = JSON.parse(await stored(setup));
  assert.deepEqual(file.link.key, pending.key);
  assert.equal(file.linkKey, null);
});

test("a malformed machine key on disk keeps a restart off the broker and the relay", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  await first.host.close();
  await relayGone(setup);
  const path = join(setup.state, "connect.json");
  const file = JSON.parse(await stored(setup));
  delete file.link.key.d;
  const corrupted = `${JSON.stringify(file, null, 2)}\n`;
  await writeFile(path, corrupted);
  const calls = setup.broker.calls.length;
  const auths = setup.relay.auths;

  const { host } = await desktop(setup);
  await host.autostartConnect(1);
  await sleep(300);
  assert.deepEqual(await view(host), { kind: "unavailable", reason: "store_failed" });
  await assert.rejects(host.call(1, "host.connect.setEnabled", { enabled: true }));
  await assert.rejects(host.call(1, "host.connect.link", undefined));
  assert.equal(setup.broker.calls.length, calls);
  assert.equal(setup.relay.auths, auths);
  assert.equal(setup.relay.connected(), undefined);
  assert.equal(await stored(setup), corrupted);
});

test("nothing is linked without configuration", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup, { config: undefined });

  await assert.rejects(host.call(1, "host.connect.link", undefined));
  assert.deepEqual(await view(host), { kind: "unavailable", reason: "not_configured" });
  assert.equal(setup.account.requests, 0);
  assert.equal(setup.broker.calls.length, 0);
});

test("the build configuration must be canonical HTTPS with a bare Clerk host", () => {
  const env = {
    MAIN_VITE_NYTE_CONNECT_ORIGIN: ORIGIN,
    MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY: CONFIG.clerk.publishableKey,
    MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST: CONFIG.clerk.frontendApiHost,
  };

  assert.deepEqual(readConnectConfig(env), CONFIG);
  assert.deepEqual(
    readConnectConfig({
      ...env,
      MAIN_VITE_NYTE_CONNECT_ORIGIN: "https://nyte-connect.example.workers.dev",
    }),
    { ...CONFIG, origin: "https://nyte-connect.example.workers.dev" },
  );

  for (const [name, value] of [
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "http://connect.nyte.test"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://connect.nyte.test/"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://connect.nyte.test/r"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://user@connect.nyte.test"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", ""],
    ["MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY", "sk_test_secret"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "https://clerk.nyte.test"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test:8443"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test/path"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", ""],
  ] as const) {
    assert.equal(readConnectConfig({ ...env, [name]: value }), undefined, `${name}=${value}`);
  }
});
