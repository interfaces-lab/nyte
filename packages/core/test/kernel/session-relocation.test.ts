import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { getCurrentSystemPrompt } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { definePlugin, toolsFsPlugin, type Plugin } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  call,
  localOptions,
  localWorkspace,
  openStore,
  regrant,
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

function locationPlugin(id: string) {
  return definePlugin({
    id,
    session(api) {
      api.commands.add((draft) =>
        draft.set("where", {
          description: "Current directory",
          run: () => api.env.cwd,
        }),
      );
    },
  });
}

test("relocation keeps history in its store, rebinds filesystem tools, and requires trust again on resume", async () => {
  const path = storePath();
  const cwd = dirname(path);
  const destination = join(cwd, "destination");
  mkdirSync(destination);
  const workspace = localWorkspace(destination);
  const requests: number[] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(context.messages.filter((message) => message.role === "user").length);
    const last = context.messages.findLast((item) => item.role !== "system");
    const response =
      last?.role === "user"
        ? assistant("", {
            calls: [
              call(`write-${requests.length}`, "write", {
                path: "result.txt",
                content: String(requests.at(-1)),
              }),
            ],
          })
        : assistant("written");
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: response.stopReason === "toolUse" ? "toolUse" : "stop",
      message: response,
    });
    return stream;
  };
  const open = (grants: ReadonlyMap<string, readonly Plugin[]>) =>
    createNyte({
      store: openStore(path),
      streamFn,
      model,
      models: {
        getModels: () => [model],
        getModel: () => model,
        getAvailable: async () => [model],
      },
      ...localOptions(cwd, [toolsFsPlugin()]),
      trust: trustGrants(grants),
    });
  const grants = new Map([
    [cwd, [locationPlugin("original")]],
    [destination, [locationPlugin("destination")]],
  ]);
  const nyte = await open(grants);
  const selected = await nyte.sessions.create();
  const other = await nyte.sessions.create();
  const input = { sessionId: selected.sessionId };
  try {
    nyte.attach();
    await nyte.messages.send({ ...input, content: "first" });
    await within(nyte.runs.wait(input));
    const history = await nyte.messages.list(input);
    assert.equal(readFileSync(join(cwd, "result.txt"), "utf8"), "1");
    await expect.poll(() => nyte.relocate({ ...input, workspace })).toEqual({ kind: "relocated" });
    assert.deepEqual(await nyte.messages.list(input), history);
    assert.equal(await nyte.sessionCwd(input), workspace.cwd);
    assert.equal(await nyte.sessionCwd({ sessionId: other.sessionId }), cwd);
    assert.deepEqual(await nyte.plugins.commands.run({ ...input, name: "where" }), {
      kind: "ran",
      output: workspace.cwd,
    });
    regrant(grants, cwd, [locationPlugin("reloaded")]);
    await expect
      .poll(async () =>
        (await nyte.plugins.list({ sessionId: other.sessionId })).some(
          (plugin) => plugin.id === "reloaded",
        ),
      )
      .toBe(true);
    assert.ok((await nyte.plugins.list(input)).some((plugin) => plugin.id === "destination"));
    await nyte.messages.send({ ...input, content: "second" });
    await within(nyte.runs.wait(input));
    assert.equal(readFileSync(join(destination, "result.txt"), "utf8"), "2");
    assert.equal(readFileSync(join(cwd, "result.txt"), "utf8"), "1");
    assert.equal(existsSync(join(destination, ".nyte", "sessions.db")), false);
    const transcript = await nyte.messages.list(input);
    await nyte.close();
    const resumedGrants = new Map([[cwd, [locationPlugin("original")]]]);
    const resumed = await open(resumedGrants);
    try {
      assert.equal((await resumed.sessionWorkspace(input)).cwd, workspace.cwd);
      assert.deepEqual((await resumed.sessions.get(input))?.activation, {
        kind: "requires",
        requirement: { kind: "workspace_trust", cwd: workspace.cwd },
      });
      assert.deepEqual(await resumed.plugins.list(input), []);
      assert.deepEqual(await resumed.messages.list(input), transcript);
      // Pending work can be restored to the saved directory, but not relocated elsewhere.
      await resumed.messages.send({ ...input, content: "third" });
      resumedGrants.set(destination, [locationPlugin("destination")]);
      assert.deepEqual(await resumed.relocate({ ...input, workspace }), { kind: "relocated" });
      resumed.attach({ sessions: [selected.sessionId] });
      await within(resumed.runs.wait(input));
      assert.equal(readFileSync(join(destination, "result.txt"), "utf8"), "3");
    } finally {
      await resumed.close();
    }
  } finally {
    await nyte.close();
  }
});

