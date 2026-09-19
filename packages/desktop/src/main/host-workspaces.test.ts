import assert from "node:assert/strict";
import { createServer } from "node:net";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, test, vi } from "vitest";
import {
  contentText,
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { localSessions } from "../shared/ipc.ts";
import type { HostEvent, WatchEnvelope } from "../shared/ipc.ts";
import { loadSessionDirectory } from "../renderer/src/session-directory.ts";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { localDay } from "./usage.ts";
import { callIpc } from "./ipc-call.ts";
import { ipcDiagnostics } from "./errors.ts";
import { keys, loadLocalResources, queryClient } from "../renderer/src/queries.ts";

interface RendererHostFixture {
  current: DesktopHost | undefined;
}

const renderer = vi.hoisted(() => {
  const state: RendererHostFixture = { current: undefined };
  const host = (): DesktopHost => {
    if (state.current === undefined) throw new Error("No renderer host fixture selected");
    return state.current;
  };
  // The renderer uses the real host through the methods normally supplied by preload.
  vi.stubGlobal("window", {
    nyte: {
      host: {
        state: () => host().call("host.state", undefined),
        sessionDirectory: () => host().call("host.sessionDirectory", undefined),
        catalog: () => host().call("host.catalog", undefined),
      },
      workspace: { list: () => host().call("workspace.list", undefined) },
      plugins: { catalog: () => host().call("plugins.catalog", undefined) },
    },
  });
  return state;
});

afterAll(() => vi.unstubAllGlobals());

const directories: string[] = [];
const hosts: DesktopHost[] = [];
afterEach(async () => {
  queryClient.clear();
  renderer.current = undefined;
  for (const host of hosts.splice(0)) await host.close();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
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

/** An offline catalog with one provider that echoes the last user message. Nothing here reaches the network. */
function echoModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  const stream = (
    selected: Parameters<Provider["streamSimple"]>[0],
    context: Parameters<Provider["streamSimple"]>[1],
  ) => {
    const lastUser = context.messages.findLast((item) => item.role === "user");
    const text = contentText(lastUser?.content ?? "");
    const result = context.messages.findLast((item) => item.role === "toolResult");
    const delegate =
      (text === "delegate" || text === "delegate explore") &&
      result === undefined &&
      context.tools?.some((tool) => tool.name === "task") === true;
    const message: AssistantMessage = {
      role: "assistant",
      content: delegate
        ? [
            {
              type: "toolCall",
              id: "delegate-call",
              name: "task",
              arguments: {
                model: "echo/reasoning",
                prompt: "child work",
              },
            },
          ]
        : [{ type: "text", text: result === undefined ? text : contentText(result.content) }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      stopReason: delegate ? "toolUse" : "stop",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const events = createAssistantMessageEventStream();
    events.push({ type: "done", reason: delegate ? "toolUse" : "stop", message });
    return events;
  };
  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model, { ...model, id: "reasoning", name: "Reasoning", reasoning: true }],
    stream,
    streamSimple: stream,
  });
  return models;
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-workspaces-")));
  directories.push(root);
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const events: HostEvent[] = [];
  const watchEvents: WatchEnvelope[] = [];
  const createHost = () => {
    const host = new DesktopHost({
      storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
      createModels: echoModels,
      emitHostEvent: (event) => events.push(event),
      emitWatchEvent: (event) => watchEvents.push(event),
      openExternal: () => undefined,
      revealPath: () => undefined,
      showContextMenu: () => Promise.resolve(undefined),
      pickFolder: async () => undefined,
      listFonts: async () => ({ sans: [], monospace: [] }),
      browser: {
        menu: async () => undefined,
        perform: async () => undefined,
        open: () => {
          throw new Error("Browser is not used by workspace tests");
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
    hosts.push(host);
    return host;
  };
  return { root, events, watchEvents, createHost };
}

test("update activity follows running local tasks", async () => {
  const { createHost } = await fixture();
  const host = createHost();
  const session = await host.call("sessions.create", { name: "Update activity" });
  const job = await host.call("jobs.start", {
    sessionId: session.sessionId,
    command: "printf ready; sleep 30",
  });
  assert.equal(job.phase.kind, "running");
  assert.deepEqual(await host.updateActivity(), {
    kind: "busy",
    taskCount: 1,
    terminalCommandCount: 0,
  });

  await host.call("jobs.cancel", { sessionId: session.sessionId, jobId: job.id });
  await vi.waitFor(async () => {
    assert.deepEqual(await host.updateActivity(), { kind: "idle" });
  });
});

test("untrusted send queues once, reports the requirement, and runs after trust", async () => {
  const { root, events, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "project");
  await mkdir(path);
  const file = join(path, "README.md");
  await writeFile(file, "untrusted projects remain browsable\n");
  assert.equal((await host.call("host.openWorkspace", { path })).kind, "opened");
  const session = await host.call("sessions.create", { name: "Saved chat" });
  const document = await host.call("host.files.read", { path: file });
  assert.equal(document.kind, "text");
  if (document.kind === "text") {
    assert.equal(document.contents, "untrusted projects remain browsable\n");
  }
  const send = { sessionId: session.sessionId, content: "Continue", key: "continue" };
  assert.equal((await host.call("messages.send", send)).kind, "queued");
  assert.equal((await host.call("messages.send", send)).kind, "duplicate");
  // Session trust is the SDK's state, not a host event; the renderer reads it from the session.
  assert.equal(
    events.some((event) => event.kind === "workspace_trust_required"),
    false,
  );
  assert.deepEqual(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.activation,
    {
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: path },
    },
  );
  assert.deepEqual(await host.call("plugins.catalog", undefined), {
    plugins: [],
    commands: [],
    skills: [],
    settings: [],
  });
  await host.call("host.trustWorkspace", { path });
  await vi.waitFor(async () => {
    const snapshot = await host.call("sessions.snapshot", { sessionId: session.sessionId });
    assert.equal(snapshot?.pending.length, 0);
    assert.ok(snapshot?.transcript.some((turn) => turn.kind === "turn"));
  });
  assert.equal(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.name,
    "Saved chat",
  );
});

test("a skill added to a trusted project reaches the session without a restart", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "skills-project");
  await mkdir(join(path, ".nyte", "skills"), { recursive: true });
  assert.equal((await host.call("host.openWorkspace", { path })).kind, "opened");
  await host.call("host.trustWorkspace", { path });
  await host.call("sessions.create", { name: "Skills" });
  // The first catalog read resolves plugins, which is when the sources start being watched.
  const before = await host.call("plugins.catalog", undefined);
  assert.equal(
    before.skills.some((skill) => skill.name === "brew-tea"),
    false,
  );
  await mkdir(join(path, ".nyte", "skills", "brew-tea"));
  await writeFile(
    join(path, ".nyte", "skills", "brew-tea", "SKILL.md"),
    "---\nname: brew-tea\ndescription: Make a pot of tea\n---\nBoil the water first.\n",
  );
  await vi.waitFor(
    async () => {
      const catalog = await host.call("plugins.catalog", undefined);
      assert.ok(catalog.skills.some((skill) => skill.name === "brew-tea"));
    },
    { timeout: 10_000, interval: 100 },
  );
});

test("IPC keeps the SDK queued and duplicate receipts verbatim and redacts host trust failures", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "ipc-project");
  await mkdir(path);
  await host.call("host.openWorkspace", { path });
  const session = await host.call("sessions.create", { name: "IPC fixture" });
  const input = { sessionId: session.sessionId, content: "private prompt", key: "ipc-message" };
  const queued = await callIpc(() => host, { path: "messages.send", input });
  assert.equal(queued.ok, true);
  assert.equal(queued.path, "messages.send");
  assert.ok(queued.value !== null && queued.value !== undefined && "kind" in queued.value);
  assert.equal(queued.value.kind, "queued");
  const duplicate = await callIpc(() => host, { path: "messages.send", input });
  assert.deepEqual(duplicate, {
    ok: true,
    path: "messages.send",
    value: await host.call("messages.send", input),
  });
  const refused = await callIpc(() => host, {
    path: "host.terminal.create",
    input: { id: "terminal", workspacePath: path },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "forbidden");
  assert.equal(JSON.stringify(refused).includes(path), false);
  assert.equal(JSON.stringify(refused).includes("private prompt"), false);
});

test("IPC redacts a real host operation failure and retains one local diagnostic", async () => {
  const { createHost } = await fixture();
  const host = createHost();
  const before = new Set(ipcDiagnostics.keys());
  const reply = await callIpc(() => host, {
    path: "host.browser.open",
    input: { surface: "private-surface", url: "https://example.invalid/private-content" },
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, "internal");
  assert.ok(reply.error.correlationId);
  const cause = ipcDiagnostics.get(reply.error.correlationId);
  assert.ok(cause instanceof Error);
  assert.equal(cause.message, "Browser is not used by workspace tests");
  assert.equal([...ipcDiagnostics.keys()].filter((id) => !before.has(id)).length, 1);
  assert.doesNotMatch(JSON.stringify(reply), /private-surface|private-content|Browser is not used/);
});

test("watch pump forwards activation notices instead of interpreting them", async () => {
  const { root, events, watchEvents, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "watched-project");
  await mkdir(path);
  await host.call("host.openWorkspace", { path });
  const session = await host.call("sessions.create", { name: "Watched" });
  host.watchStart({ watchId: "activation", sessionId: session.sessionId, live: true });
  await vi.waitFor(() => {
    assert.ok(
      watchEvents.some(
        (envelope) =>
          envelope.kind === "event" &&
          envelope.event.kind === "activation_changed" &&
          envelope.event.activation.kind === "requires" &&
          envelope.event.activation.requirement.cwd === path,
      ),
    );
  });
  assert.equal(
    events.some((event) => event.kind === "workspace_trust_required"),
    false,
  );
  host.watchStop("activation");
});

test("watch errors preserve cursor metadata and release the watch id for a fresh subscription", async () => {
  const { createHost, watchEvents } = await fixture();
  const host = createHost();
  const session = await host.call("sessions.create", { name: "Watch cursor" });
  host.watchStart({ watchId: "cursor", sessionId: session.sessionId, afterSeq: -1 });
  await vi.waitFor(() => assert.ok(watchEvents.some((event) => event.kind === "ended")));
  const ended = watchEvents.find((event) => event.kind === "ended");
  assert.ok(ended);
  assert.equal(ended.error?.code, "cursor_expired");
  assert.ok(ended.error?.code === "cursor_expired");
  assert.equal(ended.error.floor, 0);
  assert.equal(ended.error.correlationId, undefined);
  const count = watchEvents.length;
  host.watchStart({ watchId: "cursor", sessionId: session.sessionId, live: true });
  await vi.waitFor(() =>
    assert.ok(watchEvents.slice(count).some((event) => event.kind === "event")),
  );
  host.watchStop("cursor");
});

test("trustWorkspace reactivates every open target", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const firstPath = join(root, "first-project");
  const secondPath = join(root, "second-project");
  await Promise.all([mkdir(firstPath), mkdir(secondPath)]);

  await host.call("host.openWorkspace", { path: firstPath });
  const first = await host.call("sessions.create", { name: "First" });
  await host.call("messages.send", {
    sessionId: first.sessionId,
    content: "first",
    key: "first",
  });
  await host.call("host.openWorkspace", { path: secondPath });
  const second = await host.call("sessions.create", { name: "Second" });
  await host.call("messages.send", {
    sessionId: second.sessionId,
    content: "second",
    key: "second",
  });

  await host.call("host.trustWorkspace", { path: root });
  await vi.waitFor(async () => {
    const firstSnapshot = await host.call("sessions.snapshot", { sessionId: first.sessionId });
    const secondSnapshot = await host.call("sessions.snapshot", { sessionId: second.sessionId });
    assert.equal(firstSnapshot?.pending.length, 0);
    assert.equal(secondSnapshot?.pending.length, 0);
  });
});

test("history survives restart while an unavailable workspace requires trust", async () => {
  const { root, createHost } = await fixture();
  const path = join(root, "project");
  await mkdir(path);
  const host = createHost();
  await host.call("host.openWorkspace", { path });
  const session = await host.call("sessions.create", { name: "Keep this conversation" });
  await rm(path, { recursive: true });
  await host.call("host.closeWorkspace", undefined);
  assert.equal((await host.call("host.openWorkspace", { path })).kind, "opened");
  assert.equal(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.name,
    "Keep this conversation",
  );
  await host.close();
  const restarted = createHost();
  assert.equal((await restarted.call("host.openWorkspace", { path })).kind, "opened");
  const snapshot = await restarted.call("sessions.snapshot", { sessionId: session.sessionId });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.session.activation, {
    kind: "requires",
    requirement: { kind: "workspace_trust", cwd: path },
  });
  assert.equal((await restarted.call("workspace.list", undefined))[0]?.available, false);
  const send = {
    sessionId: session.sessionId,
    content: "Continue",
    key: "continue",
  };
  assert.equal((await restarted.call("messages.send", send)).kind, "queued");
  await restarted.call("sessions.rename", { sessionId: session.sessionId, name: "Still editable" });
  await assert.rejects(access(path));
  await writeFile(path, "A file replaced the folder");
  assert.equal((await restarted.call("messages.send", send)).kind, "duplicate");
  await rm(path);
  await mkdir(path);
  await restarted.call("host.trustWorkspace", { path });
  assert.ok((await restarted.call("plugins.catalog", undefined)).plugins.length > 0);
  await vi.waitFor(async () => {
    const current = await restarted.call("sessions.snapshot", { sessionId: session.sessionId });
    assert.equal(current?.pending.length, 0);
  });
});

