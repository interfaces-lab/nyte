import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { submit } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { definePlugin, toolsFsPlugin, type Plugin } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  call,
  localOptions,
  localWorkspace,
  openStore,
  storePath,
  trustGrants,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Script",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

function plugins(id: string) {
  return [
    definePlugin({
      id,
      session(api) {
        api.commands.add((draft) =>
          draft.set("where", { description: "Directory", run: () => api.env.cwd }),
        );
        api.agents.add((draft) => draft.set("worker", { id: "worker", mode: "subagent" }));
      },
    }),
    toolsFsPlugin(),
  ];
}

function fixture(streamFn?: StreamFn) {
  const path = storePath();
  const cwd = dirname(path);
  const destination = join(cwd, "destination");
  mkdirSync(destination);
  const requests: (string | undefined)[] = [];
  const grants = (destinationPlugins?: readonly Plugin[]) => {
    const granted = new Map<string, readonly Plugin[]>([[cwd, plugins("original")]]);
    if (destinationPlugins !== undefined) granted.set(destination, destinationPlugins);
    return granted;
  };
  const open = (trusted: ReadonlyMap<string, readonly Plugin[]>) =>
    createNyte({
      store: openStore(path),
      model,
      models: {
        getModels: () => [model],
        getModel: () => model,
        getAvailable: async () => [model],
      },
      ...localOptions(cwd),
      trust: trustGrants(trusted),
      streamFn:
        streamFn ??
        ((_model, context) => {
          requests.push(getCurrentSystemPrompt(context.messages));
          const response =
            context.messages.findLast((item) => item.role !== "system")?.role === "user"
              ? assistant("", {
                  calls: [
                    call(`write-${requests.length}`, "write", {
                      path: "result.txt",
                      content: getCurrentSystemPrompt(context.messages),
                    }),
                  ],
                })
              : assistant("done");
          const stream = createAssistantMessageEventStream();
          stream.push({
            type: "done",
            reason: response.stopReason === "toolUse" ? "toolUse" : "stop",
            message: response,
          });
          return stream;
        }),
    });
  return {
    path,
    cwd,
    destination,
    requests,
    grants,
    open,
    workspace: localWorkspace(destination),
  };
}

test("failed destination setup preserves the original activation, cwd and runnable tools", async () => {
  const setup = fixture();
  const nyte = await setup.open(
    setup.grants([
      definePlugin({
        id: "broken",
        session(api) {
          api.commands.add(() => {
            throw new Error("setup failed");
          });
        },
      }),
    ]),
  );
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    await nyte.plugins.list(input);
    const outcome = await nyte.relocate({ ...input, workspace: setup.workspace });
    assert.deepEqual(outcome, { kind: "failed", error: "broken: setup failed" });
    assert.equal(await nyte.sessionCwd(input), setup.cwd);
    assert.deepEqual(await nyte.plugins.commands.run({ ...input, name: "where" }), {
      kind: "ran",
      output: setup.cwd,
    });
    assert.ok((await nyte.plugins.list(input)).some((plugin) => plugin.id === "original"));
    nyte.attach();
    await nyte.messages.send({ ...input, content: "write after rollback" });
    await within(nyte.runs.wait(input));
    assert.equal(
      readFileSync(join(setup.cwd, "result.txt"), "utf8"),
      `Current working directory: ${setup.cwd}`,
    );
  } finally {
    await nyte.close();
  }
});

test("a cached foreign runner cannot land or execute in its old cwd and plugin operations block until trust is restored", async () => {
  const setup = fixture();
  const oldGrants = setup.grants();
  const old = await setup.open(oldGrants);
  const moving = await setup.open(setup.grants(plugins("destination")));
  try {
    const session = await old.sessions.create();
    const input = { sessionId: session.sessionId };
    old.attach();
    await old.messages.send({ ...input, content: "before" });
    await within(old.runs.wait(input));
    const workspace = setup.workspace;
    await expect
      .poll(() => moving.relocate({ ...input, workspace }))
      .toEqual({ kind: "relocated" });
    const stored = await openStore(setup.path).open(session.sessionId);
    const afterSeq = await stored.events.last();
    const priorRequests = setup.requests.length;
    // Bypass SDK reconciliation to wake the already-bound runner through the shared store.
    await submit(stored, {
      preparation: { kind: "none" },
      head: "main",
      delivery: "steer",
      kind: "user",
      body: { kind: "message", message: { role: "user", content: "after", timestamp: Date.now() } },
    });
    await expect
      .poll(async () =>
        (await stored.events.read({ afterSeq })).some(
          (event) => event.kind === "notice" && event.message.includes("workspace changed"),
        ),
      )
      .toBe(true);
    assert.equal(setup.requests.length, priorRequests);
    assert.equal((await old.messages.pending(input)).length, 1);
    assert.equal((await old.sessionWorkspace(input)).cwd, workspace.cwd);
    assert.equal((await old.sessions.get(input))?.activation.kind, "requires");
    assert.deepEqual(await old.plugins.commands.run({ ...input, name: "where" }), {
      kind: "not_found",
    });
    assert.deepEqual(await old.plugins.list(input), []);
    oldGrants.set(setup.destination, plugins("destination"));
    await expect.poll(() => old.relocate({ ...input, workspace })).toEqual({ kind: "relocated" });
    await within(old.runs.wait(input));
    assert.equal(
      readFileSync(join(setup.destination, "result.txt"), "utf8"),
      `Current working directory: ${workspace.cwd}`,
    );
    assert.equal(
      readFileSync(join(setup.cwd, "result.txt"), "utf8"),
      `Current working directory: ${setup.cwd}`,
    );
    await stored.close();
  } finally {
    await old.close();
    await moving.close();
  }
});

