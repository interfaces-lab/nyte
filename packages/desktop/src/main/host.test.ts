import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels } from "@nyte-ai/ai/models";
import { credentialStore, defaultSecrets, sqliteStore } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/host/bench";
import { isPart, text } from "@nyte-ai/plugin/core";
import { sdk } from "@nyte-ai/sdk";
import type { Connection } from "@nyte-ai/sdk";
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

/** Connects the way the renderer does: `host.endpoint()`, then `sdk.connect` with what it names. */
async function connectLocal(made: TestDesktop): Promise<Connection> {
  const connection = await sdk.connect(await made.host.call(1, "host.endpoint", undefined));

  connections.push(connection);

  return connection;
}

test("the renderer reaches the host over the local listener and a chat runs there", async () => {
  const made = await desktop();
  const connection = await connectLocal(made);
  made.fake.reply({ content: [{ type: "text", text: "hello from the host" }] });

  const session = await connection.sessions.create({ name: "greeting" });
  const receipt = await session.send("Say hello");
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

  const session = await connection.sessions.create();
  const receipt = await session.send("Work");
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
  assert.equal((await made.host.call(1, "host.server.state", undefined)).kind, "unavailable");
  await made.host.call(1, "host.server.disconnect", undefined);
  assert.deepEqual(await made.host.call(1, "host.server.state", undefined), { kind: "none" });
});

test("picking a folder registers it and selects it for that window only; cancelling changes nothing", async () => {
  const picked: (string | undefined)[] = [undefined];
  const made = await desktop({ pickFolder: async () => picked.shift() });
  const folder = join(made.home, "project");
  await mkdir(folder);

  assert.deepEqual(await made.host.call(1, "host.pickWorkspace", undefined), { kind: "cancelled" });
  picked.push(folder);
  const opened = await made.host.call(1, "host.pickWorkspace", undefined);

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

  await made.host.call(1, "host.closeWorkspace", undefined);
  assert.equal((await made.host.call(1, "host.state", undefined)).workspace, undefined);
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
    assert.equal(await credential(connection), "missing");

    const login = connection.models.login({ provider: "test", method: { kind: "key" } });
    const steps: string[] = [];

    for await (const step of login.steps()) {
      steps.push(step.kind);

      if (step.kind === "paste") await login.answer("sk-test");
    }

    assert.deepEqual(steps, ["paste", "done"]);
    assert.notEqual(await credential(connection), "missing");
    await connection.close();
    await first.close();
    const written = reads;
    assert.ok(written > 0);
    assert.equal((await stat(join(home, ".nyte", "secret.key"))).mode & 0o777, 0o600);

    const second = await desktop({ home, models: models() });
    const again = await connectLocal(second);

    assert.equal(await credential(again), "configured");
    assert.equal(reads, written);
  } finally {
    await store.close();
    await rm(home, { recursive: true, force: true });
  }
});