test("an invalid local database leaves the currently selected conversation open", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const session = await host.call("sessions.create", { name: "Home chat" });
  const path = join(root, "bad-project");
  await mkdir(join(path, ".nyte"), { recursive: true });
  await writeFile(join(path, ".nyte", "sessions.db"), "not sqlite");
  assert.equal((await host.call("host.openWorkspace", { path })).kind, "failed");
  assert.equal((await host.call("host.state", undefined)).workspace, undefined);
  assert.equal(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.name,
    "Home chat",
  );
});

test("terminal and file mutations still require trust", async () => {
  const { root, events, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "terminal-project");
  await mkdir(path);
  const file = join(path, "note.txt");
  await writeFile(file, "before\n");
  await host.call("host.openWorkspace", { path });
  await assert.rejects(
    host.call("host.terminal.create", { id: "outside", workspacePath: root }),
    /Open this workspace/,
  );
  await assert.rejects(
    host.call("host.terminal.create", { id: "untrusted", workspacePath: path }),
    /Workspace trust required/,
  );
  assert.ok(
    events.some((event) => event.kind === "workspace_trust_required" && event.path === path),
  );
  assert.equal(
    events.some((event) => event.kind === "terminal_data"),
    false,
  );
  const document = await host.call("host.files.read", { path: file });
  assert.equal(document.kind, "text");
  if (document.kind !== "text") return;
  await assert.rejects(
    host.call("host.files.save", {
      path: file,
      contents: "after\n",
      version: document.version,
    }),
    /Workspace trust required/,
  );
  const unchanged = await host.call("host.files.read", { path: file });
  assert.equal(unchanged.kind, "text");
  if (unchanged.kind === "text") assert.equal(unchanged.contents, "before\n");
});

