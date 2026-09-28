/**
 * The desktop serving itself remotely: `@nyte-ai/serve` over the desktop's
 * own local SDK on a loopback listener. A client on that address must see the
 * same store the desktop reads, be refused without the token, lose its
 * streams when remote access stops, and keep reading the folder that was
 * selected when it started even after the desktop moves on.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient } from "@nyte-ai/client";
import type { Api, Model } from "@nyte-ai/schema";
import { localSessions } from "@nyte-ai/app/bridge.ts";
import type { HostEvent, RemoteAccessState } from "@nyte-ai/app/bridge.ts";
import { randomToken, startServe } from "@nyte-ai/serve";
import type { GitHubCommandRunner } from "@nyte-ai/host";
import { localDay } from "@nyte-ai/host/store-usage";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";

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

/** A run that reaches this stream proves a runner picked the message up. */
const failing: Provider["stream"] = () => {
  throw new Error("No provider in the share test");
};

/** Answers every turn with one input and one output token, so a run leaves usage behind. */
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

/** One offline model behind `stream`. */
function localModels(stream: Provider["stream"]): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
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

async function desktop(
  options: { readonly stream?: Provider["stream"]; readonly github?: GitHubCommandRunner } = {},
): Promise<{ host: DesktopHost; events: HostEvent[]; root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-remote-access-")));
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const appRoot = join(root, "web-app");
  await mkdir(appRoot);
  await writeFile(join(appRoot, "index.html"), "<!doctype html>");
  const events: HostEvent[] = [];
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: () => localModels(options.stream ?? failing),
    runGitHubCommand: options.github,
    appVersion: "test",
    appRoot,
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
        throw new Error("Browser is not used by share tests");
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
  cleanups.push(
    () => rm(root, { recursive: true, force: true }),
    () => host.close(),
  );
  return { host, events, root };
}

function serving(state: RemoteAccessState): Extract<RemoteAccessState, { kind: "serving" }> {
  assert.equal(state.kind, "serving");
  if (state.kind !== "serving") throw new Error("unreachable");
  return state;
}

test("a client on the remote address reads and drives the desktop's own Home store", async () => {
  const { host } = await desktop();
  const mine = await host.call(1, "sessions.create", { name: "from the desktop" });

  const [first, concurrent] = await Promise.all([
    host.call(1, "host.remote.start", { reach: "local" }),
    host.call(1, "host.remote.start", { reach: "local" }),
  ]);
  const state = serving(first);
  assert.equal(serving(concurrent).address, state.address);
  assert.match(state.address, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(state.pairingUrl.startsWith(state.address));
  assert.ok(state.pairingUrl.includes(state.token));
  assert.deepEqual(state.target, { kind: "home" });
  const client = createNyteClient({ baseUrl: state.address, token: state.token });
  assert.equal((await client.info()).version, "test");
  assert.deepEqual((await client.info()).host, {
    kind: "described",
    capabilities: { workspace: true },
    persistence: "durable",
  });

  // Same store: the desktop's chat is already there, and the client's chat lands in Home.
  const seen = await client.sessions.list({ parent: null, includeArchived: true });
  assert.deepEqual(
    seen.items.map((session) => session.sessionId),
    [mine.sessionId],
  );
  const theirs = await client.sessions.create({ name: "from the client" });
  const { directories } = await host.call(1, "host.sessionDirectory", undefined);
  assert.deepEqual(
    localSessions(directories, null)
      ?.map((session) => session.sessionId)
      .sort(),
    [mine.sessionId, theirs.sessionId].sort(),
  );
  await client.sessions.rename({ sessionId: theirs.sessionId, name: "renamed on the client" });
  assert.equal(
    (await host.call(1, "sessions.get", { sessionId: theirs.sessionId }))?.name,
    "renamed on the client",
  );

  // The desktop runs what the client submits: the run reaches the offline provider and fails there.
  const receipt = await client.messages.send({ sessionId: theirs.sessionId, content: "hello" });
  assert.equal(receipt.kind, "queued");
  await vi.waitFor(async () => {
    const info = await host.call(1, "sessions.get", { sessionId: theirs.sessionId });
    assert.ok(
      info?.heads.some((head) => head.run?.phase.kind === "failed"),
      "the desktop's runner drove the client's message to its provider failure",
    );
  });
});

test("a missing or wrong token is refused before anything is read", async () => {
  const { host } = await desktop();
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));

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

test("client model choices follow desktop provider and model preferences", async () => {
  const { host } = await desktop();
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: state.address, token: state.token });
  assert.deepEqual(
    (await client.provider.models.list()).map((entry) => entry.id),
    [model.id],
  );
  await host.call(1, "host.setPreference", {
    kind: "models",
    provider: model.provider,
    ids: [model.id],
    hidden: true,
  });
  assert.deepEqual(await client.provider.models.list(), []);
  await host.call(1, "host.setPreference", {
    kind: "models",
    provider: model.provider,
    ids: [model.id],
    hidden: false,
  });
  await host.call(1, "host.setPreference", {
    kind: "provider",
    provider: model.provider,
    enabled: false,
  });
  assert.deepEqual(await client.provider.models.list(), []);
});

