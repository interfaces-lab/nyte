/**
 * A host that sees plugin sources change holds the runner's next step until
 * its swap lands. Here a tool takes the hold and swaps plugins a little later,
 * the way a file watcher does after the model writes a plugin; the model's
 * very next request must already advertise the tool that swap added.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin, type AgentTool } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, sleep, usage } from "./helpers.ts";

const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

function tool(name: string, execute: () => Promise<void>): AgentTool {
  return {
    name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => {
      await execute();
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
}

function toolsPlugin(tools: readonly AgentTool[]) {
  return inlinePlugin(
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
}

/** Calls `make` on the first request, then answers; records the tool names each request offered. */
function script(offered: string[][]): StreamFn {
  return (_model, context) => {
    offered.push((context.tools ?? []).map((item) => item.name));
    const answer =
      offered.length === 1
        ? assistant("", { calls: [call("make-1", "make", {})] })
        : assistant("done", { usage });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    stream.push({
      type: "done",
      reason: offered.length === 1 ? "toolUse" : "stop",
      message: answer,
    });
    return stream;
  };
}

test("a step that starts under a plugin hold advertises the tools the swap added", async () => {
  const offered: string[][] = [];
  let nyte: Nyte | undefined;
  const make = tool("make", async () => {
    if (nyte === undefined) throw new Error("no host");
    const release = nyte.holdPlugins();
    // The swap lands well after the tool result is committed and the next step could start.
    void sleep(80)
      .then(() => nyte?.setPlugins([toolsPlugin([make, tool("made", async () => undefined)])]))
      .finally(release);
  });
  nyte = await createNyte({
    store: openStore(),
    streamFn: script(offered),
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [toolsPlugin([make])],
    env: { cwd: "/tmp/nowhere" },
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "go" });
    assert.deepEqual(await nyte.runs.wait({ sessionId }), { kind: "idle" });
    assert.equal(offered.length, 2);
    assert.ok(offered[0]?.includes("make"));
    assert.equal(offered[0]?.includes("made"), false);
    assert.ok(offered[1]?.includes("make"));
    assert.ok(offered[1]?.includes("made"));
  } finally {
    await nyte.close();
  }
});

test("closing the host releases every hold so runners never wait on a gone host", async () => {
  const nyte = await createNyte({
    store: openStore(),
    streamFn: script([]),
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [toolsPlugin([])],
    env: { cwd: "/tmp/nowhere" },
  });
  nyte.holdPlugins();
  await nyte.close();
});