test("a complete sidebar directory survives pagination and workspace switches", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "directory-project");
  await mkdir(path);
  await host.call("host.openWorkspace", { path });
  const saved = [];
  for (let index = 0; index < 7; index += 1) {
    saved.push(await host.call("sessions.create", { name: `Chat ${index}` }));
  }
  const archived = saved[0];
  assert.ok(archived);
  await host.call("sessions.setArchived", { sessionId: archived.sessionId, archived: true });
  await host.call("host.closeWorkspace", undefined);
  await host.call("host.openWorkspace", { path });
  const directory = await loadSessionDirectory((input) =>
    host.call("sessions.list", { ...input, limit: 2 }),
  );
  assert.equal(directory.next, undefined);
  assert.deepEqual(
    new Set(directory.items.map((session) => session.sessionId)),
    new Set(saved.map((session) => session.sessionId)),
  );
  assert.equal(
    directory.items.find((session) => session.sessionId === archived.sessionId)?.archived,
    true,
  );
});

test("opening another workspace preserves its predecessor's sessions and live watch", async () => {
  const { root, events, watchEvents, createHost } = await fixture();
  const host = createHost();
  const first = join(root, "first");
  const second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  await host.call("host.openWorkspace", { path: first });
  const firstSession = await host.call("sessions.create", { name: "First folder chat" });
  host.watchStart({ watchId: "first-folder", sessionId: firstSession.sessionId });
  await vi.waitFor(() => assert.ok(watchEvents.some((event) => event.kind === "event")));
  await host.call("host.openWorkspace", { path: second });
  const secondSession = await host.call("sessions.create", { name: "Second folder chat" });
  await host.call("sessions.rename", { sessionId: firstSession.sessionId, name: "Still open" });
  assert.equal(
    (await host.call("sessions.get", { sessionId: firstSession.sessionId }))?.name,
    "Still open",
  );
  assert.equal((await host.call("host.state", undefined)).workspace?.path, second);
  const transitionCount = events.length;
  const directory = await host.call("host.sessionDirectory", undefined);
  assert.deepEqual(
    localSessions(directory, first)?.map((session) => session.name),
    ["Still open"],
  );
  assert.deepEqual(
    localSessions(directory, second)?.map((session) => session.sessionId),
    [secondSession.sessionId],
  );
  assert.equal(events.length, transitionCount);
  assert.equal((await host.call("host.state", undefined)).workspace?.path, second);
  assert.equal(
    watchEvents.some((event) => event.kind === "ended"),
    false,
  );
  await host.call("host.closeWorkspace", undefined);
  assert.equal(
    (await host.call("sessions.get", { sessionId: firstSession.sessionId }))?.name,
    "Still open",
  );
  assert.equal(
    (await host.call("sessions.get", { sessionId: secondSession.sessionId }))?.name,
    "Second folder chat",
  );
  host.watchStop("first-folder");
});

