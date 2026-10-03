import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { afterEach, test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { getCurrentSystemPrompt, getCurrentTools } from "@nyte-ai/schema";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte, NyteOptions } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin, type AgentTool } from "../../src/plugins/index.ts";
import { headRef } from "../../src/kernel/names.ts";
import { ToolWait, backgroundWait, type StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, storePath, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "advance-test",
  name: "Advance test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const models: NyteOptions["models"] = {
  getModels: () => [model],
  getModel: (provider, id) => (provider === model.provider && id === model.id ? model : undefined),
  getAvailable: async () => [model],
};

const sdks: Nyte[] = [];
afterEach(async () => {
  for (const sdk of sdks.splice(0).reverse()) await sdk.close();
});

function scripted(
  respond: (...args: Parameters<StreamFn>) => AssistantMessage | Promise<AssistantMessage>,
): StreamFn {
  return (...args) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message = await respond(...args);
      if (message.stopReason === "pending")
        throw new Error("Script must finish its provider response");
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        stream.push({ type: "error", reason: message.stopReason, error: message });
      } else {
        stream.push({ type: "done", reason: message.stopReason, message });
      }
    })().catch((error: unknown) => {
      stream.push({
        type: "error",
        reason: "error",
        error: assistant("", {
          stop: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    });
    return stream;
  };
}

async function open(
  streamFn: StreamFn,
  options: Partial<Pick<NyteOptions, "store" | "plugins" | "prepareResponsePlugins">> = {},
): Promise<Nyte> {
  const sdk = await createNyte({
    store: openStore(),
    streamFn,
    model,
    models,
    plugins: [],
    env: { cwd: "/tmp/nyte-advance" },
    ...options,
  });
  sdks.push(sdk);
  return sdk;
}

test("an unattached host lands one step, responds in the next, and preserves the result on reopen", async () => {
  const path = storePath();
  let calls = 0;
  const streamFn = scripted(() => {
    calls += 1;
    return assistant("A durable answer");
  });
  const sdk = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await sdk.sessions.create();
  const source = { kind: "action", label: "Commit changes" } as const;
  await sdk.messages.send({ sessionId, content: "Please answer", source });
  assert.equal(await sdk.runs.current({ sessionId }), undefined);
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "continue" });
  assert.equal(calls, 0);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "respond");
  assert.equal((await sdk.messages.pending({ sessionId })).length, 0);
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "finished" });
  assert.equal(calls, 1);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "done");
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
  await sdk.close();

  const reopened = await open(streamFn, { store: openStore(path) });
  const transcript = await reopened.messages.list({ sessionId });
  const actionPart = transcript
    .flatMap((turn) => (turn.kind === "turn" ? turn.parts : []))
    .find((part) => part.kind === "user" && part.content === "Please answer");
  assert.ok(actionPart?.kind === "user");
  assert.deepEqual(actionPart.source, source);
  assert.ok(
    transcript.some(
      (turn) =>
        turn.kind === "turn" &&
        turn.parts.some((part) => part.kind === "assistant" && part.text === "A durable answer"),
    ),
  );
  assert.deepEqual(await reopened.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
});

test("configuration without user input does not authorize a model call", async () => {
  let calls = 0;
  const sdk = await open(
    scripted(() => {
      calls += 1;
      return assistant("must not run");
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.sessions.configure({ sessionId, thinkingLevel: "off" });
  await sdk.advance({ sessionId });
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 0);
  assert.equal((await sdk.messages.pending({ sessionId })).length, 0);
});

test("advance returns the durable tool deadline immediately and leaves the wait parked", async () => {
  const until = Date.now() + 60_000;
  let tools = 0;
  const waiting = inlinePlugin(
    definePlugin({
      id: "wait",
      session(api) {
        api.tools.add((draft) =>
          draft.set("wait", {
            name: "wait",
            description: "Wait for a reply",
            parameters: Type.Object({}),
            execute: async () => {
              tools += 1;
              throw new ToolWait({ until });
            },
            wake: async () => ({
              kind: "success",
              result: { content: [{ type: "text", text: "done" }], details: {} },
            }),
          }),
        );
      },
    }),
  );
  const sdk = await open(
    scripted(() => assistant("", { calls: [call("wait-1", "wait")] })),
    { plugins: [waiting] },
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "Wait" });
  await sdk.advance({ sessionId });
  await sdk.advance({ sessionId });
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "waiting", until });
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "waiting");
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "waiting", until });
  assert.equal(tools, 1);
});

