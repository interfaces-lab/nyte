/**
 * A host runtime behind the headless listener: who may do what, how a folder
 * becomes a workspace, and how a root starts exactly once. Every call goes
 * through `@nyte-ai/client` over a real loopback listener.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import { sessionId } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import {
  openHostRuntime,
  openProfile,
  ProfileLocked,
  readProfile,
  verifyIdentityChallenge,
} from "@nyte-ai/host/runtime";
import type { HostRuntime, Principal } from "@nyte-ai/host/runtime";
import type { Api, Model } from "@nyte-ai/schema";
import type { StartInput } from "@nyte-ai/protocol";
import { WorkspaceRegistry } from "../../host/src/runtime/registry.ts";
import { StartJournal, startInputHash } from "../../host/src/runtime/starts.ts";
import { startHeadless } from "../src/headless.ts";

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

const nonce = () => randomBytes(24).toString("base64url");

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-headless-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  vi.stubEnv("NYTE_HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const plain = join(root, "plain");
  await mkdir(plain);
  const project = join(root, "project");
  await mkdir(join(project, ".nyte", "plugins"), { recursive: true });
  await writeFile(join(plain, "hello.txt"), "hi\n");
  return { root, home, plain, project };
}

/** A second bearer the runtime answers as a controller device. */
const CONTROLLER_TOKEN = "controller-token-controller-token";

async function run(home: string, name = "default") {
  const profile = await openProfile(name, home);
  const runtime: HostRuntime = await openHostRuntime({
    profile,
    store: new SqliteStore(profile.storePath),
    models: offlineModels(),
    model,
    onDiagnostic: () => undefined,
    devices: async (request) => {
      const header = request.headers.get("authorization");
      const controller: Principal = { kind: "device", id: "phone", grant: "controller" };

      return header === `Bearer ${CONTROLLER_TOKEN}` ? controller : undefined;
    },
  });
  cleanups.push(() => runtime.close());
  const serving = await startHeadless({ runtime, version: "test" });
  cleanups.push(() => serving.close());
  const owner = createNyteClient({ baseUrl: serving.address, token: profile.token });
  const controller = createNyteClient({ baseUrl: serving.address, token: CONTROLLER_TOKEN });
  const stranger = createNyteClient({ baseUrl: serving.address, token: "wrong-token-wrong-token" });
  return { profile, runtime, serving, owner, controller, stranger };
}

const startInput = (workspace: string, requestId: string, text = "hello"): StartInput => ({
  requestId,
  workspace: { id: workspace },
  message: { content: text },
});

async function wireCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (error instanceof NyteWireError) return error.code;
    throw error;
  }
  return "ok";
}

/** A registered, policy-ready folder on a running host. */
async function registered(owner: ReturnType<typeof createNyteClient>, path: string) {
  const outcome = await owner.environment("environment.workspaces.register", { path });
  assert.equal(outcome.kind, "registered");
  if (outcome.kind !== "registered") throw new Error("unreachable");
  return outcome.workspace;
}

test("info names the identity and registry, and the signed nonce verifies against the pinned key", async () => {
  const { home } = await fixture();
  const { owner, profile } = await run(home);
  const info = await owner.info();
  assert.deepEqual(info.workspaces, { kind: "registry" });
  assert.equal(info.identity?.hostId, profile.hostId);
  const pinned = { hostId: profile.hostId, publicKey: profile.publicKey };

  const asked = nonce();
  const challenge = await owner.identity(asked);
  assert.equal(verifyIdentityChallenge({ challenge, pinned, nonce: asked }), true);
  assert.equal(verifyIdentityChallenge({ challenge, pinned, nonce: nonce() }), false);
  assert.equal(
    verifyIdentityChallenge({
      challenge: { ...challenge, epoch: challenge.epoch + 1 },
      pinned,
      nonce: asked,
    }),
    false,
  );
  const other = await openProfile("other", home);
  cleanups.push(() => other.release());
  assert.equal(
    verifyIdentityChallenge({
      challenge,
      pinned: { hostId: other.hostId, publicKey: other.publicKey },
      nonce: asked,
    }),
    false,
  );
});