test("subagent children stay out of the sidebar directory", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "subagent-project");
  await mkdir(path);
  await host.call("host.openWorkspace", { path });
  const parent = await host.call("sessions.create", { name: "Parent chat" });
  await host.call("sessions.create", {
    name: "Delegated work",
    parent: {
      sessionId: parent.sessionId,
      runId: "run",
      callId: "call",
      depth: 1,
    },
  });
  const directory = await loadSessionDirectory((input) => host.call("sessions.list", input));
  assert.deepEqual(
    directory.items.map((session) => session.sessionId),
    [parent.sessionId],
  );
  const workspaces = await host.call("host.sessionDirectory", undefined);
  assert.deepEqual(
    workspaces.flatMap((entry) => entry.sessions.map((session) => session.sessionId)),
    [parent.sessionId],
  );
});

test("searching the same term after switching workspaces returns the selected folder's chats", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  renderer.current = host;
  const first = join(root, "search-first");
  const second = join(root, "search-second");
  await Promise.all([mkdir(first), mkdir(second)]);
  await host.call("host.openWorkspace", { path: first });
  const firstSession = await host.call("sessions.create", { name: "Shared topic in first" });
  await loadLocalResources();
  const search = () =>
    queryClient.fetchQuery({
      queryKey: keys.sessionSearch("Shared"),
      queryFn: () => host.call("sessions.list", { search: "Shared", limit: 50 }),
    });
  assert.deepEqual(
    (await search()).items.map((session) => session.sessionId),
    [firstSession.sessionId],
  );

  await host.call("host.openWorkspace", { path: second });
  const secondSession = await host.call("sessions.create", { name: "Shared topic in second" });
  await loadLocalResources();
  assert.deepEqual(
    (await search()).items.map((session) => session.sessionId),
    [secondSession.sessionId],
  );

  await host.call("host.openWorkspace", { path: first });
  await loadLocalResources();
  assert.deepEqual(
    (await search()).items.map((session) => session.sessionId),
    [firstSession.sessionId],
  );
});