test("provider backoff returns a persisted retry time without sleeping or making another request", async () => {
  let calls = 0;
  const sdk = await open(
    scripted(() => {
      calls += 1;
      return assistant("", {
        stop: "error",
        error: "rate limited; server requested 60s retry delay",
      });
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "Try this" });
  await sdk.advance({ sessionId });
  const retry = await within(sdk.advance({ sessionId }), 1000);
  assert.ok(retry.kind === "retry");
  assert.ok(retry.at > Date.now() + 50_000);
  const stored = await sdk.runs.current({ sessionId });
  assert.ok(stored?.phase.kind === "retry");
  assert.equal(stored.phase.at, retry.at);
  assert.deepEqual(await within(sdk.advance({ sessionId }), 1000), retry);
  assert.equal(calls, 1);
});

test("concurrent hosts return the held lease deadline and do not run a second model request", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const streamFn = scripted(async () => {
    calls += 1;
    started.resolve();
    await release.promise;
    return assistant("one response");
  });
  const first = await open(streamFn, { store: openStore(path) });
  const second = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "Start" });
  await first.advance({ sessionId });
  const response = first.advance({ sessionId });
  try {
    await within(started.promise);
    const busy = await second.advance({ sessionId });
    const session = await openStore(path).open(sessionId);
    const holder = await session.leases.read(headRef("main"));
    assert.ok(holder);
    assert.deepEqual(busy, { kind: "busy", until: holder.expiresAt });
    assert.equal(calls, 1);
  } finally {
    release.resolve();
    await response;
  }
  assert.deepEqual(await second.advance({ sessionId }), { kind: "idle" });
  assert.equal(calls, 1);
});

test("a remote stop cancels the in-flight step and cannot cancel the next user run", async () => {
  const path = storePath();
  const started = Promise.withResolvers<void>();
  let calls = 0;
  const streamFn = scripted(async (_model, _context, options) => {
    calls += 1;
    if (calls !== 1) return assistant("the next answer");
    started.resolve();
    await assert.rejects(setTimeout(60_000, undefined, { signal: options?.signal }));
    return assistant("partial", { stop: "aborted" });
  });
  const first = await open(streamFn, { store: openStore(path) });
  const second = await open(streamFn, { store: openStore(path) });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "first" });
  await first.advance({ sessionId });
  const oldRun = await first.runs.current({ sessionId });
  const response = first.advance({ sessionId });
  await within(started.promise);
  assert.equal((await second.runs.abort({ sessionId }))?.kind, "requested");
  await second.messages.send({ sessionId, content: "second" });
  await within(response);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outcome = await first.advance({ sessionId });
    if (outcome.kind === "idle") break;
  }
  assert.equal(calls, 2);
  const current = await first.runs.current({ sessionId });
  assert.notEqual(current?.runId, oldRun?.runId);
  assert.equal(current?.phase.kind, "done");
  const turns = (await second.messages.list({ sessionId })).filter((turn) => turn.kind === "turn");
  assert.deepEqual(
    turns.map((turn) => turn.failure?.class),
    ["aborted", undefined],
  );
  assert.ok(
    turns[1]?.parts.some((part) => part.kind === "assistant" && part.text === "the next answer"),
  );
});

test("closing an unattached SDK aborts and drains a step before closing its session", async () => {
  const started = Promise.withResolvers<void>();
  const sdk = await open(
    scripted(async (_model, _context, options) => {
      started.resolve();
      await assert.rejects(setTimeout(60_000, undefined, { signal: options?.signal }));
      return assistant("", { stop: "aborted" });
    }),
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "slow" });
  await sdk.advance({ sessionId });
  const response = sdk.advance({ sessionId });
  await within(started.promise);
  await within(sdk.close());
  await response;
  await assert.rejects(sdk.advance({ sessionId }), /nyte is closed/);
});

test("a host that cannot activate the session leaves queued input untouched", async () => {
  const sdk = await createNyte({
    store: openStore(),
    models,
    model,
    streamFn: scripted(() => assistant("must not run")),
    resolveActivation: () => ({
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/untrusted" },
    }),
  });
  sdks.push(sdk);
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "pending trust" });
  await assert.rejects(sdk.advance({ sessionId }), /not active/);
  assert.equal((await sdk.messages.pending({ sessionId })).length, 1);
  assert.equal(await sdk.runs.current({ sessionId }), undefined);
});