test("relocation rejects queued work and another head's execution lease without changing location", async () => {
  const path = storePath();
  const cwd = dirname(path);
  const destination = join(cwd, "destination");
  mkdirSync(destination);
  const workspace = localWorkspace(destination);
  const store = openStore(path);
  const nyte = await createNyte({
    store,
    model,
    streamFn: () => {
      throw new Error("must not run");
    },
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    ...localOptions(cwd),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    const queued = await nyte.messages.send({ ...input, content: "pending" });
    assert.deepEqual(await nyte.relocate({ ...input, workspace }), { kind: "busy" });
    await nyte.messages.cancel({ ...input, change: queued.change });
    const stored = await store.open(session.sessionId);
    try {
      await nyte.heads.create({ ...input, head: "other", from: { head: "main" } });
      const lease = await stored.leases.acquire("refs/heads/other", 10_000);
      assert.ok(lease.ok);
      assert.deepEqual(await nyte.relocate({ ...input, workspace }), { kind: "busy" });
      assert.equal(await nyte.sessionCwd(input), cwd);
      await stored.leases.release(lease.lease);
      assert.deepEqual(await nyte.relocate({ ...input, workspace }), {
        kind: "relocated",
      });
    } finally {
      await stored.close();
    }
  } finally {
    await nyte.close();
  }
});

test("scoped plugin reload keeps the directory and leaves a live run and other sessions alone", async () => {
  const path = storePath();
  const cwd = dirname(path);
  const destination = join(cwd, "destination");
  mkdirSync(destination);
  const workspace = localWorkspace(destination);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const grants = new Map([
    [cwd, [locationPlugin("original")]],
    [destination, [locationPlugin("destination")]],
  ]);
  const nyte = await createNyte({
    store: openStore(path),
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    ...localOptions(cwd),
    trust: trustGrants(grants),
    streamFn: () => {
      const stream = createAssistantMessageEventStream();
      started.resolve();
      void release.promise.then(() => {
        stream.push({ type: "done", reason: "stop", message: assistant("finished") });
      });
      return stream;
    },
  });
  try {
    const selected = await nyte.sessions.create();
    const other = await nyte.sessions.create();
    const input = { sessionId: selected.sessionId };
    assert.deepEqual(await nyte.relocate({ ...input, workspace }), { kind: "relocated" });
    nyte.attach();
    await nyte.messages.send({ ...input, content: "keep running" });
    await within(started.promise);
    const run = await nyte.runs.current(input);
    // The change lands mid-response, so the reload waits for the run.
    regrant(grants, destination, [locationPlugin("reloaded")]);
    assert.ok((await nyte.plugins.list(input)).some((plugin) => plugin.id === "destination"));
    assert.deepEqual(await nyte.plugins.commands.run({ ...input, name: "where" }), {
      kind: "ran",
      output: workspace.cwd,
    });
    assert.deepEqual(
      await nyte.plugins.commands.run({ sessionId: other.sessionId, name: "where" }),
      { kind: "ran", output: cwd },
    );
    assert.ok(
      (await nyte.plugins.list({ sessionId: other.sessionId })).some(
        (plugin) => plugin.id === "original",
      ),
    );
    assert.equal((await nyte.runs.current(input))?.runId, run?.runId);
    assert.equal((await nyte.runs.current(input))?.abortRequested, undefined);
    release.resolve();
    await within(nyte.runs.wait(input));
    assert.equal((await nyte.runs.current(input))?.phase.kind, "done");
    await expect
      .poll(async () => (await nyte.plugins.list(input)).some((plugin) => plugin.id === "reloaded"))
      .toBe(true);
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("messages admitted during relocation run only after destination activation finishes", async () => {
  const path = storePath();
  const cwd = dirname(path);
  const destination = dirname(storePath());
  const workspace = localWorkspace(destination);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const prompts: (string | undefined)[] = [];
  const nyte = await createNyte({
    store: openStore(path),
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    ...localOptions(cwd),
    trust: trustGrants(
      new Map([
        [cwd, []],
        [
          destination,
          [
            definePlugin({
              id: "slow-destination",
              async session(api) {
                started.resolve();
                await finish.promise;
                api.prompt.add((draft) => draft.set("cwd", { text: api.env.cwd }));
              },
            }),
          ],
        ],
      ]),
    ),
    streamFn: (_model, context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("done") });
      return stream;
    },
  });
  try {
    const session = await nyte.sessions.create();
    const input = { sessionId: session.sessionId };
    const relocating = nyte.relocate({ ...input, workspace });
    await within(started.promise);
    assert.deepEqual(await nyte.relocate({ ...input, workspace }), { kind: "busy" });
    nyte.attach();
    await nyte.messages.send({ ...input, content: "during relocation" });
    assert.equal(await nyte.runs.current(input), undefined);
    assert.deepEqual(prompts, []);
    finish.resolve();
    assert.deepEqual(await within(relocating), { kind: "relocated" });
    await within(nyte.runs.wait(input));
    assert.deepEqual(prompts, [workspace.cwd]);
  } finally {
    finish.resolve();
    await nyte.close();
  }
});
