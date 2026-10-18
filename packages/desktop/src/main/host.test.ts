import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, onTestFinished, test, vi } from "vitest";
import { createModels } from "@nyte-ai/ai/models";
import { credentialStore, defaultSecrets, sqliteStore } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/bench";
import { isPart, text } from "@nyte-ai/plugin/core";
import { sdk } from "@nyte-ai/sdk";
import type { Connection } from "@nyte-ai/sdk";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import { testDesktop } from "./fixtures/desktop-host.ts";
import type { TestDesktop } from "./fixtures/desktop-host.ts";

const opened: TestDesktop[] = [];

const connections: Connection[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();

  for (const desktop of opened.splice(0)) await desktop.close();
});

async function desktop(...input: Parameters<typeof testDesktop>): Promise<TestDesktop> {
  const made = await testDesktop(...input);
  opened.push(made);

  return made;
}

async function connectLocal(made: TestDesktop): Promise<Connection> {
  const connection = await sdk.connect(await made.host.call(1, "host.endpoint", undefined));

  connections.push(connection);

  return connection;
}

test("the renderer reaches the host over the local listener and a chat runs there", async () => {
  const made = await desktop();
  const connection = await connectLocal(made);
  made.fake.reply({ content: [{ type: "text", text: "hello from the host" }] });

  const { session, receipt } = await connection.sessions.start({
    name: "greeting",
    content: "Say hello",
  });

  await receipt.settled();
  const view = await session.view();

  assert.ok(
    view.messages.some(
      (message) => isPart(message, text) && message.state.markdown === "hello from the host",
    ),
  );
  assert.equal(view.execution.kind, "idle");
});

test("a wrong token is refused before anything is read", async () => {
  const made = await desktop();
  const local = await made.host.call(1, "host.endpoint", undefined);

  await assert.rejects(
    sdk.connect({ url: local.url, credentials: { kind: "token", token: "x".repeat(43) } }),
    {
      code: "unauthenticated",
    },
  );
});

test("keep awake holds while a head is live and lets go when its run ends", async () => {
  const awake: boolean[] = [];
  const made = await desktop({ keepAwake: (value) => awake.push(value) });
  const connection = await connectLocal(made);
  assert.deepEqual(await connection.settings.apply("desktop.keepAwake", true), { kind: "applied" });
  const finish = Promise.withResolvers<void>();
  made.fake.reply({ content: [{ type: "text", text: "working" }], until: finish.promise });

  const { receipt } = await connection.sessions.start({ content: "Work" });
  await vi.waitFor(() => assert.deepEqual(awake, [true]));

  finish.resolve();
  await receipt.settled();
  await vi.waitFor(() => assert.deepEqual(awake, [true, false]));
});

test("the desktop's settings reach main from the host view", async () => {
  const seen: boolean[] = [];
  const made = await desktop({ settingsChanged: (settings) => seen.push(settings.blockAds) });
  const connection = await connectLocal(made);

  await vi.waitFor(() => assert.equal(seen.at(-1), true));
  assert.deepEqual(await connection.settings.apply("desktop.blockAds", false), { kind: "applied" });
  await vi.waitFor(() => assert.equal(seen.at(-1), false));
});

test("connecting a server proves the token, pins the host that answered and remembers both", async () => {
  const server = await desktop();
  const remote = await server.host.call(1, "host.endpoint", undefined);
  const made = await desktop();

  if (remote.credentials.kind !== "token") throw new Error("The local endpoint takes a token");

  assert.deepEqual(
    await made.host.call(1, "host.server.connect", { baseUrl: remote.url, token: "y".repeat(43) }),
    {
      kind: "failed",
      message: "The server rejected this token. Update the connection token.",
    },
  );
  assert.deepEqual(await made.host.call(1, "host.server.state", undefined), { kind: "none" });

  const connected = await made.host.call(1, "host.server.connect", {
    baseUrl: remote.url,
    token: remote.credentials.token,
  });

  assert.equal(connected.kind, "connected");
  assert.equal((await made.host.call(1, "host.server.state", undefined)).kind, "connected");
  assert.ok(made.events.some((event) => event.kind === "server_changed"));
  const saved = await readFile(join(made.home, ".nyte", "server.json"), "utf8");
  assert.equal(JSON.parse(saved).hostId, remote.expect?.hostId);

  await server.close();
  await vi.waitFor(async () =>
    assert.equal((await made.host.call(1, "host.server.state", undefined)).kind, "unavailable"),
  );
  assert.ok(made.events.filter((event) => event.kind === "server_changed").length >= 2);
  await made.host.call(1, "host.server.disconnect", undefined);
  assert.deepEqual(await made.host.call(1, "host.server.state", undefined), { kind: "none" });
});

