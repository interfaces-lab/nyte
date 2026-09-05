import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, test, vi } from "vitest";
import type { HostEvent, WatchEnvelope } from "../shared/ipc.ts";
import { loadSessionDirectory } from "../renderer/src/session-directory.ts";
import { DesktopHost } from "./host.ts";
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

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-workspaces-")));
  directories.push(root);
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  const events: HostEvent[] = [];
  const watchEvents: WatchEnvelope[] = [];
  const createHost = () => {
    const host = new DesktopHost({
      emitHostEvent: (event) => events.push(event),
      emitWatchEvent: (event) => watchEvents.push(event),
      openExternal: () => undefined,
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
        setBounds: () => undefined,
        warm: async () => undefined,
        dispose: () => undefined,
      },
    });
    hosts.push(host);
    return host;
  };
  return { root, events, watchEvents, createHost };
}

test("selecting an untrusted project loads history without prompting; sending asks for trust once", async () => {
  const { root, events, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "project");
  await mkdir(path);
  assert.equal((await host.call("host.openWorkspace", { path })).kind, "opened");
  const session = await host.call("sessions.create", { name: "Saved chat" });
  assert.equal(
    events.some((event) => event.kind === "workspace_trust_required"),
    false,
  );
  const send = { sessionId: session.sessionId, content: "Continue", key: "continue" };
  await assert.rejects(host.call("messages.send", send), /Workspace trust required/);
  await assert.rejects(host.call("messages.send", send), /Workspace trust required/);
  assert.equal(events.filter((event) => event.kind === "workspace_trust_required").length, 1);
  await assert.rejects(
    host.call("messages.send", { ...send, key: "another-message" }),
    /Workspace trust required/,
  );
  await assert.rejects(host.call("messages.send", send), /Workspace trust required/);
  assert.equal(events.filter((event) => event.kind === "workspace_trust_required").length, 2);
  await assert.rejects(host.call("plugins.catalog", undefined), /Workspace trust required/);
  await host.call("host.trustWorkspace", { path });
  const catalog = await host.call("plugins.catalog", undefined);
  assert.ok(catalog.plugins.length > 0);
  assert.equal(
    (await host.call("sessions.get", { sessionId: session.sessionId }))?.name,
    "Saved chat",
  );
});

test("history survives deletion, workspace switching, and restarting; a missing path fails only when sending", async () => {
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
  assert.equal((await restarted.call("workspace.list", undefined))[0]?.available, false);
  await assert.rejects(
    restarted.call("messages.send", {
      sessionId: session.sessionId,
      content: "Continue",
      key: "continue",
    }),
    /Workspace folder not found/,
  );
  await restarted.call("sessions.rename", { sessionId: session.sessionId, name: "Still editable" });
  await assert.rejects(access(path));
  await writeFile(path, "A file replaced the folder");
  await assert.rejects(
    restarted.call("messages.send", {
      sessionId: session.sessionId,
      content: "Continue",
      key: "continue",
    }),
    /Workspace path is not a folder/,
  );
  await rm(path);
  await mkdir(path);
  await restarted.call("host.trustWorkspace", { path });
  assert.ok((await restarted.call("plugins.catalog", undefined)).plugins.length > 0);
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

test("project terminals require the selected workspace and its trust grant", async () => {
  const { root, events, createHost } = await fixture();
  const host = createHost();
  const path = join(root, "terminal-project");
  await mkdir(path);
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
    directory
      .find((entry) => entry.workspacePath === first)
      ?.sessions.map((session) => session.name),
    ["Still open"],
  );
  assert.deepEqual(
    directory
      .find((entry) => entry.workspacePath === second)
      ?.sessions.map((session) => session.sessionId),
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
