/**
 * Account remote access across the real parts: the broker Worker and its
 * relay Durable Object in local workerd over a local D1, the desktop's host
 * and connect runtime with their real loopback listener and relay WebSocket,
 * and the phone's broker client and Nyte HTTP client calling the public
 * relay address. The Clerk Backend API and the sign-in dialog are the only
 * stand-ins. Every request crosses real HTTP or a real WebSocket.
 */
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import type { SessionId } from "@nyte-ai/protocol";
import type { Api, Model } from "@nyte-ai/schema";
import type { ConnectView } from "@nyte-ai/app/bridge.ts";
import {
  BrokerError,
  DESKTOP_ROUTES,
  DEVICE_TOKEN_BYTES,
  ENROLLMENT_READINESS_SECONDS,
  base64ToBase64Url,
  base64Url,
  createBrokerClient,
  relayAddress,
} from "@nyte-ai/connect";
import type { BrokerClient, BrokerFailure, EnvironmentSummary } from "@nyte-ai/connect";
import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHANNEL_LIMIT,
  RELAY_WINDOW_BYTES,
} from "@nyte-ai/connect/relay";
import {
  WORKERD_AUTHORIZED_PARTY,
  WORKERD_ORIGIN,
  startWorkerdBroker,
} from "../../../connect-worker/test/workerd.ts";
import type { WorkerdBroker } from "../../../connect-worker/test/workerd.ts";
import type { AccountSession, AccountState } from "./account-session.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import type { ConnectConfig } from "./connect-config.ts";
import { ConnectRuntime } from "./connect-runtime.ts";
import type { SecretCipher } from "./connect-store.ts";
import { DesktopHost } from "./host.ts";

const OWNER = "user_interop";

const DESKTOP_SESSION = "sess_interop_desktop";

const PHONE_SESSION = "sess_interop_phone";

const CLIENT_ID = "interop-phone-install-0001";

const CONFIG: ConnectConfig = {
  origin: WORKERD_ORIGIN,
  clerk: { publishableKey: "pk_test_Y2xlcmsubnl0ZS50ZXN0JA", frontendApiHost: "clerk.nyte.test" },
};

let workerd: WorkerdBroker;

beforeAll(async () => {
  workerd = await startWorkerdBroker();
}, 120_000);

afterAll(async () => {
  await workerd.close();
});

const cleanups: (() => Promise<void> | void)[] = [];