test("a tree another host moved to a workspace this host trusts runs its next message there", async () => {
  const setup = fixture();
  const old = await setup.open(setup.grants(plugins("destination")));
  const moving = await setup.open(setup.grants(plugins("destination")));
  try {
    const session = await old.sessions.create();
    const input = { sessionId: session.sessionId };
    old.attach();
    await old.messages.send({ ...input, content: "before" });
    await within(old.runs.wait(input));
    await expect
      .poll(() => moving.relocate({ ...input, workspace: setup.workspace }))
      .toEqual({ kind: "relocated" });
    await within(
      Promise.all([
        old.plugins.list(input),
        old.plugins.commands.list(input),
        old.plugins.status.list(input),
      ]),
    );
    assert.deepEqual(await old.plugins.commands.run({ ...input, name: "where" }), {
      kind: "ran",
      output: setup.destination,
    });
    await old.messages.send({ ...input, content: "after" });
    await within(old.runs.wait(input));
    assert.equal(
      readFileSync(join(setup.destination, "result.txt"), "utf8"),
      `Current working directory: ${setup.destination}`,
    );
  } finally {
    await old.close();
    await moving.close();
  }
});

test("a tree another host moved into a workspace this host trusts is active here, children included", async () => {
  const setup = fixture();
  const old = await setup.open(new Map([[setup.destination, plugins("destination")]]));
  const moving = await setup.open(setup.grants(plugins("destination")));
  try {
    const root = await moving.sessions.create();
    const input = { sessionId: root.sessionId };
    const child = await moving.sessions.create({
      parent: { ...input, runId: "run", callId: "call", depth: 1 },
    });
    const childRow = async () =>
      (await old.sessions.list({ parent: root.sessionId })).items.find(
        (row) => row.sessionId === child.sessionId,
      );
    assert.deepEqual((await old.sessions.get(input))?.activation, {
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: setup.cwd },
    });
    assert.equal((await childRow())?.workspace.cwd, setup.cwd);
    assert.deepEqual(await moving.relocate({ ...input, workspace: setup.workspace }), {
      kind: "relocated",
    });
    assert.deepEqual((await old.sessions.get(input))?.activation, { kind: "active" });
    const moved = await childRow();
    assert.equal(moved?.workspace.cwd, setup.destination);
    assert.deepEqual(moved?.activation, { kind: "active" });
  } finally {
    await old.close();
    await moving.close();
  }
});

test("children follow the root across moves and resume without bypassing trust", async () => {
  const setup = fixture();
  const nyte = await setup.open(setup.grants(plugins("destination")));
  const workspace = setup.workspace;
  const parent = await nyte.sessions.create();
  const input = { sessionId: parent.sessionId };
  const originalChild = await nyte.sessions.create({
    parent: { ...input, runId: "original", callId: "original", depth: 1 },
  });
  const oldChildInput = { sessionId: originalChild.sessionId };
  await nyte.relocate({ ...input, workspace });
  const child = await nyte.sessions.create({
    parent: { ...input, runId: "destination", callId: "destination", depth: 1 },
  });
  const childInput = { sessionId: child.sessionId };
  await nyte.sessions.configure({
    ...childInput,
    model: { provider: model.provider, id: model.id },
  });
  try {
    await nyte.plugins.list(childInput);
    assert.ok((await nyte.plugins.list(childInput)).some((plugin) => plugin.id === "destination"));
    assert.equal(await nyte.sessionCwd(oldChildInput), workspace.cwd);
    assert.equal(await nyte.sessionCwd(childInput), workspace.cwd);
  } finally {
    await nyte.close();
  }
  const resumedGrants = setup.grants();
  const resumed = await setup.open(resumedGrants);
  try {
    assert.equal((await resumed.sessionWorkspace(oldChildInput)).cwd, workspace.cwd);
    assert.equal((await resumed.sessionWorkspace(childInput)).cwd, workspace.cwd);
    assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "requires");
    assert.deepEqual(await resumed.plugins.list(childInput), []);
    resumed.attach({ sessions: [parent.sessionId] });
    await resumed.messages.send({ ...childInput, content: "resume child" });
    resumedGrants.set(setup.destination, plugins("destination"));
    await expect
      .poll(() => resumed.relocate({ ...input, workspace }))
      .toEqual({ kind: "relocated" });
    await within(resumed.runs.wait(childInput));
    assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "active");
    assert.ok(
      (await resumed.plugins.list(childInput)).some((plugin) => plugin.id === "destination"),
    );
    assert.equal(
      readFileSync(join(setup.destination, "result.txt"), "utf8"),
      `Current working directory: ${workspace.cwd}`,
    );
    assert.equal((await resumed.sessions.get(oldChildInput))?.activation.kind, "active");
    assert.ok(
      (await resumed.plugins.list(oldChildInput)).some((plugin) => plugin.id === "destination"),
    );
  } finally {
    await resumed.close();
  }
});