test("usage keeps recorded replies after rewind and desktop restart", async () => {
  const { createHost } = await fixture();
  // All time, so the assertions do not depend on which day the suite runs.
  const allTime = { sinceDay: null, untilDay: localDay(Date.now()) };
  const host = createHost();
  const session = await host.call("sessions.create", { name: "Recorded work" });
  await host.call("messages.send", { sessionId: session.sessionId, content: "hello" });
  await vi.waitFor(async () => {
    const report = await host.call("host.usage", allTime);
    assert.equal(report.entries[0]?.totals.tokens, 2);
  });
  await host.call("heads.move", { sessionId: session.sessionId, to: null });
  const rewound = await host.call("sessions.snapshot", { sessionId: session.sessionId });
  assert.equal(rewound?.transcript.length, 0);
  await host.close();

  const restarted = createHost();
  const report = await restarted.call("host.usage", allTime);
  assert.equal(report.sessions.length, 1);
  assert.equal(report.sessions[0]?.name, "Recorded work");
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0]?.sessionId, session.sessionId);
  assert.equal(report.entries[0]?.totals.tokens, 2);
  assert.deepEqual(
    report.sources.map((source) => source.status),
    ["ok"],
  );
});

test("usage snapshots read all Claude Code projects separately and refresh local changes", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const window = { sinceDay: "2099-01-01", untilDay: "2099-01-02" };
  const missing = await host.call("host.usage", window);
  assert.deepEqual(missing.claudeCode, { kind: "missing" });
  assert.deepEqual(missing.codex, { kind: "missing" });

  const first = join(root, "claude", "projects", "first");
  const second = join(root, "claude", "projects", "second", "subagents");
  await Promise.all([mkdir(first, { recursive: true }), mkdir(second, { recursive: true })]);
  const record = {
    type: "assistant",
    timestamp: "2020-01-01T00:00:00Z",
    requestId: "request",
    costUSD: 1.25,
    message: {
      id: "message",
      model: "fixture-claude",
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 },
    },
  };
  await writeFile(join(first, "chat.jsonl"), `${JSON.stringify(record)}\nmalformed\n`);
  await writeFile(
    join(second, "child.jsonl"),
    `${JSON.stringify({
      ...record,
      requestId: "child-request",
      costUSD: undefined,
    })}\n`,
  );

  const snapshot = await host.call("host.usage", window);
  assert.equal(snapshot.claudeCode.kind, "ready");
  if (snapshot.claudeCode.kind !== "ready") return;
  assert.equal(snapshot.claudeCode.summary.total.totalTokens, 300);
  assert.equal(snapshot.claudeCode.summary.total.cost.total, 1.25);
  assert.equal(snapshot.claudeCode.summary.models[0]?.turns, 2);
  assert.equal(snapshot.claudeCode.unpricedRecords, 1);
  assert.equal(snapshot.claudeCode.malformedRecords, 1);
  assert.equal(snapshot.claudeCode.unreadableFiles, 0);
  assert.deepEqual(snapshot.entries, []);
  assert.deepEqual(snapshot.sessions, []);
  assert.deepEqual(snapshot.sources, missing.sources);
  assert.equal((await host.call("host.state", undefined)).workspace, undefined);
  assert.deepEqual(await host.call("workspace.list", undefined), []);

  await rm(join(second, "child.jsonl"));
  const refreshed = await host.call("host.usage", { sinceDay: null, untilDay: "2099-01-02" });
  assert.equal(refreshed.claudeCode.kind, "ready");
  if (refreshed.claudeCode.kind !== "ready") return;
  assert.equal(refreshed.claudeCode.summary.total.totalTokens, 150);
  assert.equal(refreshed.claudeCode.unpricedRecords, 0);
  assert.equal(snapshot.claudeCode.summary.total.totalTokens, 300);
});