test("unfinished uploads are refused without waiting for the remaining body", async () => {
  const { host } = await desktop();
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  for (const input of [
    { token: undefined, body: "{", status: 401 },
    { token: state.token, body: "x".repeat(8_388_608 + 1), status: 413 },
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
  assert.deepEqual((await host.call(1, "sessions.list", {})).items, []);
});

test("disconnecting before a watch's first event aborts its pending SDK read", async () => {
  const { host } = await desktop();
  const { sdk } = await host.prepare(1);
  const session = await sdk.sessions.create({});
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const release = Promise.withResolvers<void>();
  const share = await startServe({
    token: randomToken(),
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
  cleanups.push(() => share.close());
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

test("stopping ends the client's streams and connections while the desktop keeps working", async () => {
  const { host, events } = await desktop();
  const session = await host.call(1, "sessions.create", {});
  const first = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: first.address, token: first.token });

  const received: string[] = [];
  // Settles with the reason the stream ended; the stop below is what ends it.
  const watchEnd = (async () => {
    for await (const event of client.watch({ sessionId: session.sessionId, live: true })) {
      received.push(event.kind);
    }
  })().then(
    () => "ended without an error",
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );
  await vi.waitFor(() => assert.ok(received.includes("synced")));

  await host.call(1, "host.remote.stop", undefined);
  // Only the share is asserted here; the tailnet reading depends on the machine.
  assert.equal((await host.call(1, "host.remote.state", undefined)).kind, "off");
  assert.match(await watchEnd, /closed/);
  await assert.rejects(fetch(`${first.address}/v1/info`));
  assert.deepEqual(events.filter((event) => event.kind === "remote_access_changed").length, 2);

  // The desktop SDK is untouched: it still answers, and a restart mints a new token.
  assert.equal(
    (await host.call(1, "sessions.get", { sessionId: session.sessionId }))?.sessionId,
    session.sessionId,
  );
  const second = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  assert.notEqual(second.token, first.token);
  assert.equal(
    (await createNyteClient({ baseUrl: second.address, token: second.token }).info()).version,
    "test",
  );
});

test("the share stays on the folder selected when it started", async () => {
  const { host, root } = await desktop();
  const home = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: home.address, token: home.token });

  const opened = await host.call(1, "host.openWorkspace", { path: root });
  assert.equal(opened.kind, "opened");
  const inProject = await host.call(1, "sessions.create", { name: "project chat" });

  // Selection moved; the share did not, and nothing from the folder leaks through it.
  const state = await host.call(1, "host.remote.state", undefined);
  assert.deepEqual(serving(state).target, { kind: "home" });
  const seen = await client.sessions.list({ parent: null, includeArchived: true });
  assert.equal(
    seen.items.some((session) => session.sessionId === inProject.sessionId),
    false,
  );
  await assert.rejects(client.sessions.rename({ sessionId: inProject.sessionId, name: "x" }));
});

async function listedRepo(
  host: DesktopHost,
  root: string,
  trusted: boolean,
): Promise<{ readonly project: string; readonly workspace: { readonly path: string } }> {
  const project = join(root, "repo");
  await mkdir(project);
  await writeFile(join(project, "share-target-marker.txt"), "marker");
  const opened = await host.call(1, "host.openWorkspace", { path: project });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") throw new Error("openWorkspace did not open");
  if (trusted) await host.call(1, "host.trustWorkspace", { path: project });
  await host.call(1, "host.closeWorkspace", undefined);
  return { project, workspace: opened.workspace };
}

test("client workspace.select retargets the share and leaves Mac selection alone", async () => {
  const { host, root, events } = await desktop();
  const home = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: home.address, token: home.token });
  const { workspace } = await listedRepo(host, root, true);
  const early = await client.sessions.create({ name: "before select" });
  const mac = await host.call(1, "host.state", undefined);
  assert.equal(mac.workspace, undefined);
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
  const shareChanges = () =>
    events.filter((event) => event.kind === "remote_access_changed").length;

  const first = await client.workspace.select({ kind: "project", path: workspace.path });
  const second = await client.workspace.select({ kind: "project", path: workspace.path });
  assert.equal(first.kind, "opened");
  if (first.kind !== "opened") throw new Error("select did not open");
  assert.equal(first.selection.kind, "project");
  if (first.selection.kind !== "project") throw new Error("selection was not a project");
  assert.equal(first.selection.workspace.path, workspace.path);
  assert.deepEqual(first, second);
  assert.deepEqual(await host.call(1, "host.state", undefined), mac);
  assert.deepEqual(serving(await host.call(1, "host.remote.state", undefined)).target, {
    kind: "project",
    workspace: first.selection.workspace,
  });
  // The renderer invalidates share state on this event alone; the no-change
  // reselect must not repeat it.
  assert.equal(shareChanges(), 2);

  const projectChat = await client.sessions.create({ name: "after select" });
  const listed = await client.sessions.list({ parent: null, includeArchived: true });
  assert.equal(
    listed.items.some((session) => session.sessionId === early.sessionId),
    false,
  );
  assert.equal(
    listed.items.some((session) => session.sessionId === projectChat.sessionId),
    true,
  );
  const files = await client.workspace.files({
    target: { kind: "workspace" },
    query: "share-target-marker",
  });
  assert.equal(
    files.some((file) => file.label === "share-target-marker.txt"),
    true,
  );

  await client.sessions.rename({ sessionId: early.sessionId, name: "still here" });
  assert.equal((await client.sessions.get({ sessionId: early.sessionId }))?.name, "still here");

  assert.deepEqual(await client.workspace.select({ kind: "home" }), {
    kind: "opened",
    selection: { kind: "home" },
  });
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
  assert.equal(shareChanges(), 3);
  const homeListed = await client.sessions.list({ parent: null, includeArchived: true });
  assert.equal(
    homeListed.items.some((session) => session.sessionId === early.sessionId),
    true,
  );
  assert.equal(
    (
      await client.workspace.files({
        target: { kind: "workspace" },
        query: "share-target-marker",
      })
    ).some((file) => file.label === "share-target-marker.txt"),
    false,
  );
});

