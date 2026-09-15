/**
 * The desktop serving itself to a phone: `@nyte-ai/server` over the desktop's
 * own local SDK on a loopback listener. A client on that address must see the
 * same store the desktop reads, be refused without the token, lose its
 * streams when sharing stops, and keep reading the folder that was selected
 * when sharing started even after the desktop moves on.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyteClient } from "@nyte-ai/client";
import type { Api, Model } from "@nyte-ai/schema";
import { localSessions } from "../shared/ipc.ts";
import type { HostEvent, MobileShareState } from "../shared/ipc.ts";
import { DesktopHost } from "./host.ts";
import { startMobileShare } from "./mobile-share.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";

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

/** One offline model whose stream fails: a run that reaches it proves a runner picked the message up. */
function localModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  const stream = () => {
    throw new Error("No provider in the share test");
  };
  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  });
  return models;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function desktop(): Promise<{ host: DesktopHost; events: HostEvent[]; root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-mobile-share-")));
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  const events: HostEvent[] = [];
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: localModels,
    appVersion: "test",
    emitHostEvent: (event) => events.push(event),
    emitWatchEvent: () => undefined,
    openExternal: () => undefined,
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser is not used by share tests");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      dispose: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });
  cleanups.push(
    () => rm(root, { recursive: true, force: true }),
    () => host.close(),
  );
  return { host, events, root };
}

function sharing(state: MobileShareState): Extract<MobileShareState, { kind: "sharing" }> {
  assert.equal(state.kind, "sharing");
  if (state.kind !== "sharing") throw new Error("unreachable");
  return state;
}

test("a phone on the share address reads and drives the desktop's own Home store", async () => {
  const { host } = await desktop();
  const mine = await host.call("sessions.create", { name: "from the desktop" });

  const [first, concurrent] = await Promise.all([
    host.call("host.mobile.start", { reach: "simulator" }),
    host.call("host.mobile.start", { reach: "simulator" }),
  ]);
  const state = sharing(first);
  assert.equal(sharing(concurrent).address, state.address);
  assert.match(state.address, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(state.target, { kind: "home" });
  const phone = createNyteClient({ baseUrl: state.address, token: state.token });
  assert.equal((await phone.info()).version, "test");

  // Same store: the desktop's chat is already there, and the phone's chat lands in Home.
  const seen = await phone.sessions.list({ parent: null, includeArchived: true });
  assert.deepEqual(
    seen.items.map((session) => session.sessionId),
    [mine.sessionId],
  );
  const theirs = await phone.sessions.create({ name: "from the phone" });
  const directory = await host.call("host.sessionDirectory", undefined);
  assert.deepEqual(
    localSessions(directory, null)
      ?.map((session) => session.sessionId)
      .sort(),
    [mine.sessionId, theirs.sessionId].sort(),
  );
  await phone.sessions.rename({ sessionId: theirs.sessionId, name: "renamed on the phone" });
  assert.equal(
    (await host.call("sessions.get", { sessionId: theirs.sessionId }))?.name,
    "renamed on the phone",
  );

  // The desktop runs what the phone submits: the run reaches the offline provider and fails there.
  const receipt = await phone.messages.send({ sessionId: theirs.sessionId, content: "hello" });
  assert.equal(receipt.kind, "queued");
  await vi.waitFor(async () => {
    const info = await host.call("sessions.get", { sessionId: theirs.sessionId });
    assert.ok(
      info?.heads.some((head) => head.run?.phase.kind === "failed"),
      "the desktop's runner drove the phone's message to its provider failure",
    );
  });
});

test("a missing or wrong token is refused before anything is read", async () => {
  const { host } = await desktop();
  const state = sharing(await host.call("host.mobile.start", { reach: "simulator" }));

  const anonymous = await fetch(`${state.address}/v1/info`);
  assert.equal(anonymous.status, 401);
  const wrong = await fetch(`${state.address}/v1/info`, {
    headers: { authorization: `Bearer ${state.token.slice(1)}x` },
  });
  assert.equal(wrong.status, 403);
  await assert.rejects(
    createNyteClient({ baseUrl: state.address, token: "not-the-share-token" }).sessions.list({}),
  );
});

test("phone model choices follow desktop provider and model preferences", async () => {
  const { host } = await desktop();
  const state = sharing(await host.call("host.mobile.start", { reach: "simulator" }));
  const phone = createNyteClient({ baseUrl: state.address, token: state.token });
  assert.deepEqual(
    (await phone.provider.models.list()).map((entry) => entry.id),
    [model.id],
  );
  await host.call("host.setPreference", {
    kind: "models",
    provider: model.provider,
    ids: [model.id],
    hidden: true,
  });
  assert.deepEqual(await phone.provider.models.list(), []);
  await host.call("host.setPreference", {
    kind: "models",
    provider: model.provider,
    ids: [model.id],
    hidden: false,
  });
  await host.call("host.setPreference", {
    kind: "provider",
    provider: model.provider,
    enabled: false,
  });
  assert.deepEqual(await phone.provider.models.list(), []);
});

test("unfinished uploads are refused without waiting for the remaining body", async () => {
  const { host } = await desktop();
  const state = sharing(await host.call("host.mobile.start", { reach: "simulator" }));
  for (const input of [
    { token: undefined, body: "{", status: 401 },
    { token: state.token, body: "x".repeat(1024 * 1024 + 1), status: 413 },
  ]) {
    const response = Promise.withResolvers<number | undefined>();
    const upload = request(
      `${state.address}/v1/call/sessions.create`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
        },
      },
      (incoming) => {
        incoming.resume();
        response.resolve(incoming.statusCode);
      },
    );
    upload.on("error", response.reject);
    try {
      // No end(): the listener must answer without waiting for the rest of this upload.
      upload.write(input.body);
      assert.equal(await response.promise, input.status);
    } finally {
      upload.destroy();
    }
  }
  assert.deepEqual((await host.call("sessions.list", {})).items, []);
});