test("usage snapshots read Codex rollouts beside Claude Code and refresh local changes", async () => {
  const { root, createHost } = await fixture();
  const host = createHost();
  const window = { sinceDay: "2099-01-01", untilDay: "2099-01-02" };
  const sessions = join(root, "codex", "sessions", "2026", "01");
  await mkdir(sessions, { recursive: true });
  const record = (responseId: string) => ({
    type: "token_usage_record",
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: {
      response_id: responseId,
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 },
    },
  });
  const rollout = join(sessions, "rollout.jsonl");
  const context = JSON.stringify({ type: "turn_context", payload: { model: "gpt-fixture" } });
  await writeFile(
    rollout,
    `${context}\n${JSON.stringify(record("one"))}\n${JSON.stringify(record("two"))}\n`,
  );

  const snapshot = await host.call("host.usage", window);
  assert.deepEqual(snapshot.claudeCode, { kind: "missing" });
  assert.equal(snapshot.codex.kind, "ready");
  if (snapshot.codex.kind !== "ready") return;
  assert.equal(snapshot.codex.summary.total.totalTokens, 240);
  assert.equal(snapshot.codex.summary.models[0]?.model, "gpt-fixture");
  assert.equal(snapshot.codex.summary.models[0]?.turns, 2);
  assert.deepEqual(snapshot.entries, []);

  await writeFile(rollout, `${context}\n${JSON.stringify(record("one"))}\n`);
  const refreshed = await host.call("host.usage", window);
  assert.equal(refreshed.codex.kind, "ready");
  if (refreshed.codex.kind === "ready") {
    assert.equal(refreshed.codex.summary.total.totalTokens, 120);
  }

  // The parse survives the process: a restarted host answers from the cache
  // and still notices the file that changed underneath it.
  const cache = await readFile(join(root, "state", "usage-scan-cache.json"), "utf8");
  assert.ok(cache.includes(JSON.stringify(rollout)));
  await host.close();
  await writeFile(
    rollout,
    `${context}\n${JSON.stringify(record("one"))}\n${JSON.stringify(record("two"))}\n`,
  );
  const restarted = await createHost().call("host.usage", window);
  assert.equal(restarted.codex.kind, "ready");
  if (restarted.codex.kind === "ready") {
    assert.equal(restarted.codex.summary.total.totalTokens, 240);
  }
});

test("unreadable Claude Code history does not hide Nyte usage and recovers on refresh", async () => {
  const { root, createHost } = await fixture();
  await writeFile(join(root, "claude"), "not a directory");
  const host = createHost();
  const session = await host.call("sessions.create", { name: "Nyte only" });
  await host.call("messages.send", { sessionId: session.sessionId, content: "hello" });
  const window = { sinceDay: null, untilDay: localDay(Date.now()) };
  await vi.waitFor(async () => {
    const snapshot = await host.call("host.usage", window);
    assert.equal(snapshot.entries[0]?.totals.tokens, 2);
    assert.equal(snapshot.claudeCode.kind, "failed");
    if (snapshot.claudeCode.kind === "failed") assert.ok(snapshot.claudeCode.message);
  });
  await rm(join(root, "claude"));
  await mkdir(join(root, "claude", "projects"), { recursive: true });
  const recovered = await host.call("host.usage", window);
  assert.equal(recovered.entries[0]?.totals.tokens, 2);
  assert.equal(recovered.claudeCode.kind, "ready");
  if (recovered.claudeCode.kind === "ready") {
    assert.equal(recovered.claudeCode.summary.total.totalTokens, 0);
  }
});