test("replacement preserves the offered tool and parked wake handler while another session progresses", async () => {
  const responding = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  let executed = 0;
  let woken = 0;
  let oldSignal: AbortSignal | undefined;
  let resourceOpen = true;
  const deferred = Promise.withResolvers<void>();
  const original = inlinePlugin(
    definePlugin({
      id: "catalog",
      session(api) {
        oldSignal ??= api.signal;
        const enabled = api.settings.add("enabled", {
          label: "Enabled",
          default: "on",
          choices: [
            { id: "on", label: "On" },
            { id: "off", label: "Off" },
          ],
        });
        enabled.subscribe(() => {
          api.defer(() => {
            resourceOpen = false;
          });
          deferred.resolve();
        });
        api.tools.add((draft) =>
          draft.set("ask", {
            name: "ask",
            description: "old",
            parameters: Type.Object({}),
            execute: async () => {
              assert.equal(api.signal.aborted, false);
              executed += 1;
              throw new ToolWait(backgroundWait);
            },
            wake: async () => {
              assert.equal(api.signal.aborted, false);
              assert.equal(resourceOpen, true);
              woken += 1;
              return {
                kind: "success",
                result: { content: [{ type: "text", text: "old answer" }], details: {} },
              };
            },
          }),
        );
      },
    }),
    { version: "old" },
  );
  const replacement = inlinePlugin(
    definePlugin({
      id: "catalog",
      session(api) {
        api.tools.add((draft) =>
          draft.set("ask", {
            name: "ask",
            description: "new",
            parameters: Type.Object({}),
            execute: async () => {
              assert.fail("new tool was not offered");
            },
            wake: async () => {
              assert.fail("new wake handler did not park this call");
            },
          }),
        );
      },
    }),
    { version: "new" },
  );
  const sdk = await open(
    scripted(async (_model, context) => {
      const tail = context.messages.findLast((item) => item.role !== "system");
      if (tail?.role !== "user" || tail.content !== "ask") return assistant("independent");
      assert.equal(getCurrentTools(context.messages)[0]?.description, "old");
      responding.resolve();
      await response.promise;
      return assistant("", { calls: [call("question", "ask")] });
    }),
    { plugins: [original] },
  );
  const first = (await sdk.sessions.create()).sessionId;
  const second = (await sdk.sessions.create()).sessionId;
  try {
    await sdk.messages.send({ sessionId: first, content: "ask" });
    await sdk.advance({ sessionId: first });
    const answering = sdk.advance({ sessionId: first });
    await responding.promise;
    assert.deepEqual(await within(sdk.setPlugins([replacement], { sessionId: first }), 1000), {
      kind: "queued",
    });
    assert.equal((await sdk.plugins.list({ sessionId: first }))[0]?.version, "old");
    await sdk.messages.send({ sessionId: second, content: "other" });
    await sdk.advance({ sessionId: second });
    assert.deepEqual(await within(sdk.advance({ sessionId: second }), 1000), { kind: "finished" });
    response.resolve();
    await answering;
    assert.deepEqual(await sdk.advance({ sessionId: first }), { kind: "waiting" });
    assert.equal(executed, 1);
    assert.equal(oldSignal?.aborted, false);
    assert.equal((await sdk.plugins.list({ sessionId: first }))[0]?.version, "old");
    await sdk.plugins.settings.apply({ sessionId: first, id: "enabled", choiceId: "off" });
    await within(deferred.promise, 1000);
    assert.equal(resourceOpen, true);
    const parked = (await sdk.sessions.snapshot({ sessionId: first }))?.parked?.find(
      (item) => item.callId === "question",
    );
    assert.ok(parked);
    await sdk.runs.reply({
      sessionId: first,
      callId: "question",
      waitId: parked.waitId,
      reply: "yes",
    });
    await sdk.advance({ sessionId: first });
    assert.equal(woken, 1);
    await sdk.advance({ sessionId: first });
    assert.equal((await sdk.plugins.list({ sessionId: first }))[0]?.version, "new");
    assert.equal(resourceOpen, false);
    assert.equal(oldSignal?.aborted, true);
    const messages = await sdk.messages.list({ sessionId: first });
    assert.ok(
      messages.some(
        (turn) =>
          turn.kind === "turn" &&
          turn.parts.some((part) => part.kind === "tool" && part.result?.output === "old answer"),
      ),
    );
  } finally {
    response.resolve();
  }
});