beforeEach(async () => {
  await workerd.reset();
  workerd.clerk.users.set(OWNER, {
    banned: false,
    locked: false,
    updated_at: 1,
    email: "interop@example.test",
  });
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// The edge: every request any party sends to the broker's origin
// ---------------------------------------------------------------------------

interface Edge {
  /** `METHOD path → status` for every answer, with the body of a refusal. Never a header. */
  readonly answers: string[];
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function edge(): Edge {
  const answers: string[] = [];

  return {
    answers,
    async fetch(input, init) {
      if (input instanceof Request) throw new TypeError("Every party here fetches by URL");
      const response = await workerd.fetch(input, init);

      const refusal =
        response.ok || response.status === 204 ? "" : ` ${await response.clone().text()}`;

      answers.push(
        `${init?.method ?? "GET"} ${new URL(input).pathname} → ${response.status}${refusal}`,
      );

      return response;
    },
  };
}

/** Every row of one of the Worker's D1 tables. */
function rows(table: "devices" | "environments" | "denied_sessions"): Promise<unknown[]> {
  return workerd.query(`SELECT * FROM ${table}`);
}

// ---------------------------------------------------------------------------
// The desktop
// ---------------------------------------------------------------------------

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
  throw new Error("No provider in the interop test");
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

/** AES-256-GCM under a key held in memory, standing in for the OS keychain. */
function memoryCipher(): SecretCipher {
  const key = randomBytes(32);

  return {
    available: async () => true,
    seal: async (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);

      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    open: async (sealed) => {
      const bytes = Buffer.from(sealed, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));

      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}

/** The sign-in dialog: a signed-in Clerk session whose fresh JWT names the renderer as `azp`. */
const account: AccountSession = {
  requestSessionToken: () =>
    workerd.sessionToken({
      userId: OWNER,
      sessionId: DESKTOP_SESSION,
      claims: { azp: WORKERD_AUTHORIZED_PARTY },
    }),
  state: (): AccountState => ({ kind: "signed_in", label: "interop@example.test" }),
  focus: () => undefined,
  signOut: async () => undefined,
  close: async () => undefined,
};

interface Setup {
  readonly host: DesktopHost;
  readonly edge: Edge;
  /** Every relay state Settings would have shown, in order. */
  readonly relayStates: string[];
  /** Every relay socket the desktop dialed, latest last. */
  readonly sockets: WebSocket[];
}

async function setUp(): Promise<Setup> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-interop-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  vi.stubEnv("NYTE_HOME", state);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));

  const relayStates: string[] = [];
  const sockets: WebSocket[] = [];
  const shared = edge();

  const runtime: ConnectRuntime = new ConnectRuntime({
    config: CONFIG,
    home: state,
    cipher: memoryCipher(),
    account,
    onChange: () =>
      void runtime.view().then((view) => {
        const current = view.kind === "linked" ? view.connection.kind : view.kind;

        if (relayStates.at(-1) !== current) relayStates.push(current);
      }),
    name: "Interop Mac",
    fetch: (input, init) => shared.fetch(input, init),
    dial: (url) => {
      const socket = new WebSocket(workerd.localUrl(url));
      sockets.push(socket);

      return socket;
    },
    // The broker allows 20 leases a minute per environment, readiness refreshes included.
    timing: {
      heartbeatMs: 3_000,
      retryMs: 500,
      dropDelayMs: 50,
      relay: { retryMinMs: 100, retryMaxMs: 500 },
    },
  });

  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: localModels,
    appVersion: "test",
    connect: runtime,
    emitHostEvent: () => undefined,
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
        throw new Error("Browser is not used by the interop test");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      releaseWindow: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });

  cleanups.push(() => host.close());

  return { host, edge: shared, relayStates, sockets };
}

/** The last answers the edge gave, repeats folded, what Settings showed, and the Worker's log, for a failure message. */
function diagnostics(setup: Setup): string {
  const folded: string[] = [];
  let repeats = 0;

  for (const [index, answer] of setup.edge.answers.entries()) {
    if (answer === setup.edge.answers[index + 1]) {
      repeats += 1;
      continue;
    }

    folded.push(repeats === 0 ? answer : `${answer} (×${String(repeats + 1)})`);
    repeats = 0;
  }

  return [
    `Edge answers, latest last: ${JSON.stringify(folded.slice(-40))}`,
    `Relay states: ${JSON.stringify(setup.relayStates)}`,
    `Worker log, latest last: ${JSON.stringify(
      workerd
        .logs()
        .slice(-30)
        .map((log) => `${log.level} ${log.message}`),
    )}`,
  ].join("\n");
}

/**
 * Access ends at once and the credential is refused soon after. The first
 * probe after removal is never served. Until the relay or the Mac refuses
 * the credential, a probe may come back `closed` or cut, because the desktop
 * resets every open channel as it drops streams; that serves nothing. Any
 * `ok`, or no refusal within two seconds, fails with every outcome seen.
 */