test.each(["store", "registry"])(
  "Claude Code survives a failed Nyte %s and both refresh in the same window",
  async (failure) => {
    const { root, createHost } = await fixture();
    const project = join(root, "claude", "projects", "one");
    await mkdir(project, { recursive: true });
    const history = join(project, "chat.jsonl");
    const record = {
      type: "assistant",
      costUSD: 1.25,
      message: { model: "fixture-claude", usage: { input_tokens: 100, output_tokens: 20 } },
    };
    await writeFile(history, `${JSON.stringify(record)}\n`);
    await mkdir(join(root, "state"), { recursive: true });
    const broken = join(root, "state", failure === "store" ? "sessions.db" : "workspaces.json");
    if (failure === "store") await writeFile(broken, "not sqlite");
    else await mkdir(broken);
    const host = createHost();
    const window = { sinceDay: "2099-01-01", untilDay: "2099-01-02" };
    const before = new Set(ipcDiagnostics.keys());
    const snapshot = await host.call("host.usage", window);
    const diagnostics = [...ipcDiagnostics.entries()].filter(([id]) => !before.has(id));
    assert.equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0];
    assert.ok(diagnostic);
    assert.ok(diagnostic[1] instanceof Error);
    const message = failure === "store" ? snapshot.sources[0]?.message : snapshot.nyteError;
    assert.equal(message, `The host operation failed. Diagnostic ID: ${diagnostic[0]}`);
    assert.equal(JSON.stringify(snapshot).includes(broken), false);
    assert.deepEqual(snapshot.entries, []);
    assert.deepEqual(snapshot.sessions, []);
    if (failure === "store") {
      assert.equal(snapshot.sources[0]?.status, "failed");
      assert.equal(snapshot.nyteError, null);
    } else {
      assert.ok(snapshot.nyteError);
    }
    assert.equal(snapshot.claudeCode.kind, "ready");
    if (snapshot.claudeCode.kind !== "ready") return;
    assert.equal(snapshot.claudeCode.summary.total.totalTokens, 120);
    assert.equal(snapshot.claudeCode.summary.total.cost.total, 1.25);

    await rm(broken, { recursive: true });
    await writeFile(history, `${JSON.stringify({ ...record, costUSD: 2.5 })}\n`);
    const refreshed = await host.call("host.usage", window);
    assert.equal(refreshed.nyteError, null);
    assert.equal(refreshed.sources[0]?.status, "ok");
    assert.equal(refreshed.claudeCode.kind, "ready");
    if (refreshed.claudeCode.kind === "ready") {
      assert.equal(refreshed.claudeCode.summary.total.cost.total, 2.5);
    }
    assert.deepEqual(refreshed.entries, []);
    assert.equal((await host.call("host.state", undefined)).workspace, undefined);
  },
);

test("the previous directory reopens without granting trust, and choosing Home is remembered", async () => {
  const { root, createHost } = await fixture();
  const path = join(root, "remembered-project");
  await mkdir(path);
  const host = createHost();
  await host.call("host.openWorkspace", { path });
  await host.close();

  const restarted = createHost();
  assert.equal((await restarted.call("host.state", undefined)).workspace?.path, path);
  const session = await restarted.call("sessions.create", undefined);
  assert.deepEqual(session.activation, {
    kind: "requires",
    requirement: { kind: "workspace_trust", cwd: path },
  });
  await restarted.call("host.closeWorkspace", undefined);
  await restarted.close();
  assert.equal((await createHost().call("host.state", undefined)).workspace, undefined);
});

test("forgetting the previous directory keeps it forgotten after restart", async () => {
  const { root, createHost } = await fixture();
  const path = join(root, "forgotten-project");
  await mkdir(path);
  const host = createHost();
  await host.call("host.openWorkspace", { path });
  await host.call("workspace.forget", { path });
  await host.close();
  const restarted = createHost();
  assert.equal((await restarted.call("host.state", undefined)).workspace, undefined);
  assert.deepEqual(await restarted.call("workspace.list", undefined), []);
});

test.each(["not json", '"relative/path"', '{"path":"/tmp"}'])(
  "a damaged previous-directory preference falls back to Home: %s",
  async (contents) => {
    const { root, createHost } = await fixture();
    await mkdir(join(root, "state"));
    await writeFile(join(root, "state", "desktop-workspace.json"), contents);
    assert.equal((await createHost().call("host.state", undefined)).workspace, undefined);
  },
);