test("share sessions.list and create follow the parent session's workspace", async () => {
  const { host, root } = await desktop();
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: state.address, token: state.token });
  const { workspace } = await listedRepo(host, root, true);

  const early = await client.sessions.create({ name: "home session" });
  const selected = await client.workspace.select({ kind: "project", path: workspace.path });
  assert.equal(selected.kind, "opened");

  // early lives on Home; a child create must land beside it, not on the cursor.
  const child = await client.sessions.create({
    name: "child",
    parent: { sessionId: early.sessionId, runId: "run", callId: "call", depth: 1 },
  });
  const children = await client.sessions.list({ parent: early.sessionId });
  assert.ok(children.items.some((session) => session.sessionId === child.sessionId));
  assert.equal((await client.sessions.get({ sessionId: child.sessionId }))?.name, "child");

  // The project's own listing never sees either Home session.
  const projectRoots = await client.sessions.list({ parent: null, includeArchived: true });
  assert.ok(
    projectRoots.items.every(
      (session) => session.sessionId !== early.sessionId && session.sessionId !== child.sessionId,
    ),
  );
});

test("client workspace.forget drops the folder and re-seats the share on Home", async () => {
  const { host, root, events } = await desktop();
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: state.address, token: state.token });
  const { workspace } = await listedRepo(host, root, true);
  const selected = await client.workspace.select({ kind: "project", path: workspace.path });
  assert.equal(selected.kind, "opened");

  await client.workspace.forget({ path: workspace.path });
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
  assert.deepEqual(serving(await host.call(1, "host.remote.state", undefined)).target, {
    kind: "home",
  });
  assert.deepEqual(await client.workspace.list(), []);
  assert.equal(
    (await client.workspace.select({ kind: "project", path: workspace.path })).kind,
    "failed",
  );
  assert.equal(events.filter((event) => event.kind === "remote_access_changed").length, 3);
});