test("spawned subagents follow a later parent move", async () => {
  const setup = fixture((_model, context) => {
    // The child's report reaches the parent twice: as the wake and again as a completion.
    const last = context.messages.findLast((item) => item.role !== "system");
    const response =
      last?.role === "user" &&
      !contentText(last.content).startsWith("Background ") &&
      getCurrentTools(context.messages).some((tool) => tool.name === "task")
        ? assistant("", {
            calls: [
              call("delegate", "task", { model: "openai/test-model", prompt: "finish child" }),
            ],
          })
        : assistant("finished");
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: response.stopReason === "toolUse" ? "toolUse" : "stop",
      message: response,
    });
    return stream;
  });
  const grants = setup.grants(plugins("destination"));
  const nyte = await setup.open(grants);
  const workspace = setup.workspace;
  try {
    const parent = await nyte.sessions.create();
    const input = { sessionId: parent.sessionId };
    await nyte.relocate({ ...input, workspace });
    nyte.attach({ sessions: [parent.sessionId] });
    await nyte.messages.send({ ...input, content: "delegate" });
    await expect
      .poll(async () => (await nyte.sessions.list({ parent: parent.sessionId })).items.length)
      .toBe(1);
    const [child] = (await nyte.sessions.list({ parent: parent.sessionId })).items;
    assert.ok(child);
    const childInput = { sessionId: child.sessionId };
    await within(nyte.runs.wait(childInput));
    await expect.poll(async () => (await nyte.runs.current(input))?.phase.kind).toBe("done");
    assert.equal(await nyte.sessionCwd(childInput), workspace.cwd);
    assert.ok((await nyte.plugins.list(childInput)).some((plugin) => plugin.id === "destination"));
    const elsewhere = dirname(storePath());
    const nextWorkspace = localWorkspace(elsewhere);
    grants.set(elsewhere, plugins("elsewhere"));
    await expect
      .poll(() => nyte.relocate({ ...input, workspace: nextWorkspace }))
      .toEqual({ kind: "relocated" });
    assert.equal(await nyte.sessionCwd(childInput), nextWorkspace.cwd);
    await nyte.close();
    const resumedGrants = setup.grants();
    const resumed = await setup.open(resumedGrants);
    try {
      assert.equal((await resumed.sessionWorkspace(childInput)).cwd, nextWorkspace.cwd);
      assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "requires");
      resumedGrants.set(elsewhere, plugins("elsewhere"));
      await resumed.relocate({ ...input, workspace: nextWorkspace });
      assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "active");
      assert.deepEqual(await resumed.plugins.commands.run({ ...childInput, name: "where" }), {
        kind: "ran",
        output: nextWorkspace.cwd,
      });
    } finally {
      await resumed.close();
    }
  } finally {
    await nyte.close();
  }
});

test("destination setup holds head reservations against another store connection", async () => {
  const setup = fixture();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const nyte = await setup.open(
    setup.grants([
      definePlugin({
        id: "slow",
        async session() {
          started.resolve();
          await finish.promise;
        },
      }),
    ]),
  );
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    const relocating = nyte.relocate({ ...input, workspace: setup.workspace });
    await within(started.promise);
    const stored = await openStore(setup.path).open(session.sessionId);
    try {
      const acquired = await stored.leases.acquire("refs/heads/main", 15_000);
      if (acquired.ok) await stored.leases.release(acquired.lease);
      assert.equal(acquired.ok, false);
      finish.resolve();
      assert.deepEqual(await within(relocating), { kind: "relocated" });
      const released = await stored.leases.acquire("refs/heads/main", 15_000);
      assert.ok(released.ok);
      await stored.leases.release(released.lease);
    } finally {
      await stored.close();
    }
  } finally {
    finish.resolve();
    await nyte.close();
  }
});