test("thread choices survive workspace switches and restart before and after the first response", async () => {
  const { root, createHost } = await fixture();
  const first = join(root, "configured-first");
  const second = join(root, "configured-second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const host = createHost();
  await host.call("host.openWorkspace", { path: first });
  const session = await host.call("sessions.create", undefined);
  const selected = { model: { provider: "echo", id: "reasoning" }, thinkingLevel: "high" } as const;
  assert.equal(
    (await host.call("sessions.configure", { sessionId: session.sessionId, ...selected })).kind,
    "queued",
  );
  assert.deepEqual(
    (await host.call("sessions.snapshot", { sessionId: session.sessionId }))?.session.config,
    selected,
  );

  await host.call("host.openWorkspace", { path: second });
  await host.call("host.setPreference", {
    kind: "defaults",
    model: { provider: "echo", id: "echo" },
    thinkingLevel: "off",
  });
  assert.deepEqual(
    (await host.call("sessions.snapshot", { sessionId: session.sessionId }))?.session.config,
    selected,
  );
  await host.close();

  const restarted = createHost();
  await restarted.call("host.sessionDirectory", undefined);
  assert.deepEqual(
    (await restarted.call("sessions.snapshot", { sessionId: session.sessionId }))?.session.config,
    selected,
  );
  await restarted.call("host.trustWorkspace", { path: first });
  await restarted.call("messages.send", { sessionId: session.sessionId, content: "hello" });
  await vi.waitFor(async () => {
    const snapshot = await restarted.call("sessions.snapshot", { sessionId: session.sessionId });
    assert.equal(snapshot?.run?.phase.kind, "done");
    assert.ok(snapshot?.transcript.some((turn) => turn.kind === "turn"));
    assert.deepEqual(snapshot.config, selected);
  });
  await restarted.close();

  const reopened = createHost();
  await reopened.call("host.sessionDirectory", undefined);
  const snapshot = await reopened.call("sessions.snapshot", { sessionId: session.sessionId });
  assert.deepEqual(snapshot?.config, selected);
  assert.deepEqual(snapshot?.session.config, selected);
});

test("plugin load status retains the available failure record only in main", async () => {
  const { root, createHost, events } = await fixture();
  const path = join(root, "plugin-project");
  const directory = join(path, ".nyte", "plugins");
  await mkdir(directory, { recursive: true });
  const plugin = join(directory, "broken.mjs");
  await writeFile(plugin, 'throw new Error("synthetic-secret-plugin-body");\n');
  const host = createHost();
  await host.call("host.openWorkspace", { path });
  await host.call("host.trustWorkspace", { path });
  const before = new Set(ipcDiagnostics.keys());
  await host.call("sessions.create", { name: "Plugin failure" });
  const status = events.filter((event) => event.kind === "status");
  assert.equal(status.length, 1);
  const diagnostics = [...ipcDiagnostics.entries()].filter(([id]) => !before.has(id));
  assert.equal(diagnostics.length, 1);
  const diagnostic = diagnostics[0];
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic[1], { path: plugin, error: "synthetic-secret-plugin-body" });
  assert.equal(status[0]?.message, `The host operation failed. Diagnostic ID: ${diagnostic[0]}`);
  assert.doesNotMatch(JSON.stringify(status), /synthetic-secret-plugin-body|broken.mjs/);
});

test.skipIf(process.platform === "win32")(
  "mention IPC propagates process failure and cancels running discovery",
  async () => {
    const { root, createHost } = await fixture();
    const host = createHost();
    const workspace = join(root, "project");
    await mkdir(workspace);
    await host.call("host.openWorkspace", { path: workspace });
    const executable = join(root, "rg");
    const header = `#!${process.execPath}\nif (process.argv.includes("--version")) { console.log("ripgrep 15.1.0"); process.exit(0); }\n`;
    await writeFile(
      executable,
      header + 'process.stderr.write("mention process failed"); process.exitCode = 42;',
    );
    await chmod(executable, 0o755);
    vi.stubEnv("PATH", root);
    await assert.rejects(
      host.call("host.files.list", { requestId: "failure" }),
      /42.*mention process failed/su,
    );

    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    await writeFile(
      executable,
      header +
        `const socket = require("node:net").connect(${address.port}, "127.0.0.1", () => socket.write(String(process.pid))); setInterval(() => {}, 1000);`,
    );
    try {
      for (const stop of ["cancel", "close"] as const) {
        const started = new Promise<number>((resolve) =>
          server.once("connection", (socket) => {
            socket.once("data", (data) => {
              resolve(Number(data.toString()));
              socket.destroy();
            });
          }),
        );
        const pending = host.call("host.files.list", { requestId: stop });
        const rejected = assert.rejects(pending, /abort/iu);
        const pid = await started;
        if (stop === "cancel") await host.call("host.files.cancelList", { requestId: stop });
        else await host.close();
        await rejected;
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
    } finally {
      await host.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