test("a global setup failure leaves every session's old plugins and the default catalog intact", async () => {
  const original = inlinePlugin(
    definePlugin({
      id: "catalog",
      session(api) {
        api.commands.add((draft) =>
          draft.set("version", { description: "Version", run: () => "old" }),
        );
      },
    }),
    { version: "old" },
  );
  const sdk = await open(
    scripted(() => assistant("unused")),
    { plugins: [original] },
  );
  const first = (await sdk.sessions.create()).sessionId;
  const second = (await sdk.sessions.create()).sessionId;
  for (const sessionId of [first, second]) await sdk.plugins.list({ sessionId });
  const replacement = inlinePlugin(
    definePlugin({
      id: "catalog",
      async session(api) {
        if ((await api.session.info()).id === second)
          throw new Error("cannot prepare second session");
        api.commands.add((draft) =>
          draft.set("version", { description: "Version", run: () => "new" }),
        );
      },
    }),
    { version: "new" },
  );
  const outcome = await sdk.setPlugins([replacement]);
  assert.equal(outcome.kind, "rejected");
  for (const sessionId of [first, second]) {
    assert.deepEqual(await sdk.plugins.commands.run({ sessionId, name: "version" }), {
      kind: "ran",
      output: "old",
    });
    assert.equal((await sdk.plugins.list({ sessionId }))[0]?.version, "old");
  }
  assert.equal((await sdk.plugins.catalog()).plugins[0]?.version, "old");
});

test("replacement from a tool executing in the attached runner returns without waiting for itself and reaches the next response", async () => {
  const offered: string[][] = [];
  let sdk: Nyte | undefined;
  const tool = (name: string, execute: () => Promise<void>): AgentTool => ({
    name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => {
      await execute();
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  });
  const toolsPlugin = (tools: readonly AgentTool[]) =>
    inlinePlugin(
      definePlugin({
        id: "tools",
        session(api) {
          api.tools.add((draft) => {
            for (const item of tools) draft.set(item.name, item);
          });
        },
      }),
      { version: tools.map((item) => item.name).join(",") },
    );
  const make = tool("make", async () => {
    if (sdk === undefined) throw new Error("no host");
    assert.deepEqual(
      await sdk.setPlugins([toolsPlugin([make, tool("made", async () => undefined)])]),
      { kind: "queued" },
    );
  });
  sdk = await open(
    scripted((_model, context) => {
      offered.push(getCurrentTools(context.messages).map((item) => item.name));
      return offered.length === 1
        ? assistant("", { calls: [call("make-1", "make", {})] })
        : assistant("done");
    }),
    { plugins: [toolsPlugin([make])] },
  );
  const { sessionId } = await sdk.sessions.create();
  sdk.attach();
  await sdk.messages.send({ sessionId, content: "go" });
  assert.deepEqual(await within(sdk.runs.wait({ sessionId }), 1000), { kind: "idle" });
  assert.deepEqual(
    offered.map((names) => names.filter((name) => name === "make" || name === "made")),
    [["make"], ["make", "made"]],
  );
});

test("response preparation reconciles source changes before resolving the next request, never during tools", async () => {
  let written = false;
  const inputs: Parameters<NonNullable<NyteOptions["prepareResponsePlugins"]>>[0][] = [];
  const catalog = (version: string) =>
    inlinePlugin(
      definePlugin({
        id: "source",
        session(api) {
          api.prompt.add((draft) => draft.set("version", { text: version }));
          api.tools.add((draft) => {
            draft.set("write", {
              name: "write",
              description: "Write a source",
              parameters: Type.Object({}),
              execute: async () => {
                written = true;
                return { content: [{ type: "text", text: "written" }], details: {} };
              },
            });
            if (version === "new")
              draft.set("new-tool", {
                name: "new-tool",
                description: "New tool",
                parameters: Type.Object({}),
                execute: async () => ({ content: [], details: {} }),
              });
          });
        },
      }),
      { version },
    );
  const old = catalog("old");
  const next = catalog("new");
  const offered: string[][] = [];
  const prompts: string[] = [];
  const sdk = await open(
    scripted((_model, context) => {
      offered.push(getCurrentTools(context.messages).map((tool) => tool.name));
      prompts.push(getCurrentSystemPrompt(context.messages));
      return offered.length === 1
        ? assistant("", { calls: [call("write-1", "write")] })
        : assistant("done");
    }),
    {
      plugins: [old],
      prepareResponsePlugins: async (input) => {
        inputs.push(input);
        return [written ? next : old];
      },
    },
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "write a plugin" });
  await sdk.advance({ sessionId });
  assert.equal(inputs.length, 0);
  await sdk.advance({ sessionId });
  assert.equal(inputs.length, 1);
  await sdk.advance({ sessionId });
  assert.equal(written, true);
  assert.equal(inputs.length, 1);
  await sdk.advance({ sessionId });
  assert.deepEqual(inputs, [
    { sessionId, cwd: "/tmp/nyte-advance" },
    { sessionId, cwd: "/tmp/nyte-advance" },
  ]);
  assert.equal(offered[0]?.includes("new-tool"), false);
  assert.equal(offered[1]?.includes("new-tool"), true);
  assert.deepEqual(prompts, ["old", "new"]);
});

