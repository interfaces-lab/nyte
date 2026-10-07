/**
 * The browser's side of a registry host, against a real host runtime in
 * this process: the owner adds a folder by its path on the host and consents
 * to it as shown, a controller device can only select what the owner
 * exposed, every browser's selection is its own, and a root start is on
 * record before the host hears of it and converges on the same chat by
 * request id, in the folder it was sent for.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
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
import type { NyteClient } from "@nyte-ai/client";
import { SqliteStore } from "@nyte-ai/core/store";
import { openHostRuntime, openProfile } from "@nyte-ai/host/runtime";
import type { HostRuntime, Principal } from "@nyte-ai/host/runtime";
import type { EnvironmentInput, EnvironmentOperation, EnvironmentOutput } from "@nyte-ai/protocol";
import type { Api, Model } from "@nyte-ai/schema";
import { SessionViewStateStore } from "../layout/session-view-state.ts";
import { reviewRecordedStarts } from "../recorded-starts.ts";
import { createRegistryController, readSelection } from "./registry.ts";
import { createMemoryStartJournal } from "./start-journal.ts";

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

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

function storage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

async function host(): Promise<{ readonly runtime: HostRuntime; readonly folder: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-web-registry-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv("NYTE_HOME", join(root, "home"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const folder = join(root, "project");
  await mkdir(join(folder, ".nyte", "plugins"), { recursive: true });
  const profile = await openProfile("default", join(root, "home"));
  const runtime = await openHostRuntime({
    profile,
    store: new SqliteStore(profile.storePath),
    models: offlineModels(),
    model,
    onDiagnostic: () => undefined,
  });
  cleanups.push(() => runtime.close());

  return { runtime, folder };
}

/**
 * The host as a caller reaches it over the wire, without the wire: the
 * runtime names the caller from its bearer, then the server's permission hook
 * and the handler run, both keyed by operation.
 */
async function clientFor(
  runtime: HostRuntime,
  caller: { readonly kind: "owner" } | { readonly kind: "device"; readonly id: string },
): Promise<Pick<NyteClient, "environment">> {
  const token = caller.kind === "owner" ? runtime.profile.token : `device-${caller.id}-token-0000`;
  const decision = await runtime.authorize(
    { headers: { get: (name) => (name === "authorization" ? `Bearer ${token}` : null) } },
    async () => {
      const principal: Principal =
        caller.kind === "device"
          ? { kind: "device", id: caller.id, grant: "controller" }
          : { kind: "owner" };

      return principal;
    },
  );

  if (decision.kind !== "allow") throw new Error("not authorized");
  const context = { principal: decision.principal };
  const handlers: {
    readonly [O in EnvironmentOperation]?: (
      input: EnvironmentInput<O>,
      context: { readonly principal: string | undefined },
    ) => Promise<EnvironmentOutput<O>>;
  } = runtime.environment;

  return {
    environment: async (operation, input) => {
      const handler = handlers[operation];

      if (handler === undefined) throw new Error(`unknown_operation ${operation}`);
      const permit = runtime.permissions.environment[operation];

      if (permit !== undefined && !(await permit(input, {}, context))) throw new Error("forbidden");

      return handler(input, context);
    },
  };
}

function controller(
  client: Pick<NyteClient, "environment">,
  binding: { readonly hostId: string; readonly principal: string },
  store = storage(),
  journal = createMemoryStartJournal(),
) {
  const events: string[] = [];
  const registry = createRegistryController({
    client,
    binding,
    storage: store,
    journal,
    platform: "linux",
    emit: (event) => events.push(event.kind),
  });

  return { registry, events, store, journal };
}

test("the owner adds a folder by its path on the host, trusts what was shown, and only then works in it here", async () => {
  const { runtime, folder } = await host();
  const binding = { hostId: runtime.profile.hostId, principal: "bearer" };
  const { registry, events, store } = controller(
    await clientFor(runtime, { kind: "owner" }),
    binding,
  );
  assert.equal((await registry.state()).workspace, undefined);

  // The host serves nothing in a folder with project input until it is trusted, so nothing is selected yet.
  const shown = await registry.open({ path: folder });
  assert.equal(shown.kind, "needs_trust");

  if (shown.kind !== "needs_trust") return;
  assert.equal(shown.path, folder);
  assert.equal(readSelection(store, binding), undefined);
  assert.equal((await registry.state()).workspace, undefined);
  assert.deepEqual((await registry.state()).binding, binding);
  assert.equal((await registry.open({ path: "relative/path" })).kind, "failed");

  assert.equal((await registry.trust({ path: folder })).kind, "failed");
  const trusted = await registry.trust({ path: folder, consent: shown.consent });
  assert.equal(trusted.kind, "opened");
  assert.equal(trusted.kind === "opened" && trusted.needsTrust, false);
  const [row] = await runtime.workspaces.list();
  assert.equal(row?.trust.kind, "granted");
  assert.equal((await registry.state()).workspace?.path, folder);
  assert.deepEqual(events, ["workspace_opened"]);
});