test("client workspace.forget of the Mac's open folder closes it on both sides", async () => {
  const { host, root, events } = await desktop();
  const { workspace } = await listedRepo(host, root, true);
  const opened = await host.call(1, "host.openWorkspace", { path: workspace.path });
  assert.equal(opened.kind, "opened");
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  assert.deepEqual(state.target, { kind: "project", workspace });
  const client = createNyteClient({ baseUrl: state.address, token: state.token });

  await client.workspace.forget({ path: workspace.path });
  assert.equal((await host.call(1, "host.state", undefined)).workspace, undefined);
  assert.deepEqual(serving(await host.call(1, "host.remote.state", undefined)).target, {
    kind: "home",
  });
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
  assert.ok(events.some((event) => event.kind === "workspace_closed"));
});

test("client workspace.select of an untrusted listed project is untrusted", async () => {
  const { host, root } = await desktop();
  const home = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: home.address, token: home.token });
  const { workspace } = await listedRepo(host, root, false);
  assert.deepEqual(await client.workspace.select({ kind: "project", path: workspace.path }), {
    kind: "untrusted",
    path: workspace.path,
  });
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
  assert.equal((await host.call(1, "host.state", undefined)).workspace, undefined);
});

test("client workspace.select of a missing listed project is unavailable", async () => {
  const { host, root } = await desktop();
  const home = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: home.address, token: home.token });
  const { project, workspace } = await listedRepo(host, root, true);
  await rm(project, { recursive: true, force: true });
  assert.deepEqual(await client.workspace.select({ kind: "project", path: workspace.path }), {
    kind: "unavailable",
    path: workspace.path,
  });
  assert.deepEqual(await client.workspace.current(), { kind: "home" });
});

test("a share call queued behind close fails instead of composing after teardown", async () => {
  const { host, root } = await desktop();
  const home = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: home.address, token: home.token });
  const { workspace } = await listedRepo(host, root, true);

  // `closed` flips before the lifecycle lock runs teardown, so the select lands
  // behind it on the serialized queue and must refuse rather than compose.
  const closing = host.close();
  assert.equal(
    (
      await client.workspace.select({ kind: "project", path: workspace.path }).catch(() => ({
        kind: "failed" as const,
      }))
    ).kind,
    "failed",
  );
  await client.workspace.forget({ path: workspace.path }).catch(() => undefined);
  await closing;
});

test("a remote client reads the Mac's catalog and usage and changes its preferences", async () => {
  // What the desktop answers, as it reads after crossing the wire.
  const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  const { host, events } = await desktop({ stream: replying });
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: state.address, token: state.token });
  assert.equal((await client.info()).environment, true);

  const catalog = await client.environment("environment.catalog", undefined);
  assert.deepEqual(catalog, wire(await host.call(1, "host.catalog", undefined)));
  assert.deepEqual(
    catalog.models.filter((entry) => entry.listed).map((entry) => entry.key),
    ["echo/echo"],
  );

  const session = await client.sessions.create({ name: "remote work" });
  await client.messages.send({ sessionId: session.sessionId, content: "hello" });
  const allTime = { sinceDay: null, untilDay: localDay(Date.now()) };
  const usage = await vi.waitFor(async () => {
    const report = await client.environment("environment.usage", allTime);
    assert.equal(report.entries[0]?.totals.tokens, 2);
    return report;
  });
  assert.deepEqual(
    usage.sessions.map((entry) => [entry.sessionId, entry.name]),
    [[session.sessionId, "remote work"]],
  );
  assert.deepEqual(usage.claudeCode, { kind: "missing" });
  assert.deepEqual(
    { ...usage, readAt: 0 },
    wire({ ...(await host.call(1, "host.usage", allTime)), readAt: 0 }),
  );

  const changed = await client.environment("environment.setPreference", {
    kind: "models",
    provider: model.provider,
    ids: [model.id],
    hidden: true,
  });
  assert.equal(changed.models.find((entry) => entry.key === "echo/echo")?.listed, false);
  assert.deepEqual(wire(await host.call(1, "host.catalog", undefined)), changed);
  assert.ok(events.some((event) => event.kind === "catalog_changed"));
});