async function assertRefused(setup: Setup, address: string, token: string): Promise<void> {
  const seen: string[] = [];
  const deadline = Date.now() + 2_000;

  for (;;) {
    const outcome = await probe(setup, address, token);
    seen.push(outcome);

    if (outcome === "ok")
      assert.fail(
        `A removed credential was served: ${JSON.stringify(seen)}.\n${diagnostics(setup)}`,
      );

    if (REFUSED.includes(outcome)) return;

    if (Date.now() > deadline)
      assert.fail(
        `No credential refusal within 2 s: ${JSON.stringify(seen)}.\n${diagnostics(setup)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** `work`, or a failure that carries the diagnostics. */
async function explained<T>(setup: Setup, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (cause) {
    assert.fail(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics(setup)}`);
  }
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

async function linked(host: DesktopHost): Promise<Linked> {
  const current = await host.call(1, "host.connect.state", undefined);
  assert.equal(current.kind, "linked");

  if (current.kind !== "linked") throw new Error("not linked");

  return current;
}

/** Link through the sign-in dialog, turn remote access on, and wait for an authenticated relay and a lease. */
async function serve(setup: Setup): Promise<Linked> {
  const afterLink = await setup.host.call(1, "host.connect.link", undefined);

  if (afterLink.kind !== "linked")
    assert.fail(`The link ended ${JSON.stringify(afterLink)}.\n${diagnostics(setup)}`);
  await setup.host.call(1, "host.connect.setEnabled", { enabled: true });

  return explained(
    setup,
    vi.waitFor(
      async () => {
        const current = await linked(setup.host);
        assert.equal(current.connection.kind, "connected");
        assert.equal(current.lease.kind, "current");

        return current;
      },
      { timeout: 15_000, interval: 100 },
    ),
  );
}

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

function phoneBroker(setup: Setup, sessionId = PHONE_SESSION): BrokerClient {
  return createBrokerClient({
    origin: WORKERD_ORIGIN,
    sessionToken: () => workerd.sessionToken({ userId: OWNER, sessionId }),
    fetch: (input, init) => setup.edge.fetch(input, init),
  });
}

/** A device bearer and its digest, made the way the iOS app makes them. */
function deviceSecret() {
  const token = base64Url(randomBytes(DEVICE_TOKEN_BYTES));

  return {
    token,
    digest: base64ToBase64Url(createHash("sha256").update(token, "utf8").digest("base64")),
  };
}

function nyteClient(setup: Setup, address: string, token: string): NyteClient {
  return createNyteClient({ baseUrl: address, token, fetch: setup.edge.fetch });
}

/** `ok`, the wire code the relay or the Mac refused with, or `transport`. */
async function probe(setup: Setup, address: string, token: string): Promise<string> {
  try {
    await nyteClient(setup, address, token).info();

    return "ok";
  } catch (cause) {
    return cause instanceof NyteWireError ? cause.code : "transport";
  }
}

/** A credential refusal, from the relay's digest check or the Mac's own. */
const REFUSED = ["unauthorized", "forbidden"];

interface Phone {
  readonly environment: EnvironmentSummary;
  readonly deviceId: string;
  readonly address: string;
  readonly token: string;
  readonly client: NyteClient;
}

/** Enroll and wait for the Mac to accept the bearer within the contract's readiness window. */
async function connectPhone(
  setup: Setup,
  broker: BrokerClient = phoneBroker(setup),
): Promise<Phone> {
  const { environments } = await broker.listEnvironments({});
  const [environment] = environments;
  assert.ok(environment);
  const secret = deviceSecret();

  const enrolled = await explained(
    setup,
    broker.enroll({
      environmentId: environment.id,
      request: { clientId: CLIENT_ID, clientName: "Pocket", digest: secret.digest },
    }),
  );

  assert.equal(enrolled.environmentId, environment.id);
  const address = relayAddress(WORKERD_ORIGIN, environment.id);
  await explained(
    setup,
    vi.waitFor(async () => assert.equal(await probe(setup, address, secret.token), "ok"), {
      timeout: ENROLLMENT_READINESS_SECONDS * 1_000,
      interval: 250,
    }),
  );

  return {
    environment,
    deviceId: enrolled.deviceId,
    address,
    token: secret.token,
    client: nyteClient(setup, address, secret.token),
  };
}

/** `work`, or a rejection naming `what` once `ms` have passed. */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });

  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

type Events = AsyncIterator<unknown>;

/** A watch that has delivered its first event, so its channel is open end to end. */
async function openWatch(phone: Phone, sessionId: SessionId): Promise<Events> {
  const events = phone.client.watch({ sessionId })[Symbol.asyncIterator]();
  const first = await events.next();
  assert.equal(first.done, false);

  return events;
}

/** How long channels a phone let go of may take to free up locally: abort reaches workerd late. */
const CLEANUP_MS = 20_000;

/**
 * `count` watches held open at once, opened one after another. A watch the
 * relay refuses as `closed` is tried again every 500 ms until `CLEANUP_MS`
 * has passed, so a slow cleanup costs one request a poll, never a new batch.
 * On failure every watch it opened is let go before it rejects.
 */