test("a response source-preparation failure emits a diagnostic and uses the last good catalog", async () => {
  const initial = inlinePlugin(
    definePlugin({
      id: "source",
      session(api) {
        api.prompt.add((draft) => draft.set("prompt", { text: "last good" }));
      },
    }),
  );
  let prompt = "";
  const sdk = await open(
    scripted((_model, context) => {
      prompt = getCurrentSystemPrompt(context.messages);
      return assistant("done");
    }),
    {
      plugins: [initial],
      prepareResponsePlugins: async () => {
        throw new Error("source preparation failed");
      },
    },
  );
  const { sessionId } = await sdk.sessions.create();
  const synced = Promise.withResolvers<void>();
  const diagnostic = (async () => {
    for await (const event of sdk.watch({ sessionId, afterSeq: 0 })) {
      if (event.kind === "synced") synced.resolve();
      if (event.kind === "diagnostic" && event.message === "source preparation failed")
        return event;
    }
    throw new Error("diagnostic missing");
  })();
  await within(synced.promise);
  await sdk.messages.send({ sessionId, content: "continue" });
  await sdk.advance({ sessionId });
  assert.deepEqual(await sdk.advance({ sessionId }), { kind: "finished" });
  assert.equal(prompt, "last good");
  assert.equal((await within(diagnostic)).owner, "plugins");
});

test("global publication rejection keeps session boundaries independent and advances the prepared default", async () => {
  const original = inlinePlugin(
    definePlugin({
      id: "source",
      session(api) {
        api.prompt.add((draft) => draft.set("prompt", { text: "old" }));
      },
    }),
    { version: "old" },
  );
  const sdk = await open(
    scripted(() => assistant("unused")),
    { plugins: [original] },
  );
  const first = (await sdk.sessions.create()).sessionId;
  const second = (await sdk.sessions.create()).sessionId;
  for (const sessionId of [first, second]) await sdk.plugins.list({ sessionId });
  let invalid = false;
  const replacement = inlinePlugin(
    definePlugin({
      id: "source",
      async session(api) {
        const { id } = await api.session.info();
        if (id === second) invalid = true;
        api.prompt.add((draft) => {
          if (id === first && invalid) throw new Error("first cannot publish");
          draft.set("prompt", { text: "new" });
        });
      },
    }),
    { version: "new" },
  );
  assert.equal((await sdk.setPlugins([replacement])).kind, "rejected");
  assert.equal((await sdk.plugins.list({ sessionId: first }))[0]?.version, "old");
  assert.equal((await sdk.plugins.list({ sessionId: second }))[0]?.version, "new");
  assert.equal((await sdk.plugins.catalog()).plugins[0]?.version, "new");
});

test("SDK close aborts plugin lifetime signals before draining a direct tool step", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const sdk = await open(
    scripted(() => assistant("", { calls: [call("close-1", "close")] })),
    {
      plugins: [
        inlinePlugin(
          definePlugin({
            id: "close",
            session(api) {
              api.signal.addEventListener("abort", () => finish.resolve(), { once: true });
              api.tools.add((draft) =>
                draft.set("close", {
                  name: "close",
                  description: "Wait until close",
                  parameters: Type.Object({}),
                  execute: async () => {
                    started.resolve();
                    await finish.promise;
                    assert.equal(api.signal.aborted, true);
                    return { content: [{ type: "text", text: "stopped" }], details: {} };
                  },
                }),
              );
            },
          }),
        ),
      ],
    },
  );
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "close" });
  await sdk.advance({ sessionId });
  await sdk.advance({ sessionId });
  const tools = sdk.advance({ sessionId });
  try {
    await within(started.promise);
    await within(sdk.close());
    await tools;
  } finally {
    finish.resolve();
    await sdk.close();
  }
});
