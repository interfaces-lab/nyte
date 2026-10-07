/**
 * A headless host linked to an account and reached through the real broker:
 * the runtime, its direct listener and the Connect relay composed as
 * `nyte serve --account` composes them, over workerd and D1, with a browser
 * device enrolled through the broker and calling through the relay. Only
 * Clerk is a fake.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import {
  base64ToBase64Url,
  base64Url,
  createBrokerClient,
  DEVICE_TOKEN_BYTES,
  relayAddress,
} from "@nyte-ai/connect";
import type { DeviceRole } from "@nyte-ai/connect";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import { SqliteStore } from "@nyte-ai/core/store";
import { openHostRuntime, openProfile, verifyIdentityChallenge } from "@nyte-ai/host/runtime";
import type { HostRuntime } from "@nyte-ai/host/runtime";
import type { Api, Model } from "@nyte-ai/schema";
import { startWorkerdBroker } from "../../connect-worker/test/workerd.ts";
import type { WorkerdBroker } from "../../connect-worker/test/workerd.ts";
import { accountShare, startHeadless } from "../src/headless.ts";

const OWNER = "user_owner";

let workerd: WorkerdBroker;
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  workerd = await startWorkerdBroker();
}, 120_000);

afterAll(async () => {
  await workerd.close();
});

beforeEach(async () => {
  await workerd.reset();
  workerd.clerk.users.set(OWNER, {
    banned: false,
    locked: false,
    updated_at: 1,
    email: "owner@example.test",
  });
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

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

const replying: Provider["stream"] = (selected) => {
  const events = createAssistantMessageEventStream();
  events.push({
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  });

  return events;
};

function offlineModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: replying,
    streamSimple: replying,
  });

  return models;
}

/** The owner at the link page: looks the code up and approves the fingerprint shown. */
async function approveInBrowser(userCode: string, fingerprint: string): Promise<void> {
  const token = await workerd.sessionToken({ userId: OWNER });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const looked = await workerd.fetch(`${workerd.origin}/v1/link-transactions/lookup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userCode }),
  });
  const lookup: unknown = await looked.json();
  const transactionId =
    typeof lookup === "object" && lookup !== null && "transactionId" in lookup
      ? String(lookup.transactionId)
      : "";
  const approved = await workerd.fetch(
    `${workerd.origin}/v1/link-transactions/${transactionId}/approve`,
    { method: "POST", headers, body: JSON.stringify({ fingerprint }) },
  );
  assert.equal(approved.status, 200);
}

interface Host {
  readonly runtime: HostRuntime;
  readonly connect: ConnectRuntime;
  readonly environmentId: string;
  readonly folder: string;
  /** The owner's direct client. */
  readonly owner: NyteClient;
}

/** `nyte serve --account [--device-admin]` as Node composes it: link, then serve through the relay. */
async function serveLinked(options: { readonly deviceAdmin: boolean }): Promise<Host> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-account-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  vi.stubEnv("NYTE_HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const folder = join(root, "project");
  await mkdir(folder);
  const profile = await openProfile("default", home);
  const runtime = await openHostRuntime({
    profile,
    store: new SqliteStore(profile.storePath),
    models: offlineModels(),
    model,
    onDiagnostic: () => undefined,
  });
  cleanups.push(() => runtime.close());
  const direct = await startHeadless({ runtime, version: "test" });
  cleanups.push(() => direct.close());

  let awaiting: { readonly userCode: string; readonly fingerprint: string } | undefined;
  const connect = new ConnectRuntime({
    config: { origin: workerd.origin },
    home: profile.directory,
    storePath: profile.connectPath,
    authorizer: {
      kind: "transaction",
      onOpened: (opened) => {
        awaiting = { userCode: opened.userCode, fingerprint: opened.fingerprint };
      },
    },
    onChange: () => undefined,
    name: "Build box",
    fetch: (input, init) => workerd.fetch(input, init),
    dial: (url) => new WebSocket(workerd.localUrl(url)),
    timing: {
      heartbeatMs: 3_000,
      retryMs: 500,
      dropDelayMs: 50,
      linkPollMs: 50,
      relay: { retryMinMs: 100, retryMaxMs: 500 },
    },
  });
  cleanups.push(() => connect.close());
  const linking = connect.link();
  await vi.waitFor(() => assert.ok(awaiting !== undefined));

  if (awaiting === undefined) throw new Error("unreachable");
  await approveInBrowser(awaiting.userCode, awaiting.fingerprint);
  const linked = await linking;
  assert.equal(linked.kind, "linked");

  if (linked.kind !== "linked") throw new Error("unreachable");
  await connect.setEnabled({
    enabled: true,
    share: accountShare({ runtime, version: "test", deviceAdmin: options.deviceAdmin }),
  });
  await vi.waitFor(
    async () => {
      const view = await connect.view();
      assert.equal(view.kind, "linked");

      if (view.kind !== "linked") return;
      assert.equal(view.connection.kind, "connected");
      assert.equal(view.lease.kind, "current");
    },
    { timeout: 15_000, interval: 100 },
  );

  return {
    runtime,
    connect,
    environmentId: linked.environment.id,
    folder,
    owner: createNyteClient({ baseUrl: direct.address, token: profile.token }),
  };
}

/** A device bearer and its digest, made the way the web app makes them. */
function deviceSecret() {
  const token = base64Url(randomBytes(DEVICE_TOKEN_BYTES));

  return {
    token,
    digest: base64ToBase64Url(createHash("sha256").update(token, "utf8").digest("base64")),
  };
}

/** The web app enrolling through the broker, then calling the host at its relay address. */
async function enrollBrowser(
  host: Host,
  role: DeviceRole,
  clientId = "browser-0000000001",
): Promise<NyteClient> {
  const broker = createBrokerClient({
    origin: workerd.origin,
    sessionToken: () =>
      workerd.sessionToken({ userId: OWNER, sessionId: `sess_${clientId.replaceAll("-", "")}` }),
    fetch: (input, init) => workerd.fetch(input, init),
  });
  const secret = deviceSecret();
  await broker.enroll({
    environmentId: host.environmentId,
    request: { clientId, clientName: "Web browser", digest: secret.digest, role },
  });
  const client = createNyteClient({
    baseUrl: relayAddress(workerd.origin, host.environmentId),
    token: secret.token,
    fetch: (input, init) => workerd.fetch(input, init),
  });
  await vi.waitFor(async () => assert.equal((await client.info()).workspaces?.kind, "registry"), {
    timeout: 15_000,
    interval: 200,
  });

  return client;
}

async function wireCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (error instanceof NyteWireError) return error.code;
    throw error;
  }

  return "ok";
}

test("a browser device controls sessions through the relay but cannot expose folders without owner consent", async () => {
  const host = await serveLinked({ deviceAdmin: false });
  const browser = await enrollBrowser(host, "owner");

  // The identity the browser pins is verified through the relay, not taken from discovery.
  const info = await browser.info();
  assert.equal(info.identity?.hostId, host.runtime.profile.hostId);
  const nonce = randomBytes(24).toString("base64url");
  const challenge = await browser.identity(nonce);
  assert.equal(
    verifyIdentityChallenge({
      challenge,
      pinned: { hostId: host.runtime.profile.hostId, publicKey: host.runtime.profile.publicKey },
      nonce,
    }),
    true,
  );

  // Registration and trust are the owner's: this device enrolled as an admin, but the host was not told to honor that.
  assert.equal(
    await wireCode(() =>
      browser.environment("environment.workspaces.register", { path: host.folder }),
    ),
    "forbidden",
  );
  const registered = await host.owner.environment("environment.workspaces.register", {
    path: host.folder,
  });
  assert.equal(registered.kind, "registered");

  if (registered.kind !== "registered") return;
  assert.equal(
    await wireCode(() =>
      browser.environment("environment.workspaces.trust", {
        id: registered.workspace.id,
        path: host.folder,
        identity: registered.workspace.identity,
      }),
    ),
    "forbidden",
  );

  // Exposed folders are listed and usable: the device starts a root in one and watches it finish.
  const listed = await browser.environment("environment.workspaces.list", undefined);
  assert.deepEqual(
    listed.map((row) => row.id),
    [registered.workspace.id],
  );
  const started = await browser.environment("environment.start", {
    requestId: "browser-start-1",
    workspace: { id: registered.workspace.id },
    message: { content: "hello" },
  });
  assert.equal(started.kind, "accepted");

  if (started.kind !== "accepted") return;
  await vi.waitFor(async () => {
    const snapshot = await browser.sessions.snapshot({ sessionId: started.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });
  const again = await browser.environment("environment.start", {
    requestId: "browser-start-1",
    workspace: { id: registered.workspace.id },
    message: { content: "hello" },
  });
  assert.deepEqual(again, started);
  assert.deepEqual(
    (await host.owner.sessions.list({ parent: null })).items.map((row) => row.sessionId),
    [started.sessionId],
  );
});

test("with --device-admin, a device that enrolled as an owner registers and trusts folders; a controller still cannot", async () => {
  const host = await serveLinked({ deviceAdmin: true });
  const admin = await enrollBrowser(host, "owner", "browser-admin-00001");
  const controller = await enrollBrowser(host, "controller", "browser-plain-00001");
  const registered = await admin.environment("environment.workspaces.register", {
    path: host.folder,
  });
  assert.equal(registered.kind, "registered");

  if (registered.kind !== "registered") return;
  const granted = await admin.environment("environment.workspaces.trust", {
    id: registered.workspace.id,
    path: host.folder,
    identity: registered.workspace.identity,
  });
  assert.equal(granted.kind, "granted");
  assert.equal(
    await wireCode(() =>
      controller.environment("environment.workspaces.register", { path: host.folder }),
    ),
    "forbidden",
  );
  assert.equal((await controller.environment("environment.workspaces.list", undefined)).length, 1);
});

test("a device the owner revokes loses the relay at once; accepted work keeps running", async () => {
  const host = await serveLinked({ deviceAdmin: false });
  const browser = await enrollBrowser(host, "controller");
  const registered = await host.owner.environment("environment.workspaces.register", {
    path: host.folder,
  });
  assert.equal(registered.kind, "registered");

  if (registered.kind !== "registered") return;
  const started = await browser.environment("environment.start", {
    requestId: "revoked-start",
    workspace: { id: registered.workspace.id },
    message: { content: "hello" },
  });
  assert.equal(started.kind, "accepted");

  if (started.kind !== "accepted") return;
  const view = await host.connect.view();
  assert.equal(view.kind, "linked");

  if (view.kind !== "linked") return;
  const [device] = view.devices;

  if (device === undefined) throw new Error("no device");
  await host.connect.revokeDevice({ deviceId: device.id });
  await vi.waitFor(async () => assert.notEqual(await wireCode(() => browser.info()), "ok"), {
    timeout: 10_000,
    interval: 100,
  });
  await vi.waitFor(async () => {
    const snapshot = await host.owner.sessions.snapshot({ sessionId: started.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });
});