test("opening a folder registers it and selects it for that window only; a failed open changes nothing", async () => {
  const received: { readonly event: HostEvent; readonly window: number | undefined }[] = [];

  const made = await desktop({
    emitHostEvent: (event, window) => received.push({ event, window }),
  });

  const folder = join(made.home, "project");
  await mkdir(folder);

  const opened = await made.host.call(1, "host.openWorkspace", { path: folder });

  if (opened.kind !== "opened") throw new Error("The folder did not open");
  assert.deepEqual(opened.workspace, { id: opened.workspace.id, path: folder, name: "project" });
  assert.ok(
    (await (await made.host.host()).workspaces.list()).some(
      (entry) => entry.id === opened.workspace.id,
    ),
  );
  assert.equal(
    (await made.host.call(1, "host.state", undefined)).workspace?.id,
    opened.workspace.id,
  );
  assert.equal((await made.host.call(2, "host.state", undefined)).workspace, undefined);
  assert.deepEqual(received, [
    { event: { kind: "workspace_opened", workspace: opened.workspace }, window: 1 },
  ]);

  assert.equal(
    (await made.host.call(1, "host.openWorkspace", { path: join(folder, "missing") })).kind,
    "failed",
  );
  assert.equal(
    (await made.host.call(1, "host.state", undefined)).workspace?.id,
    opened.workspace.id,
  );
  assert.equal(received.length, 1);

  await made.host.call(1, "host.closeWorkspace", undefined);
  assert.equal((await made.host.call(1, "host.state", undefined)).workspace, undefined);
  await made.host.call(1, "host.closeWorkspace", undefined);
  assert.deepEqual(received, [
    { event: { kind: "workspace_opened", workspace: opened.workspace }, window: 1 },
    { event: { kind: "workspace_closed" }, window: 1 },
  ]);
});

test("a window reopening on a chat answers its state with the chat's folder selected, and announces nothing", async () => {
  const received: HostEvent[] = [];
  const made = await desktop({ emitHostEvent: (event) => received.push(event) });
  const folder = join(made.home, "project");
  await mkdir(folder);
  const opened = await made.host.call(1, "host.openWorkspace", { path: folder });

  if (opened.kind !== "opened") throw new Error("The folder did not open");
  const host = await made.host.host();
  await host.workspace(opened.workspace.id).update({ projectResources: true });
  const { session: chat } = await host.sessions.start({
    workspace: opened.workspace.id,
    content: "Hi.",
  });
  received.length = 0;

  assert.deepEqual((await made.host.call(2, "host.restore", { session: chat.id })).workspace, {
    id: opened.workspace.id,
    path: folder,
    name: "project",
  });
  assert.equal((await made.host.call(3, "host.restore", { session: "gone" })).workspace, undefined);
  assert.deepEqual(received, []);
});

test("a key login over the loopback listener connects the provider, and the reopened home keeps it without reading the key", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-desktop-login-")));
  const store = sqliteStore({ path: join(home, "credentials.db") });
  const file = defaultSecrets(home);
  let reads = 0;

  const secrets = {
    key: () => {
      reads += 1;

      return file.key();
    },
  };

  const models = () => {
    const fake = fakeModels({
      into: createModels({ credentials: credentialStore(store, secrets) }),
    });

    fake.configured = false;

    return fake.models;
  };

  const credential = async (connection: Connection) =>
    (await connection.models.list()).providers.find((row) => row.id === "test")?.credential;

  try {
    const first = await desktop({ home, models: models() });
    const connection = await sdk.connect(await first.host.call(1, "host.endpoint", undefined));
    await vi.waitFor(async () => assert.equal(await credential(connection), "missing"));

    const login = connection.models.login({
      provider: "test",
      method: { kind: "key" },
      label: "Work",
    });

    const steps: string[] = [];

    for await (const step of login.steps()) {
      steps.push(step.kind);

      if (step.kind === "paste") await login.answer("sk-test");
    }

    assert.deepEqual(steps, ["paste", "done"]);
    await vi.waitFor(async () => assert.equal(await credential(connection), "configured"));
    assert.deepEqual(
      (await connection.models.accounts("test")).map((account) => account.label),
      ["Work"],
    );
    await connection.close();
    await first.close();
    const written = reads;
    assert.ok(written > 0);

    if (process.platform !== "win32") {
      assert.equal((await stat(join(home, ".nyte", "secret.key"))).mode & 0o777, 0o600);
    }

    const second = await desktop({ home, models: models() });
    const again = await connectLocal(second);

    assert.equal(await credential(again), "configured");
    assert.equal(reads, written);
  } finally {
    await store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("the host waits for a store another process holds, says so, and opens once it is let go", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-desktop-held-")));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, ".nyte"), { recursive: true });

  const holder = spawn(
    process.execPath,
    [join(import.meta.dirname, "fixtures", "hold-store.ts"), join(home, ".nyte", "nyte.db")],
    { stdio: ["pipe", "pipe", "ignore"] },
  );

  await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
  const statuses: string[] = [];

  try {
    const made = await desktop({
      home,
      emitHostEvent: (event) => {
        if (event.kind !== "status") return;
        statuses.push(event.message);

        if (/Another Nyte process/u.test(event.message)) holder.kill("SIGKILL");
      },
    });

    assert.ok(await made.host.host());
    assert.match(statuses[0] ?? "", /Another Nyte process \(pid \d+, .*has .*nyte\.db open/u);
    assert.equal(statuses.at(-1), "Nyte opened your chats.");
  } finally {
    const exited = holder.exitCode !== null || holder.signalCode !== null;
    holder.kill("SIGKILL");

    if (!exited) await once(holder, "exit");
  }
}, 30_000);