test("disconnecting before a watch's first event aborts its pending SDK read", async () => {
  const { host } = await desktop();
  const { sdk } = await host.prepare();
  const session = await sdk.sessions.create({});
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const release = Promise.withResolvers<void>();
  const share = await startMobileShare({
    sdk: {
      ...sdk,
      async *watch(input) {
        // Hold the initial store read until the client has had time to leave.
        started.resolve(input.signal);
        await release.promise;
        yield* sdk.watch(input);
      },
    },
    version: "test",
    attach: () => undefined,
  });
  cleanups.push(() => share.stop());
  const controller = new AbortController();
  const response = fetch(`${share.address}/v1/watch?sessionId=${session.sessionId}&live=1`, {
    headers: { authorization: `Bearer ${share.token}` },
    signal: controller.signal,
  }).catch(() => undefined);
  try {
    const signal = await started.promise;
    assert.ok(signal);
    controller.abort();
    await vi.waitFor(() => assert.equal(signal.aborted, true));
  } finally {
    controller.abort();
    release.resolve();
    await response;
  }
});

test("stopping ends the phone's streams and connections while the desktop keeps working", async () => {
  const { host, events } = await desktop();
  const session = await host.call("sessions.create", {});
  const first = sharing(await host.call("host.mobile.start", { reach: "simulator" }));
  const phone = createNyteClient({ baseUrl: first.address, token: first.token });

  const received: string[] = [];
  // Settles with the reason the stream ended; the stop below is what ends it.
  const watchEnd = (async () => {
    for await (const event of phone.watch({ sessionId: session.sessionId, live: true })) {
      received.push(event.kind);
    }
  })().then(
    () => "ended without an error",
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );
  await vi.waitFor(() => assert.ok(received.includes("synced")));

  await host.call("host.mobile.stop", undefined);
  // Only the share is asserted here; the tailnet reading depends on the machine.
  assert.equal((await host.call("host.mobile.state", undefined)).kind, "off");
  assert.match(await watchEnd, /closed/);
  await assert.rejects(fetch(`${first.address}/v1/info`));
  assert.deepEqual(events.filter((event) => event.kind === "mobile_share_changed").length, 2);

  // The desktop SDK is untouched: it still answers, and a restart mints a new token.
  assert.equal(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.sessionId,
    session.sessionId,
  );
  const second = sharing(await host.call("host.mobile.start", { reach: "simulator" }));
  assert.notEqual(second.token, first.token);
  assert.equal(
    (await createNyteClient({ baseUrl: second.address, token: second.token }).info()).version,
    "test",
  );
});

test("the share stays on the folder selected when it started", async () => {
  const { host, root } = await desktop();
  const home = sharing(await host.call("host.mobile.start", { reach: "simulator" }));
  const phone = createNyteClient({ baseUrl: home.address, token: home.token });

  const opened = await host.call("host.openWorkspace", { path: root });
  assert.equal(opened.kind, "opened");
  const inProject = await host.call("sessions.create", { name: "project chat" });

  // Selection moved; the share did not, and nothing from the folder leaks through it.
  const state = await host.call("host.mobile.state", undefined);
  assert.deepEqual(sharing(state).target, { kind: "home" });
  const seen = await phone.sessions.list({ parent: null, includeArchived: true });
  assert.equal(
    seen.items.some((session) => session.sessionId === inProject.sessionId),
    false,
  );
  await assert.rejects(phone.sessions.rename({ sessionId: inProject.sessionId, name: "x" }));
});