test("remote GitHub state follows the folder the share serves", async () => {
  const calls: { readonly command: string; readonly cwd: string }[] = [];
  const completed = (stdout: string, code = 0, stderr = "") =>
    ({ kind: "completed", code, stdout, stderr }) as const;
  const github: GitHubCommandRunner = async (request) => {
    calls.push({ command: request.command, cwd: request.cwd });
    const [first, second] = request.args;
    if (request.command === "git") {
      if (first === "symbolic-ref") return completed("feature\n");
      return completed(second === undefined ? "origin\n" : "git@github.com:owner/repo.git\n");
    }
    if (first === "auth") return completed(JSON.stringify([{ active: true, state: "success" }]));
    if (first === "api") {
      return completed(JSON.stringify({ login: "octo", name: null, avatar_url: null }));
    }
    return completed("", 1, "no pull requests found for branch");
  };
  const { host, root } = await desktop({ github });
  const state = serving(await host.call(1, "host.remote.start", { reach: "local" }));
  const client = createNyteClient({ baseUrl: state.address, token: state.token });

  assert.deepEqual(await client.environment("environment.github.state", undefined), {
    kind: "ready",
    account: { login: "octo" },
    pullRequest: { kind: "none" },
  });
  assert.equal(
    calls.some((call) => call.command === "git"),
    false,
  );

  const { project, workspace } = await listedRepo(host, root, true);
  assert.equal(
    (await client.workspace.select({ kind: "project", path: workspace.path })).kind,
    "opened",
  );
  assert.deepEqual(await client.environment("environment.github.state", undefined), {
    kind: "ready",
    repository: {
      owner: "owner",
      name: "repo",
      remoteName: "origin",
      url: "https://github.com/owner/repo",
    },
    account: { login: "octo" },
    pullRequest: { kind: "none" },
  });
  assert.deepEqual(
    [...new Set(calls.filter((call) => call.command === "git").map((call) => call.cwd))],
    [project],
  );
});

test.skipIf(process.platform === "win32")(
  "a stopped share ends the sign-in it started, not the desktop's own",
  async () => {
    // The repair runs once per process; after it, PATH can point at a stand-in `gh`.
    await ensureShellEnvironment();
    const fake = await mkdtemp(join(tmpdir(), "nyte-fake-gh-"));
    cleanups.push(() => rm(fake, { recursive: true, force: true }));
    const starts = join(fake, "starts");
    await writeFile(
      join(fake, "gh"),
      `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(starts)}, process.pid + "\\n");
process.stderr.write("! First copy your one-time code: ABCD-1234\\n");
process.stderr.write("Open this URL to continue in your web browser: https://github.com/login/device\\n");
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", fake);
    const signedOut: GitHubCommandRunner = async (request) =>
      request.command === "git"
        ? { kind: "completed", code: 128, stdout: "", stderr: "" }
        : { kind: "completed", code: 1, stdout: "", stderr: "" };
    const { host, events } = await desktop({ github: signedOut });
    const kind = async () => (await host.call(1, "host.github.state", undefined)).kind;

    const first = serving(await host.call(1, "host.remote.start", { reach: "local" }));
    const client = createNyteClient({ baseUrl: first.address, token: first.token });
    assert.equal(
      (await client.environment("environment.github.signIn", undefined)).kind,
      "signing_in",
    );
    assert.equal(await kind(), "signing_in");
    assert.ok(events.some((event) => event.kind === "github_changed"));
    await host.call(1, "host.remote.stop", undefined);
    assert.equal(await kind(), "signed_out");

    assert.equal((await host.call(1, "host.github.signIn", undefined)).kind, "signing_in");
    const second = serving(await host.call(1, "host.remote.start", { reach: "local" }));
    const joined = createNyteClient({ baseUrl: second.address, token: second.token });
    assert.equal(
      (await joined.environment("environment.github.signIn", undefined)).kind,
      "signing_in",
    );
    await host.call(1, "host.remote.stop", undefined);
    assert.equal(await kind(), "signing_in");
    assert.equal((await host.call(1, "host.github.signOut", undefined)).kind, "signed_out");

    const pids = (await readFile(starts, "utf8")).trim().split("\n").map(Number);
    assert.equal(pids.length, 2);
    await vi.waitFor(() => {
      for (const pid of pids) assert.throws(() => process.kill(pid, 0));
    });
  },
);
