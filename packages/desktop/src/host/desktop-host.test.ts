import assert from "node:assert/strict";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import { titleReply } from "@nyte-ai/bench";
import { isPart, text } from "@nyte-ai/plugin/core";
import type { Connection } from "@nyte-ai/sdk";
import { socketTest, testDesktop } from "./fixtures/desktop-host.ts";
import type { TestDesktop } from "./fixtures/desktop-host.ts";

const opened: TestDesktop[] = [];

const connections: Connection[] = [];

async function closeOpened(): Promise<void> {
  for (const connection of connections.splice(0)) await connection.close();

  for (const desktop of opened.splice(0)) await desktop.close();
}

afterEach(closeOpened);

async function desktop(...input: Parameters<typeof testDesktop>): Promise<TestDesktop> {
  const made = await testDesktop(...input);
  opened.push(made);

  return made;
}

async function connectLocal(made: TestDesktop): Promise<Connection> {
  const connection = await made.connect();

  connections.push(connection);

  return connection;
}

socketTest("keep awake holds while a head is live and lets go when its run ends", async () => {
  const awake: boolean[] = [];
  const made = await desktop({ keepAwake: (value) => awake.push(value) });
  const connection = await connectLocal(made);
  assert.deepEqual(await connection.settings.apply("desktop.keepAwake", true), { kind: "applied" });
  const finish = Promise.withResolvers<void>();
  const route = (request: Parameters<typeof titleReply>[0]) =>
    titleReply(request) === null
      ? { content: [{ type: "text" as const, text: "working" }], until: finish.promise }
      : { content: [{ type: "text" as const, text: "Work" }] };
  made.fake.reply(route, route);

  const { receipt } = await connection.sessions.start({ content: "Work" });
  await vi.waitFor(() => assert.deepEqual(awake, [true]));

  finish.resolve();
  await receipt.settled();
  await vi.waitFor(() => assert.deepEqual(awake, [true, false]));
});