test("a profile has one live owner; reading it creates nothing and takes no lock", async () => {
  const { home } = await fixture();
  assert.equal(await readProfile("fresh", home), undefined);
  await assert.rejects(readFile(join(home, "hosts", "fresh", "identity.json")), { code: "ENOENT" });
  const { profile } = await run(home);
  await assert.rejects(openProfile("default", home), ProfileLocked);
  const saved = await readProfile("default", home);
  assert.equal(saved?.hostId, profile.hostId);
  const second = await openProfile("second", home);
  cleanups.push(() => second.release());
  assert.notEqual(second.hostId, profile.hostId);
  assert.notEqual(second.storePath, profile.storePath);
});

test("concurrent openers of one profile yield exactly one owner, and release hands it on", async () => {
  const { home } = await fixture();
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () => openProfile("raced", home)),
  );
  const winners = attempts.flatMap((attempt) =>
    attempt.status === "fulfilled" ? [attempt.value] : [],
  );
  assert.equal(winners.length, 1);

  for (const attempt of attempts) {
    if (attempt.status === "rejected") assert.ok(attempt.reason instanceof ProfileLocked);
  }

  const [winner] = winners;
  if (winner === undefined) return;
  await winner.release();
  const next = await openProfile("raced", home);
  cleanups.push(() => next.release());
  assert.equal(next.hostId, winner.hostId);
});

