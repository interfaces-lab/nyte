import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { getCurrentTools } from "@nyte-ai/schema";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin, type AgentTool } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, within, usage } from "./helpers.ts";

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
    offered.push(getCurrentTools(context.messages).map((item) => item.name));
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

test("replacement from an executing tool returns without waiting for itself and reaches the next response", async () => {
  const offered: string[][] = [];
  let nyte: Nyte | undefined;
  const make = tool("make", async () => {
    if (nyte === undefined) throw new Error("no host");
    assert.deepEqual(
      await nyte.setPlugins([toolsPlugin([make, tool("made", async () => undefined)])]),
      { kind: "queued" },
    );
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
    assert.deepEqual(await within(nyte.runs.wait({ sessionId }), 1000), { kind: "idle" });
    assert.deepEqual(
      offered.map((names) => names.filter((name) => name === "make" || name === "made")),
      [["make"], ["make", "made"]],
    );
  } finally {
    await nyte.close();
  }
});