test("a controller cannot add folders but can select one the owner exposed; selections are per host and principal", async () => {
  const { runtime, folder } = await host();
  const owner = await clientFor(runtime, { kind: "owner" });
  const device = await clientFor(runtime, { kind: "device", id: "phone" });
  const store = storage();
  const phone = controller(
    device,
    { hostId: runtime.profile.hostId, principal: "device:phone" },
    store,
  );
  const laptop = controller(
    device,
    { hostId: runtime.profile.hostId, principal: "device:laptop" },
    store,
  );

  assert.equal((await phone.registry.open({ path: folder })).kind, "failed");
  assert.equal((await runtime.workspaces.list()).length, 0);
  const ownerRegistry = controller(owner, {
    hostId: runtime.profile.hostId,
    principal: "bearer",
  }).registry;
  await ownerRegistry.open({ path: folder });

  // Exposed but untrusted: the controller cannot grant it, and it is not selected.
  const untrusted = await phone.registry.open({ path: folder });
  const consent = untrusted.kind === "needs_trust" ? untrusted.consent : undefined;
  assert.notEqual(consent, undefined);
  assert.equal((await phone.registry.trust({ path: folder, consent })).kind, "failed");
  assert.equal((await runtime.workspaces.list())[0]?.trust.kind, "none");
  assert.equal((await phone.registry.state()).workspace, undefined);

  await trusted(ownerRegistry, folder);
  assert.equal((await phone.registry.open({ path: folder })).kind, "opened");
  assert.equal((await phone.registry.state()).workspace?.path, folder);
  // The other principal in the same browser storage has no selection of its own.
  assert.equal((await laptop.registry.state()).workspace, undefined);

  // Listings are scoped to the selected folder.
  const page = { items: [{ workspace: { cwd: folder } }, { workspace: { cwd: "/elsewhere" } }] };
  assert.deepEqual((await phone.registry.sessions(page)).items, [{ workspace: { cwd: folder } }]);
  assert.deepEqual((await laptop.registry.sessions(page)).items, []);
});

/**
 * The wire between this browser and the host, with the faults a network has:
 * the host acts on a start and its answer is lost, or the request never
 * arrives.
 */
function lossy(client: Pick<NyteClient, "environment">) {
  let fault: "answer_lost" | "request_lost" | undefined;

  const environment: NyteClient["environment"] = async (operation, input) => {
    const injected = operation === "environment.start" ? fault : undefined;

    if (injected === undefined) return client.environment(operation, input);
    fault = undefined;

    if (injected === "answer_lost") await client.environment(operation, input);
    throw new TypeError("Failed to fetch");
  };

  return {
    client: { environment },
    loseNextAnswer: () => {
      fault = "answer_lost";
    },
    loseNextRequest: () => {
      fault = "request_lost";
    },
  };
}

async function trusted(registry: ReturnType<typeof controller>["registry"], path: string) {
  const shown = await registry.open({ path });
  const granted = await registry.trust({
    path,
    consent: shown.kind === "needs_trust" ? shown.consent : undefined,
  });
  assert.equal(granted.kind, "opened");
}

async function roots(runtime: HostRuntime) {
  return (await runtime.sdk.sessions.list({ parent: null })).items.map((info) => ({
    sessionId: info.sessionId,
    cwd: info.workspace.cwd,
  }));
}