/** A separate Node process that opens a profile and holds it until told to stop. */
function holdProfileElsewhere(name: string, home: string): Promise<ChildProcess> {
  const profileModule = fileURLToPath(
    new URL("../../host/src/runtime/profile.ts", import.meta.url),
  );
  const script = `
    const { openProfile } = await import(${JSON.stringify(profileModule)});
    const profile = await openProfile(${JSON.stringify(name)}, ${JSON.stringify(home)});
    process.stdout.write(profile.hostId + "\\n");
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  cleanups.push(async () => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  return new Promise((resolve, reject) => {
    child.stdout.once("data", () => resolve(child));
    child.once("exit", (code) => reject(new Error(`holder exited ${String(code)}`)));
  });
}

test("ownership holds across processes and ends with the holder, cleanly or not", async () => {
  const { home } = await fixture();
  const holder = await holdProfileElsewhere("shared", home);
  await assert.rejects(openProfile("shared", home), ProfileLocked);
  const exited = new Promise<void>((resolve) => holder.once("exit", () => resolve()));
  holder.kill("SIGKILL");
  await exited;
  const taken = await openProfile("shared", home);
  cleanups.push(() => taken.release());
});

test("a wrong bearer is refused before anything is read or written", async () => {
  const { home, plain } = await fixture();
  const { stranger, profile } = await run(home);
  assert.equal(await wireCode(() => stranger.info()), "forbidden");
  assert.equal(
    await wireCode(() => stranger.environment("environment.workspaces.register", { path: plain })),
    "forbidden",
  );
  await assert.rejects(readFile(profile.registryPath), { code: "ENOENT" });
});

test("the owner registers, then grants; a folder with project input waits for the grant", async () => {
  const { home, plain, project } = await fixture();
  const { owner } = await run(home);

  assert.deepEqual(
    await owner.environment("environment.workspaces.register", { path: "relative/path" }),
    { kind: "not_absolute", path: "relative/path" },
  );
  assert.equal(
    (await owner.environment("environment.workspaces.register", { path: join(plain, "hello.txt") }))
      .kind,
    "not_directory",
  );

  const open = await registered(owner, plain);
  assert.deepEqual(open.trust, { kind: "policy" });
  assert.equal(open.path, plain);
  assert.equal(
    (await owner.environment("environment.workspaces.register", { path: plain })).kind,
    "exists",
  );

  const withInput = await registered(owner, project);
  assert.deepEqual(withInput.trust, { kind: "none" });
  assert.deepEqual(await owner.environment("environment.start", startInput(withInput.id, "r1")), {
    kind: "refused",
    reason: "workspace_untrusted",
  });

  const stale = await owner.environment("environment.workspaces.trust", {
    id: withInput.id,
    path: project,
    identity: "not-what-was-shown",
  });
  assert.equal(stale.kind, "identity_changed");
  assert.deepEqual(
    await owner.environment("environment.workspaces.trust", {
      id: withInput.id,
      path: plain,
      identity: withInput.identity,
    }),
    { kind: "path_mismatch", path: project },
  );

  const granted = await owner.environment("environment.workspaces.trust", {
    id: withInput.id,
    path: project,
    identity: withInput.identity,
  });
  assert.equal(granted.kind, "granted");
  if (granted.kind !== "granted") return;
  assert.equal(granted.workspace.trust.kind, "granted");
  assert.equal(
    (await owner.environment("environment.start", startInput(withInput.id, "r1"))).kind,
    "accepted",
  );
});

test("a granted path that comes to name another directory is changed, not served", async () => {
  const { home, root, project } = await fixture();
  const { owner } = await run(home);
  const row = await registered(owner, project);
  const granted = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: row.identity,
  });
  assert.equal(granted.kind, "granted");

  // Swap the folder for a symlink to somewhere else.
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await rm(project, { recursive: true, force: true });
  await symlink(elsewhere, project);

  const [listed] = await owner.environment("environment.workspaces.list", undefined);
  assert.deepEqual(listed?.trust, { kind: "changed" });
  assert.deepEqual(await owner.environment("environment.start", startInput(row.id, "r2")), {
    kind: "refused",
    reason: "workspace_untrusted",
  });
  assert.equal(
    await wireCode(() => owner.workspace.files({ target: { kind: "registered", id: row.id } })),
    "forbidden",
  );
  // A fresh grant must look again: the identity shown earlier no longer names the folder.
  const again = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: row.identity,
  });
  assert.equal(again.kind, "identity_changed");
});

test("the shared cursor, bare root creation and default-folder targets are refused; registered targets serve files", async () => {
  const { home, plain } = await fixture();
  const { owner, controller } = await run(home);
  assert.equal(await wireCode(() => owner.sessions.create()), "forbidden");
  assert.equal(await wireCode(() => owner.workspace.select({ kind: "home" })), "forbidden");
  assert.equal(await wireCode(() => owner.workspace.current()), "forbidden");
  assert.equal(await wireCode(() => controller.workspace.list()), "forbidden");
  assert.equal(
    await wireCode(() => owner.workspace.files({ target: { kind: "workspace" } })),
    "forbidden",
  );
  assert.equal(
    await wireCode(() => owner.workspace.files({ target: { kind: "registered", id: "nope" } })),
    "forbidden",
  );

  const row = await registered(owner, plain);
  const files = await owner.workspace.files({ target: { kind: "registered", id: row.id } });
  assert.deepEqual(
    files.map((file) => file.displayPath),
    ["hello.txt"],
  );
  const document = await owner.workspace.read({
    target: { kind: "registered", id: row.id },
    path: "hello.txt",
  });
  assert.equal(document.kind === "text" ? document.contents : undefined, "hi\n");
  assert.equal(
    await wireCode(() =>
      owner.workspace.read({ target: { kind: "workspace" }, path: "hello.txt" }),
    ),
    "forbidden",
  );
});

test("a controller drives sessions but cannot expose folders or administer providers", async () => {
  const { home, plain } = await fixture();
  const { owner, controller } = await run(home);
  assert.equal(
    await wireCode(() =>
      controller.environment("environment.workspaces.register", { path: plain }),
    ),
    "forbidden",
  );
  assert.equal(
    await wireCode(() => controller.environment("environment.logout", { provider: "echo" })),
    "forbidden",
  );
  assert.equal(
    await wireCode(() => controller.environment("environment.github.state", undefined)),
    "unknown_operation",
  );
  const row = await registered(owner, plain);
  assert.equal((await controller.environment("environment.workspaces.list", undefined)).length, 1);
  const started = await controller.environment("environment.start", startInput(row.id, "c1"));
  assert.equal(started.kind, "accepted");
  if (started.kind !== "accepted") return;
  assert.ok(await controller.sessions.snapshot({ sessionId: started.sessionId }));
  assert.ok(await owner.sessions.snapshot({ sessionId: started.sessionId }));
});

test("the same request starts once: retries converge, changed input conflicts, the run completes", async () => {
  const { home, plain } = await fixture();
  const { owner } = await run(home);
  const { id } = await registered(owner, plain);

  const [first, second, other] = await Promise.all([
    owner.environment("environment.start", startInput(id, "same")),
    owner.environment("environment.start", startInput(id, "same")),
    owner.environment("environment.start", startInput(id, "same", "different text")),
  ]);
  assert.equal(first.kind, "accepted");
  assert.deepEqual(second, first);
  assert.deepEqual(other, { kind: "conflict" });
  assert.deepEqual(await owner.environment("environment.start", startInput(id, "same")), first);
  assert.deepEqual(await owner.environment("environment.start", startInput(id, "same", "other")), {
    kind: "conflict",
  });
  if (first.kind !== "accepted") return;

  const { items } = await owner.sessions.list({ parent: null });
  assert.deepEqual(
    items.map((info) => info.sessionId),
    [first.sessionId],
  );
  assert.equal(items[0]?.workspace.cwd, plain);

  // The host volunteered at startup; the admitted message runs without any client watching.
  await vi.waitFor(async () => {
    const snapshot = await owner.sessions.snapshot({ sessionId: first.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });
});

test("deleting a session tombstones its request first, even racing a retry", async () => {
  const { home, plain } = await fixture();
  const { owner } = await run(home);
  const { id } = await registered(owner, plain);
  const first = await owner.environment("environment.start", startInput(id, "d1"));
  assert.equal(first.kind, "accepted");
  if (first.kind !== "accepted") return;

  const [, retry] = await Promise.all([
    owner.sessions.delete({ sessionId: first.sessionId }),
    owner.environment("environment.start", startInput(id, "d1")),
  ]);
  assert.ok(
    retry.kind === "conflict" ||
      (retry.kind === "refused" && retry.reason === "deleted") ||
      (retry.kind === "accepted" && retry.sessionId === first.sessionId),
  );
  assert.deepEqual(await owner.environment("environment.start", startInput(id, "d1")), {
    kind: "refused",
    reason: "deleted",
  });
  assert.deepEqual((await owner.sessions.list({ parent: null })).items, []);
  assert.equal(
    (await owner.environment("environment.start", startInput(id, "d2"))).kind,
    "accepted",
  );
});

test("a root a crash left in the default folder is bound to its workspace before anything else sees it", async () => {
  const { home, plain } = await fixture();
  const { owner, runtime, profile } = await run(home);
  const { id } = await registered(owner, plain);
  const input = startInput(id, "half", "finish me");
  const minted = sessionId("22222222-2222-4222-8222-222222222222");

  // The store row exists in the host's default folder; the start record never advanced.
  await runtime.sdk.sessions.create({ sessionId: minted });
  const journal = new StartJournal(profile.startsPath);
  journal.begin({
    principal: "owner",
    requestId: input.requestId,
    inputHash: startInputHash(input),
    input: JSON.stringify(input),
    workspaceId: id,
    sessionId: minted,
    messageKey: input.requestId,
  });
  journal.close();

  // Unsealed: invisible and immutable to clients.
  assert.equal(await owner.sessions.get({ sessionId: minted }), undefined);
  assert.deepEqual((await owner.sessions.list({ parent: null })).items, []);
  assert.equal(
    await wireCode(() => owner.messages.send({ sessionId: minted, content: "sneak" })),
    "forbidden",
  );

  const resumed = await owner.environment("environment.start", input);
  assert.equal(resumed.kind, "accepted");
  if (resumed.kind !== "accepted") return;
  assert.equal(resumed.sessionId, minted);
  const info = await owner.sessions.get({ sessionId: minted });
  assert.equal(info?.workspace.cwd, plain);
});

test("a start whose minted session is already bound to another real folder refuses to move it", async () => {
  const { home, plain, root } = await fixture();
  const { owner, runtime, profile } = await run(home);
  const { id } = await registered(owner, plain);
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  const input = startInput(id, "foreign", "do not move me");
  const minted = sessionId("44444444-4444-4444-8444-444444444444");
  const environment = (await runtime.sdk.sessions.create({ sessionId: minted })).workspace.id;
  await runtime.sdk.sessions.delete({ sessionId: minted });
  await runtime.sdk.sessions.create({
    sessionId: minted,
    workspace: { kind: "local", id: environment, cwd: elsewhere },
  });
  const journal = new StartJournal(profile.startsPath);
  journal.begin({
    principal: "owner",
    requestId: input.requestId,
    inputHash: startInputHash(input),
    input: JSON.stringify(input),
    workspaceId: id,
    sessionId: minted,
    messageKey: input.requestId,
  });
  journal.close();

  assert.equal(await wireCode(() => owner.environment("environment.start", input)), "internal");
  // Nothing moved, nothing admitted: the record is still allocated and the session stays unsealed.
  assert.equal(await owner.sessions.get({ sessionId: minted }), undefined);
  const after = new StartJournal(profile.startsPath);
  assert.deepEqual(
    after.pending().map((record) => [record.requestId, record.state]),
    [["foreign", "allocated"]],
  );
  after.close();
});

test("what an interrupted delete leaves behind is hidden, immutable and never driven again", async () => {
  const { home, plain } = await fixture();
  const { owner, profile } = await run(home);
  const { id } = await registered(owner, plain);
  const first = await owner.environment("environment.start", startInput(id, "gone"));
  assert.equal(first.kind, "accepted");
  if (first.kind !== "accepted") return;
  await vi.waitFor(async () => {
    const snapshot = await owner.sessions.snapshot({ sessionId: first.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });

  // The tombstone landed, the store delete never did.
  const journal = new StartJournal(profile.startsPath);
  journal.tombstone(first.sessionId);
  journal.close();

  assert.equal(await owner.sessions.get({ sessionId: first.sessionId }), undefined);
  assert.deepEqual((await owner.sessions.list({ parent: null })).items, []);
  assert.equal(
    await wireCode(() => owner.messages.send({ sessionId: first.sessionId, content: "again" })),
    "forbidden",
  );
  assert.equal(
    await wireCode(async () => {
      for await (const event of owner.watch({ sessionId: first.sessionId, live: true })) void event;
    }),
    "forbidden",
  );
});

test("a session's mutations stop when its folder stops being ready, while its history stays readable", async () => {
  const { home, root, project } = await fixture();
  const { owner } = await run(home);
  const row = await registered(owner, project);
  const granted = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: row.identity,
  });
  assert.equal(granted.kind, "granted");
  const started = await owner.environment("environment.start", startInput(row.id, "s1"));
  assert.equal(started.kind, "accepted");
  if (started.kind !== "accepted") return;
  await vi.waitFor(async () => {
    const snapshot = await owner.sessions.snapshot({ sessionId: started.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });
  assert.equal(
    await wireCode(() =>
      owner.workspace.files({ target: { kind: "session", sessionId: started.sessionId } }),
    ),
    "ok",
  );

  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await rm(project, { recursive: true, force: true });
  await symlink(elsewhere, project);

  assert.ok(await owner.sessions.snapshot({ sessionId: started.sessionId }));
  assert.equal(
    await wireCode(() => owner.messages.send({ sessionId: started.sessionId, content: "more" })),
    "forbidden",
  );
  assert.equal(
    await wireCode(() =>
      owner.workspace.files({ target: { kind: "session", sessionId: started.sessionId } }),
    ),
    "forbidden",
  );
});

test("startup resumes the owner's half-done start from its stored input; a device's waits for its retry", async () => {
  const { home, plain } = await fixture();
  const profile = await openProfile("default", home);
  const registry = new WorkspaceRegistry({ path: profile.registryPath });
  const row = await registry.register(plain);
  assert.equal(row.kind, "registered");
  if (row.kind !== "registered") return;
  const ownerStart = startInput(row.workspace.id, "crashed", "finish me");
  const deviceStart = startInput(row.workspace.id, "phone-crashed", "finish me too");
  const journal = new StartJournal(profile.startsPath);
  const seed = (principal: string, input: StartInput, id: string) =>
    journal.begin({
      principal,
      requestId: input.requestId,
      inputHash: startInputHash(input),
      input: JSON.stringify(input),
      workspaceId: input.workspace.id,
      sessionId: id,
      messageKey: input.requestId,
    });
  seed("owner", ownerStart, "11111111-1111-4111-8111-111111111111");
  seed("device:phone", deviceStart, "33333333-3333-4333-8333-333333333333");
  journal.close();
  await profile.release();

  const { owner, controller } = await run(home);
  const { items } = await owner.sessions.list({ parent: null });
  assert.deepEqual(
    items.map((info) => info.sessionId),
    ["11111111-1111-4111-8111-111111111111"],
  );
  await vi.waitFor(async () => {
    const snapshot = await owner.sessions.snapshot({ sessionId: items[0]!.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });

  // The device's record completes only on its own authenticated retry.
  const resumed = await controller.environment("environment.start", deviceStart);
  assert.equal(resumed.kind, "accepted");
  if (resumed.kind !== "accepted") return;
  assert.equal(resumed.sessionId, "33333333-3333-4333-8333-333333333333");
});

async function admittedRoot(
  owner: ReturnType<typeof createNyteClient>,
  workspace: string,
  requestId: string,
) {
  const started = await owner.environment("environment.start", startInput(workspace, requestId));
  assert.equal(started.kind, "accepted");
  if (started.kind !== "accepted") throw new Error("unreachable");
  await vi.waitFor(async () => {
    const snapshot = await owner.sessions.snapshot({ sessionId: started.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
  });
  return started.sessionId;
}

test("start and forget serialize on the folder: never accepted work in a forgotten workspace", async () => {
  const { home, plain, project } = await fixture();
  const { owner, profile } = await run(home);
  const { id } = await registered(owner, plain);

  const [started, forgotten] = await Promise.all([
    owner.environment("environment.start", startInput(id, "race")),
    owner.environment("environment.workspaces.forget", { id }),
  ]);
  assert.equal(started.kind, "accepted");
  assert.equal(forgotten.kind, "busy");
  assert.equal((await owner.environment("environment.workspaces.list", undefined)).length, 1);

  // A start that allocated but has not created its root yet also holds the folder.
  const other = await registered(owner, project);
  const journal = new StartJournal(profile.startsPath);
  const input = startInput(other.id, "allocated-only");
  journal.begin({
    principal: "owner",
    requestId: input.requestId,
    inputHash: startInputHash(input),
    input: JSON.stringify(input),
    workspaceId: other.id,
    sessionId: "55555555-5555-4555-8555-555555555555",
    messageKey: input.requestId,
  });
  journal.close();
  assert.deepEqual(await owner.environment("environment.workspaces.forget", { id: other.id }), {
    kind: "busy",
    sessionId: "55555555-5555-4555-8555-555555555555",
  });
});

test("a child inherits its root's tree state, and deleting a root deletes the tree", async () => {
  const { home, plain } = await fixture();
  const { owner, runtime, profile } = await run(home);
  const { id } = await registered(owner, plain);
  const root = await admittedRoot(owner, id, "tree");
  const child = sessionId("66666666-6666-4666-8666-666666666666");
  await runtime.sdk.sessions.create({
    sessionId: child,
    parent: { sessionId: root, runId: "run-1", callId: "call-1", depth: 1 },
  });
  assert.ok(await owner.sessions.get({ sessionId: child }));
  assert.equal(await wireCode(() => owner.messages.send({ sessionId: child, content: "hi" })), "ok");

  // An interrupted root deletion: the tombstone landed, the store rows did not go.
  const journal = new StartJournal(profile.startsPath);
  journal.tombstone(root);
  journal.close();

  assert.equal(await owner.sessions.get({ sessionId: child }), undefined);
  assert.equal(await wireCode(() => owner.messages.send({ sessionId: child, content: "more" })), "forbidden");
  assert.equal(await wireCode(() => owner.sessions.rename({ sessionId: child, name: "x" })), "forbidden");
  assert.equal(
    await wireCode(async () => {
      for await (const event of owner.watch({ sessionId: child, live: true })) void event;
    }),
    "forbidden",
  );

  // Deletion still converges on the tombstoned tree, children included.
  assert.equal(await wireCode(() => owner.sessions.delete({ sessionId: root })), "ok");
  assert.equal(await runtime.sdk.sessions.get({ sessionId: child }), undefined);
  assert.equal(await runtime.sdk.sessions.get({ sessionId: root }), undefined);
  assert.deepEqual((await owner.sessions.list({ parent: null })).items, []);
});

test("an interrupted deletion finishes at the next startup", async () => {
  const { home, plain } = await fixture();
  const first = await run(home);
  const { id } = await registered(first.owner, plain);
  const root = await admittedRoot(first.owner, id, "startup-delete");
  await first.serving.close();
  await first.runtime.close();

  const journal = new StartJournal(first.profile.startsPath);
  journal.tombstone(root);
  journal.close();

  const second = await run(home);
  // Nothing visible, nothing left in the store, and the folder is free again.
  assert.deepEqual((await second.owner.sessions.list({ parent: null })).items, []);
  assert.deepEqual(await second.owner.environment("environment.workspaces.forget", { id }), {
    kind: "forgotten",
  });
});

test("losing the folder keeps stop and delete, and the owner can consent to a recreated folder", async () => {
  const { home, root: tmp, project } = await fixture();
  const { owner } = await run(home);
  const row = await registered(owner, project);
  const granted = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: row.identity,
  });
  assert.equal(granted.kind, "granted");
  const session = await admittedRoot(owner, row.id, "stoppable");

  // The folder is replaced by a different directory at the same path.
  await rm(project, { recursive: true, force: true });
  await mkdir(join(project, ".nyte", "plugins"), { recursive: true });

  assert.equal(await wireCode(() => owner.messages.send({ sessionId: session, content: "x" })), "forbidden");
  assert.equal(await wireCode(() => owner.runs.abort({ sessionId: session })), "ok");
  assert.equal(await wireCode(() => owner.sessions.rename({ sessionId: session, name: "kept" })), "ok");
  assert.equal(await wireCode(() => owner.sessions.delete({ sessionId: session })), "ok");

  // Recovery: the list shows the new directory's identity; approving it is fresh consent.
  const [listed] = await owner.environment("environment.workspaces.list", undefined);
  assert.deepEqual(listed?.trust, { kind: "changed" });
  const stale = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: row.identity,
  });
  assert.equal(stale.kind, "identity_changed");
  const fresh = await owner.environment("environment.workspaces.trust", {
    id: row.id,
    path: project,
    identity: listed!.identity,
  });
  assert.equal(fresh.kind, "granted");
  assert.equal((await owner.environment("environment.start", startInput(row.id, "after"))).kind, "accepted");
  void tmp;
});

test("closing refuses new admission and settles what was admitted first", async () => {
  const { home, plain } = await fixture();
  const { owner, runtime, serving } = await run(home);
  const { id } = await registered(owner, plain);
  const [started] = await Promise.all([
    owner.environment("environment.start", startInput(id, "closing")).catch((error: unknown) => error),
    runtime.close(),
  ]);
  assert.ok(
    (typeof started === "object" && started !== null && "kind" in started && started.kind === "accepted") ||
      started instanceof NyteWireError,
  );
  await assert.rejects(runtime.start({ kind: "owner" }, startInput(id, "late")), { name: "HostClosing" });
  await serving.close();
});
