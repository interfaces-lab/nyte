import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { expect, test } from "vitest";
import { submit } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { definePlugin, inlinePlugin, toolsFsPlugin } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, storePath, trustWorkspace, within } from "./helpers.ts";

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
    inlinePlugin(
      definePlugin({
        id,
        session(api) {
          api.commands.add((draft) =>
            draft.set("where", { description: "Directory", run: () => api.env.cwd }),
          );
          api.prompt.add((draft) => draft.set("cwd", { text: api.env.cwd }));
          api.agents.add((draft) => draft.set("worker", { id: "worker", mode: "subagent" }));
        },
      }),
    ),
    inlinePlugin(toolsFsPlugin()),
  ];
}

function fixture(streamFn?: StreamFn) {
  const path = storePath();
  const cwd = dirname(path);
  const destination = join(cwd, "destination");
  mkdirSync(destination);
  const requests: (string | undefined)[] = [];
  const open = () =>
    createNyte({
      store: openStore(path),
      model,
      models: {
        getModels: () => [model],
        getModel: () => model,
        getAvailable: async () => [model],
      },
      plugins: plugins("original"),
      env: { cwd },
      streamFn:
        streamFn ??
        ((_model, context) => {
          requests.push(context.systemPrompt);
          const response =
            context.messages.at(-1)?.role === "user"
              ? assistant("", {
                  calls: [
                    call(`write-${requests.length}`, "write", {
                      path: "result.txt",
                      content: context.systemPrompt ?? "",
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
    open,
    workspace: trustWorkspace(destination),
  };
}

test("failed destination setup preserves the original activation, cwd and runnable tools", async () => {
  const setup = fixture();
  const nyte = await setup.open();
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    await nyte.plugins.list(input);
    const workspace = await setup.workspace;
    await assert.rejects(
      nyte.relocate({
        ...input,
        workspace,
        plugins: [
          inlinePlugin(
            definePlugin({
              id: "broken",
              session() {
                throw new Error("setup failed");
              },
            }),
          ),
        ],
      }),
      /Destination plugin setup failed: broken/,
    );
    assert.equal(await nyte.sessionCwd(input), setup.cwd);
    assert.deepEqual(await nyte.plugins.commands.run({ ...input, name: "where" }), {
      kind: "ran",
      output: setup.cwd,
    });
    assert.ok((await nyte.plugins.list(input)).some((plugin) => plugin.id === "original"));
    nyte.attach();
    await nyte.messages.send({ ...input, content: "write after rollback" });
    await within(nyte.runs.wait(input));
    assert.equal(readFileSync(join(setup.cwd, "result.txt"), "utf8"), setup.cwd);
  } finally {
    await nyte.close();
  }
});

test("a cached foreign runner cannot land or execute in its old cwd and plugin operations block until trust is restored", async () => {
  const setup = fixture();
  const old = await setup.open();
  const moving = await setup.open();
  try {
    const session = await old.sessions.create();
    const input = { sessionId: session.sessionId };
    old.attach();
    await old.messages.send({ ...input, content: "before" });
    await within(old.runs.wait(input));
    const workspace = await setup.workspace;
    await expect
      .poll(() => moving.relocate({ ...input, workspace, plugins: plugins("destination") }))
      .toEqual({ kind: "relocated" });
    const stored = await openStore(setup.path).open(session.sessionId);
    const afterSeq = await stored.events.last();
    const priorRequests = setup.requests.length;
    // Bypass SDK reconciliation to wake the already-bound runner through the shared store.
    await submit(stored, {
      head: "main",
      lane: "steer",
      body: { kind: "message", message: { role: "user", content: "after", timestamp: Date.now() } },
    });
    await expect
      .poll(async () =>
        (await stored.events.read({ afterSeq })).some(
          (event) => event.kind === "notice" && event.message.includes("directory changed"),
        ),
      )
      .toBe(true);
    assert.equal(setup.requests.length, priorRequests);
    assert.equal((await old.messages.pending(input)).length, 1);
    assert.equal(await old.sessionCwd(input), workspace.cwd);
    assert.equal((await old.sessions.get(input))?.activation.kind, "requires");
    assert.deepEqual(await old.plugins.commands.run({ ...input, name: "where" }), {
      kind: "not_found",
    });
    await assert.rejects(old.setPlugins(plugins("unsafe-reload"), input), /not active/);
    await old.setPlugins(plugins("global"));
    assert.deepEqual(await old.plugins.list(input), []);
    await expect
      .poll(() => old.relocate({ ...input, workspace, plugins: plugins("destination") }))
      .toEqual({ kind: "relocated" });
    await within(old.runs.wait(input));
    assert.equal(readFileSync(join(setup.destination, "result.txt"), "utf8"), workspace.cwd);
    assert.equal(readFileSync(join(setup.cwd, "result.txt"), "utf8"), setup.cwd);
    await stored.close();
  } finally {
    await old.close();
    await moving.close();
  }
});

test("children keep their creation directory across parent moves and resume without bypassing trust", async () => {
  const setup = fixture();
  const nyte = await setup.open();
  const workspace = await setup.workspace;
  const parent = await nyte.sessions.create();
  const input = { sessionId: parent.sessionId };
  const originalChild = await nyte.sessions.create({
    parent: { ...input, runId: "original", callId: "original", depth: 1 },
  });
  const oldChildInput = { sessionId: originalChild.sessionId };
  await nyte.relocate({ ...input, workspace, plugins: plugins("destination") });
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
    await nyte.setPlugins(plugins("global"));
    assert.ok((await nyte.plugins.list(childInput)).some((plugin) => plugin.id === "destination"));
    assert.equal(await nyte.sessionCwd(oldChildInput), setup.cwd);
    assert.equal(await nyte.sessionCwd(childInput), workspace.cwd);
  } finally {
    await nyte.close();
  }
  const resumed = await setup.open();
  try {
    assert.equal(await resumed.sessionCwd(oldChildInput), setup.cwd);
    assert.equal(await resumed.sessionCwd(childInput), workspace.cwd);
    assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "requires");
    assert.deepEqual(await resumed.plugins.list(childInput), []);
    resumed.attach({ sessions: [parent.sessionId] });
    await resumed.messages.send({ ...childInput, content: "resume child" });
    await expect
      .poll(() => resumed.relocate({ ...input, workspace, plugins: plugins("destination") }))
      .toEqual({ kind: "relocated" });
    await within(resumed.runs.wait(childInput));
    assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "active");
    await resumed.setPlugins(plugins("global-after-restore"));
    assert.ok(
      (await resumed.plugins.list(childInput)).some((plugin) => plugin.id === "destination"),
    );
    assert.equal(readFileSync(join(setup.destination, "result.txt"), "utf8"), workspace.cwd);
    assert.equal((await resumed.sessions.get(oldChildInput))?.activation.kind, "requires");
    assert.deepEqual(await resumed.plugins.list(oldChildInput), []);
  } finally {
    await resumed.close();
  }
});

test("spawned subagents persist the parent's destination instead of following a later parent move", async () => {
  const setup = fixture((_model, context) => {
    // The child's report reaches the parent twice: as the wake and again as a completion.
    const last = context.messages.at(-1);
    const response =
      last?.role === "user" &&
      !contentText(last.content).startsWith("Background ") &&
      context.tools?.some((tool) => tool.name === "task")
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
  const nyte = await setup.open();
  const workspace = await setup.workspace;
  try {
    const parent = await nyte.sessions.create();
    const input = { sessionId: parent.sessionId };
    await nyte.relocate({ ...input, workspace, plugins: plugins("destination") });
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
    await nyte.setPlugins(plugins("global"));
    assert.ok((await nyte.plugins.list(childInput)).some((plugin) => plugin.id === "destination"));
    const elsewhere = dirname(storePath());
    const nextWorkspace = await trustWorkspace(elsewhere);
    await expect
      .poll(() =>
        nyte.relocate({ ...input, workspace: nextWorkspace, plugins: plugins("elsewhere") }),
      )
      .toEqual({ kind: "relocated" });
    assert.equal(await nyte.sessionCwd(childInput), workspace.cwd);
    await nyte.close();
    const resumed = await setup.open();
    try {
      assert.equal(await resumed.sessionCwd(childInput), workspace.cwd);
      assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "requires");
      await resumed.relocate({ ...input, workspace: nextWorkspace, plugins: plugins("elsewhere") });
      assert.equal((await resumed.sessions.get(childInput))?.activation.kind, "requires");
      assert.deepEqual(await resumed.plugins.commands.run({ ...childInput, name: "where" }), {
        kind: "not_found",
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
  const nyte = await setup.open();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    const relocating = nyte.relocate({
      ...input,
      workspace: await setup.workspace,
      plugins: [
        inlinePlugin(
          definePlugin({
            id: "slow",
            async session() {
              started.resolve();
              await finish.promise;
            },
          }),
        ),
      ],
    });
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