test("a first message whose answer was lost starts one chat in its own folder, by retry or after a reload", async () => {
  const { runtime, folder } = await host();
  const other = join(folder, "..", "other");
  await mkdir(other);
  const binding = { hostId: runtime.profile.hostId, principal: "bearer" };
  const wire = lossy(await clientFor(runtime, { kind: "owner" }));
  const { registry, store, journal } = controller(wire.client, binding);
  await trusted(registry, folder);

  wire.loseNextAnswer();
  assert.deepEqual(
    await registry.starts.start({ requestId: "req-1", message: { content: "one" } }),
    {
      kind: "unanswered",
    },
  );
  const [first] = await roots(runtime);
  assert.deepEqual(await registry.starts.list(), [
    { requestId: "req-1", message: { content: "one" }, outcome: { kind: "unanswered" } },
  ]);

  // The selection moves before the retry; the retry still names the folder it was sent for.
  await registry.open({ path: other });
  assert.deepEqual(await registry.starts.retry("req-1"), {
    kind: "accepted",
    sessionId: first?.sessionId,
  });
  assert.deepEqual(await roots(runtime), [{ sessionId: first?.sessionId, cwd: folder }]);
  assert.deepEqual(await registry.starts.list(), []);

  // Lost again, then the page reloads: the replay finds the same chat and keeps its answer on record.
  await registry.open({ path: folder });
  wire.loseNextAnswer();
  await registry.starts.start({ requestId: "req-2", message: { content: "two" } });
  await registry.open({ path: other });
  const second = (await roots(runtime)).find((root) => root.sessionId !== first?.sessionId);
  const reloaded = controller(wire.client, binding, store, journal);
  await reloaded.registry.replay();
  assert.deepEqual(await reloaded.registry.starts.list(), [
    {
      requestId: "req-2",
      message: { content: "two" },
      outcome: { kind: "accepted", sessionId: second?.sessionId },
    },
  ]);
  assert.equal((await roots(runtime)).length, 2);
  assert.equal(second?.cwd, folder);

  // Another host's browser shares the storage and journal, and neither sees nor sends this record.
  const stranger = controller(
    wire.client,
    { hostId: "other-host", principal: "bearer" },
    store,
    journal,
  );
  assert.deepEqual(await stranger.registry.starts.list(), []);
  assert.equal(await stranger.registry.starts.retry("req-2"), undefined);
});

test("a first message the host refuses after a reload comes back as a draft with its images", async () => {
  const { runtime, folder } = await host();
  const binding = { hostId: runtime.profile.hostId, principal: "bearer" };
  const wire = lossy(await clientFor(runtime, { kind: "owner" }));
  const { registry, store, journal } = controller(wire.client, binding);
  await trusted(registry, folder);
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" } as const;
  const content = [{ type: "text", text: "draw this" } as const, image];

  wire.loseNextRequest();
  assert.deepEqual(await registry.starts.start({ requestId: "req-1", message: { content } }), {
    kind: "unanswered",
  });
  // The folder is removed from the host before anyone asks again: the host refuses the start.
  await registry.forget({ path: folder });

  const reloaded = controller(wire.client, binding, store, journal);
  await reloaded.registry.replay();
  const drafts = new SessionViewStateStore();
  const notices = await reviewRecordedStarts({
    starts: reloaded.registry.starts,
    restore: (composer) => drafts.restoreBlank("primary", { composer, updatedAt: 0 }),
  });

  assert.deepEqual(
    notices.map((notice) => notice.kind),
    ["refused"],
  );
  const { composer } = drafts.readBlank("primary");
  assert.equal(composer.draft, "draw this");
  assert.deepEqual(
    composer.attachments.map((attachment) => attachment.content),
    [image],
  );
  assert.deepEqual(await reloaded.registry.starts.list(), []);
  assert.deepEqual(await roots(runtime), []);
});

test("trust grants the directory the owner was shown; a replacement stays untrusted until shown again", async () => {
  const { runtime, folder } = await host();
  const binding = { hostId: runtime.profile.hostId, principal: "bearer" };
  const { registry } = controller(await clientFor(runtime, { kind: "owner" }), binding);
  const shown = await registry.open({ path: folder });
  const consent = shown.kind === "needs_trust" ? shown.consent : undefined;
  assert.notEqual(consent, undefined);

  // The directory is swapped while the prompt is open.
  await rename(folder, `${folder}-before`);
  await mkdir(join(folder, ".nyte", "plugins"), { recursive: true });

  assert.equal((await registry.trust({ path: folder, consent })).kind, "failed");
  assert.notEqual((await runtime.workspaces.list())[0]?.trust.kind, "granted");
  const elsewhere = consent === undefined ? undefined : { ...consent, hostId: "other-host" };
  assert.equal((await registry.trust({ path: folder, consent: elsewhere })).kind, "failed");
  assert.notEqual((await runtime.workspaces.list())[0]?.trust.kind, "granted");

  await trusted(registry, folder);
  assert.equal((await runtime.workspaces.list())[0]?.trust.kind, "granted");
});