socketTest(
  "a suspend ends the stream in flight and holds the chat until resume continues it",
  async () => {
    const made = await desktop();
    const connection = await connectLocal(made);

    made.fake.reply(
      { content: [{ type: "text", text: "A partial answer" }], hold: true },
      { content: [{ type: "text", text: "l answer" }] },
    );

    const { session, receipt } = await connection.sessions.start({ name: "work", content: "Work" });

    await vi.waitFor(async () =>
      assert.ok(
        (await session.view()).messages.some(
          (message) => isPart(message, text) && message.state.markdown !== "",
        ),
      ),
    );

    made.host.suspend();
    await vi.waitFor(() => assert.equal(made.fake.requests[0]?.options?.signal?.aborted, true));
    await vi.waitFor(async () => assert.equal((await session.view()).execution.kind, "retrying"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(made.fake.requests.length, 1);

    made.host.resume();

    assert.equal((await receipt.settled()).kind, "completed");
    assert.equal(made.fake.requests.length, 2);
    assert.deepEqual(
      (await session.view()).messages.flatMap((message) =>
        isPart(message, text) ? [message.state.markdown] : [],
      ),
      ["A partia", "l answer"],
    );
  },
);

socketTest("with pause on sleep off, a suspend leaves the stream running", async () => {
  const seen: boolean[] = [];
  const made = await desktop({ settingsChanged: (settings) => seen.push(settings.pauseOnSleep) });
  const connection = await connectLocal(made);

  assert.deepEqual(await connection.settings.apply("desktop.pauseOnSleep", false), {
    kind: "applied",
  });
  await vi.waitFor(() => assert.equal(seen.at(-1), false));
  const finish = Promise.withResolvers<void>();
  made.fake.reply({ content: [{ type: "text", text: "working" }], until: finish.promise });

  const { receipt } = await connection.sessions.start({ name: "work", content: "Work" });
  await vi.waitFor(() => assert.equal(made.fake.requests.length, 1));

  made.host.suspend();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(made.fake.requests[0]?.options?.signal?.aborted, false);

  finish.resolve();
  assert.equal((await receipt.settled()).kind, "completed");
  assert.equal(made.fake.requests.length, 1);
});

socketTest(
  "a host that answers only after main started still reaches main: its settings arrive and its live run counts as running work",
  async () => {
    const seen: boolean[] = [];

    const made = await desktop(
      { settingsChanged: (settings) => seen.push(settings.blockAds) },
      { reachable: false },
    );

    await vi.waitFor(() => assert.equal(made.link.state.kind, "unreachable"));
    made.reachable(true);
    const finish = Promise.withResolvers<void>();
    made.fake.reply({ content: [{ type: "text", text: "working" }], until: finish.promise });
    const { receipt } = await made.served.sessions.start({ name: "work", content: "Work" });
    await vi.waitFor(() => assert.equal(made.fake.requests.length, 1));

    await vi.waitFor(() => assert.equal(seen.at(-1), true), { timeout: 5_000 });
    assert.deepEqual(await made.host.updateActivity(), {
      kind: "busy",
      taskCount: 1,
      terminalCommandCount: 0,
    });

    finish.resolve();
    await receipt.settled();
  },
);

socketTest("the desktop's settings reach main from the host view", async () => {
  const seen: boolean[] = [];
  const made = await desktop({ settingsChanged: (settings) => seen.push(settings.blockAds) });
  const connection = await connectLocal(made);

  await vi.waitFor(() => assert.equal(seen.at(-1), true));
  assert.deepEqual(await connection.settings.apply("desktop.blockAds", false), { kind: "applied" });
  await vi.waitFor(() => assert.equal(seen.at(-1), false));
});

socketTest(
  "connecting a server proves the token, pins the host that answered and remembers both",
  async () => {
    const server = await desktop();
    const token = "z".repeat(43);

    const listener = await server.served.listen({
      transport: { kind: "http", hostname: "127.0.0.1" },
      auth: { kind: "token", token },
    });

    const address = listener.address ?? "";
    const made = await desktop();

    assert.deepEqual(
      await made.host.call(1, "host.server.connect", {
        baseUrl: address,
        token: "y".repeat(43),
      }),
      {
        kind: "failed",
        message: "The server rejected this token. Update the connection token.",
      },
    );
    assert.deepEqual(await made.host.call(1, "host.server.state", undefined), { kind: "none" });

    const connected = await made.host.call(1, "host.server.connect", {
      baseUrl: address,
      token,
    });

    assert.equal(connected.kind, "connected");
    assert.equal((await made.host.call(1, "host.server.state", undefined)).kind, "connected");
    assert.ok(made.events.some((event) => event.kind === "server_changed"));
    const saved = await readFile(join(made.home, ".nyte", "server.json"), "utf8");
    assert.equal(JSON.parse(saved).hostId, server.served.hostId);

    await listener.close();
    await vi.waitFor(async () =>
      assert.equal((await made.host.call(1, "host.server.state", undefined)).kind, "unavailable"),
    );
    assert.ok(made.events.filter((event) => event.kind === "server_changed").length >= 2);
    await made.host.call(1, "host.server.disconnect", undefined);
    assert.deepEqual(await made.host.call(1, "host.server.state", undefined), { kind: "none" });
  },
);

socketTest(
  "opening a folder registers it under the host's path and announces nothing; a folder the host can't take, or a host that doesn't answer, answers failed",
  async () => {
    const made = await desktop();
    const folder = join(made.home, "project");
    await mkdir(folder);
    await symlink(folder, join(made.home, "linked"));

    const opened = await made.host.call(1, "host.openWorkspace", { path: folder });

    if (opened.kind !== "opened") throw new Error("The folder did not open");
    assert.deepEqual(opened.workspace, { id: opened.workspace.id, path: folder, name: "project" });

    assert.deepEqual(
      await made.host.call(1, "host.openWorkspace", { path: join(made.home, "linked") }),
      opened,
    );
    assert.ok(
      (await made.served.workspaces.list()).some((entry) => entry.id === opened.workspace.id),
    );

    assert.deepEqual(
      await made.host.call(1, "host.openWorkspace", { path: join(folder, "missing") }),
      {
        kind: "failed",
        message:
          "Nyte can't read this folder. Check that it exists and that Nyte has access to it.",
      },
    );
    assert.deepEqual(made.events, []);

    const away = await desktop({}, { reachable: false });

    assert.equal((await away.host.call(1, "host.openWorkspace", { path: folder })).kind, "failed");
  },
);

socketTest(
  "a window reopening on a chat is answered the chat's folder, whatever any window opened, and nothing is announced",
  async () => {
    const made = await desktop();
    const folder = join(made.home, "project");
    const other = join(made.home, "other");
    await mkdir(folder);
    await mkdir(other);
    const opened = await made.host.call(1, "host.openWorkspace", { path: folder });

    if (opened.kind !== "opened") throw new Error("The folder did not open");
    const host = made.served;
    await host.workspace(opened.workspace.id).update({ projectResources: true });

    const { session: chat } = await host.sessions.start({
      workspace: opened.workspace.id,
      content: "Hi.",
    });

    await made.host.call(2, "host.openWorkspace", { path: other });

    assert.deepEqual(await made.host.call(2, "host.restore", { session: chat.id }), {
      id: opened.workspace.id,
      path: folder,
      name: "project",
    });
    assert.equal(await made.host.call(3, "host.restore", { session: "gone" }), undefined);
    assert.deepEqual(made.events, []);
  },
);