async function fillChannels(phone: Phone, sessionId: SessionId, count: number): Promise<Events[]> {
  const opened: Events[] = [];
  const deadline = Date.now() + CLEANUP_MS;

  try {
    while (opened.length < count) {
      try {
        opened.push(await openWatch(phone, sessionId));
      } catch (cause) {
        if (!(cause instanceof NyteWireError && cause.code === "closed") || Date.now() > deadline)
          throw cause;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return opened;
  } catch (cause) {
    await closeWatches(opened);
    throw new Error(
      `${String(opened.length)} of ${String(count)} channels opened within ${String(CLEANUP_MS)} ms: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

async function closeWatches(watches: readonly Events[]): Promise<void> {
  await Promise.all(
    watches.map(async (events) => {
      await events.return?.();
    }),
  );
}

/** Read events until one mentions `text`. */
async function eventMentioning(events: Events, text: string): Promise<void> {
  for (;;) {
    const next = await events.next();
    assert.equal(next.done, false, `The watch ended before an event mentioned ${text}`);

    if (JSON.stringify(next.value).includes(text)) return;
  }
}

/** A watch whose stream was cut ends or fails; it never waits for an event that cannot come. */
async function ends(events: Events): Promise<void> {
  const drained = (async () => {
    try {
      for (;;) if ((await events.next()).done === true) return;
    } catch {
      // A cut stream may fail rather than end; either lets go.
    }
  })();

  await within(drained, 10_000, "The cut watch ending");
}

const DeviceRow = Type.Object({
  id: Type.String(),
  state: Type.String(),
  revoke_reason: Type.Union([Type.String(), Type.Null()]),
});

const EnvironmentRow = Type.Object({
  id: Type.String(),
  relay_session: Type.Union([Type.String(), Type.Null()]),
});

const DeniedSessionRow = Type.Object({ session_id: Type.String() });

async function deviceRow(deviceId: string) {
  return Value.Parse(Type.Array(DeviceRow), await rows("devices")).find(
    (row) => row.id === deviceId,
  );
}

async function deniedSessions() {
  return Value.Parse(Type.Array(DeniedSessionRow), await rows("denied_sessions")).map(
    (row) => row.session_id,
  );
}

/** The relay socket the broker last accepted a proof on for this environment, if any. */
async function relaySession(environmentId: string) {
  return Value.Parse(Type.Array(EnvironmentRow), await rows("environments")).find(
    (row) => row.id === environmentId,
  )?.relay_session;
}

async function failureOf(promise: Promise<unknown>): Promise<BrokerFailure | undefined> {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof BrokerError) return cause.failure;
    throw cause;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

test(
  "a desktop serves through its relay, and a phone enrolls and calls it at the relay address",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    const serving = await serve(setup);
    assert.equal(serving.environment.address, relayAddress(WORKERD_ORIGIN, serving.environment.id));
    const phone = await connectPhone(setup);

    assert.equal(phone.environment.id, serving.environment.id);
    assert.equal(phone.environment.online, true);
    assert.equal((await deviceRow(phone.deviceId))?.state, "active");
    await vi.waitFor(
      async () =>
        assert.deepEqual(
          (await linked(setup.host)).devices.map((device) => [device.id, device.authorized]),
          [[phone.deviceId, true]],
        ),
      { timeout: 5_000 },
    );

    // Only the broker relays an enrollment; a phone's bearer does not reach that route.
    const enroll = await setup.edge.fetch(`${phone.address}${DESKTOP_ROUTES.enroll}`, {
      method: "POST",
      headers: { authorization: `Bearer ${phone.token}`, "content-type": "application/json" },
      body: "{}",
    });

    assert.equal(enroll.status, 404);
    await enroll.body?.cancel();

    // The relay reads the bearer; it keeps only its digest and never logs the token.
    const kept = [
      ...setup.edge.answers,
      ...workerd.logs().map((log) => log.message),
      JSON.stringify(await rows("devices")),
      JSON.stringify(await rows("environments")),
    ];

    assert.ok(kept.every((text) => !text.includes(phone.token)));
  },
);

test(
  "relayed bodies larger than the credit window travel both ways, and an oversized one is refused",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    await serve(setup);
    const phone = await connectPhone(setup);
    const session = await phone.client.sessions.create({ name: "relayed" });
    const content = `${"x".repeat(RELAY_WINDOW_BYTES * 2)}${randomBytes(16).toString("hex")}`;

    const receipt = await phone.client.messages.send({ sessionId: session.sessionId, content });
    assert.equal(receipt.kind, "queued");
    const snapshot = await phone.client.sessions.snapshot({ sessionId: session.sessionId });
    assert.ok(JSON.stringify(snapshot).includes(content));

    const oversized = await setup.edge.fetch(`${phone.address}/v1/call/messages.send`, {
      method: "POST",
      headers: { authorization: `Bearer ${phone.token}`, "content-type": "application/json" },
      body: "x".repeat(RELAY_BODY_LIMIT_BYTES + 1),
    });

    assert.equal(oversized.status, 413);
    assert.match(await oversized.text(), /"code":"payload_too_large"/u);
    assert.equal(await probe(setup, phone.address, phone.token), "ok");
  },
);

test(
  "a relayed watch streams live events, and every channel a phone lets go of is free again",
  { timeout: 120_000 },
  async () => {
    const setup = await setUp();
    const serving = await serve(setup);
    const phone = await connectPhone(setup);
    const socket = await relaySession(serving.environment.id);
    const session = await phone.client.sessions.create({ name: "watched" });

    const live = await openWatch(phone, session.sessionId);
    await setup.host.call(1, "sessions.rename", {
      sessionId: session.sessionId,
      name: "renamed on the Mac",
    });
    await explained(
      setup,
      within(eventMentioning(live, "renamed on the Mac"), 10_000, "The live event"),
    );
    await live.return?.();

    // A channel the relay or the Mac kept after the phone let go would refuse one of these.
    const full = await explained(
      setup,
      fillChannels(phone, session.sessionId, RELAY_CHANNEL_LIMIT),
    );

    assert.equal(await probe(setup, phone.address, phone.token), "closed");
    await closeWatches(full);

    const again = await explained(
      setup,
      fillChannels(phone, session.sessionId, RELAY_CHANNEL_LIMIT),
    );

    assert.equal(await probe(setup, phone.address, phone.token), "closed");
    await closeWatches(again);
    await explained(
      setup,
      vi.waitFor(async () => assert.equal(await probe(setup, phone.address, phone.token), "ok"), {
        timeout: CLEANUP_MS,
        interval: 500,
      }),
    );
    assert.equal((await linked(setup.host)).connection.kind, "connected");
    // Neither side broke the framing: the socket that carried all of it is still the one.
    assert.equal(await relaySession(serving.environment.id), socket);
  },
);

test(
  "an idle relay that hibernates keeps serving on the socket the desktop proved",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    const serving = await serve(setup);
    const phone = await connectPhone(setup);
    const socket = await relaySession(serving.environment.id);
    assert.ok(socket);

    await workerd.evictRelay(serving.environment.id);
    assert.equal(await probe(setup, phone.address, phone.token), "ok");
    assert.equal(await relaySession(serving.environment.id), socket);
    assert.equal((await linked(setup.host)).connection.kind, "connected");
  },
);

test(
  "a relay socket that drops ends the phone's streams, and the desktop proves itself again",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    const serving = await serve(setup);
    const phone = await connectPhone(setup);
    const session = await phone.client.sessions.create({ name: "interrupted" });
    const events = await openWatch(phone, session.sessionId);
    const socket = await relaySession(serving.environment.id);
    assert.ok(socket);

    // The connection goes away under both ends, as a network drop or a relay restart does.
    const dropped = setup.sockets.at(-1);
    assert.ok(dropped);

    const handshake = new Promise<number>((resolve) =>
      dropped.addEventListener("close", (event) => resolve(event.code), { once: true }),
    );

    dropped.close(1000, "dropped");
    await explained(setup, ends(events));
    await explained(setup, within(handshake, 5_000, "The relay's close handshake"));
    await explained(
      setup,
      vi.waitFor(
        async () => {
          assert.equal((await linked(setup.host)).connection.kind, "connected");
          assert.equal(await probe(setup, phone.address, phone.token), "ok");
        },
        { timeout: 15_000, interval: 200 },
      ),
    );
    const proven = await relaySession(serving.environment.id);
    assert.ok(proven);
    assert.notEqual(proven, socket);
    const { environments } = await phoneBroker(setup).listEnvironments({});
    assert.deepEqual(
      environments.map((environment) => [environment.id, environment.online]),
      [[serving.environment.id, true]],
    );
  },
);

test(
  "a phone releasing its own token is refused at once, and its Clerk session can enroll again",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    await serve(setup);
    const first = await connectPhone(setup);

    const release = () =>
      setup.edge.fetch(`${first.address}${DESKTOP_ROUTES.device}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${first.token}` },
      });

    assert.equal((await release()).status, 204);
    await assertRefused(setup, first.address, first.token);
    await explained(
      setup,
      vi.waitFor(
        async () =>
          assert.deepEqual(
            [
              (await deviceRow(first.deviceId))?.state,
              (await deviceRow(first.deviceId))?.revoke_reason,
            ],
            ["revoked", "released"],
          ),
        { timeout: 10_000, interval: 200 },
      ),
    );
    assert.deepEqual(await deniedSessions(), []);
    assert.deepEqual(workerd.clerk.revoked, []);

    // The phone's cleanup counts a second release of a spent token as done.
    const again = await release();
    assert.equal(again.status, 403);
    await again.body?.cancel();

    const second = await connectPhone(setup);
    assert.notEqual(second.deviceId, first.deviceId);
    await assertRefused(setup, first.address, first.token);
    assert.deepEqual(workerd.clerk.revoked, []);
  },
);

test(
  "revoking a device on the desktop ends its streams and denies the Clerk session that enrolled it",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    await serve(setup);
    const broker = phoneBroker(setup);
    const phone = await connectPhone(setup, broker);
    const session = await phone.client.sessions.create({ name: "revoked here" });
    const events = await openWatch(phone, session.sessionId);

    await setup.host.call(1, "host.connect.revokeDevice", { deviceId: phone.deviceId });
    await assertRefused(setup, phone.address, phone.token);
    await explained(setup, ends(events));
    await explained(
      setup,
      vi.waitFor(
        async () => {
          assert.deepEqual(await deniedSessions(), [PHONE_SESSION]);
          assert.deepEqual(workerd.clerk.revoked, [PHONE_SESSION]);
        },
        { timeout: 10_000, interval: 200 },
      ),
    );
    assert.equal((await deviceRow(phone.deviceId))?.revoke_reason, "revoked");
    assert.equal(await probe(setup, phone.address, phone.token), "unauthorized");

    const again = deviceSecret();
    assert.deepEqual(
      await failureOf(
        broker.enroll({
          environmentId: phone.environment.id,
          request: { clientId: CLIENT_ID, clientName: "Pocket", digest: again.digest },
        }),
      ),
      { kind: "refused", status: 401, code: "session_revoked" },
    );
  },
);

test(
  "a phone revoking its device at the broker is cut off at the relay and dropped by the desktop's next lease",
  { timeout: 60_000 },
  async () => {
    const setup = await setUp();
    await serve(setup);
    const broker = phoneBroker(setup);
    const phone = await connectPhone(setup, broker);
    const session = await phone.client.sessions.create({ name: "revoked there" });
    const events = await openWatch(phone, session.sessionId);

    await broker.revokeDevice({ environmentId: phone.environment.id, deviceId: phone.deviceId });
    assert.equal(await probe(setup, phone.address, phone.token), "unauthorized");
    await explained(setup, ends(events));
    assert.deepEqual(await deniedSessions(), [PHONE_SESSION]);
    await explained(
      setup,
      vi.waitFor(
        async () =>
          assert.deepEqual(
            (await linked(setup.host)).devices.map((device) => [device.id, device.authorized]),
            [[phone.deviceId, false]],
          ),
        { timeout: 10_000, interval: 200 },
      ),
    );
  },
);
