import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import { executeToolCalls } from "../src/kernel/loop/agent-loop.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import { createLocalExecutionEnv } from "../src/tools/env.ts";
import { ContributionRegistry, ToolMapDraft } from "../src/plugins/registry.ts";
import type { AgentEvent, AgentLoopConfig, AgentTool, ToolCall } from "../src/kernel/loop/types.ts";
import { assistant, call, toolCall, within } from "./kernel/helpers.ts";

const config: AgentLoopConfig = {
  model: {
    id: "test",
    name: "test",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  },
};

test("the bound executor rejects invalid runtime input before work starts", async () => {
  let executions = 0;
  const tool = bindTool({
    name: "count",
    description: "Count",
    parameters: Type.Object({ count: Type.Number() }),
    execute: async (input) => {
      executions += 1;
      return { content: [], details: input.count };
    },
  });
  await assert.rejects(
    async () => tool.execute({ text: "wrong schema" }, toolCall("invalid")),
    /Validation failed/,
  );
  assert.equal(executions, 0);
  assert.equal((await tool.execute({ count: "3" }, toolCall("valid"))).details, 3);
  assert.equal(executions, 1);
});

test("heterogeneous registry tools keep their schema after wrapping and rebuilding", async () => {
  const env = createLocalExecutionEnv({ cwd: "/tmp" });
  const registry = new ContributionRegistry<AgentTool, ToolMapDraft>(() => new ToolMapDraft(env));
  registry.add("tools", 0, (draft) => {
    draft.set("count", {
      name: "count",
      description: "Double a count",
      parameters: Type.Object({ count: Type.Number(), optional: Type.Optional(Type.String()) }),
      execute: async (input) => ({ content: [], details: input.count * 2 }),
    });
    draft.set("text", {
      name: "text",
      description: "Uppercase text",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      } as const,
      execute: async (input) => ({ content: [], details: input.text.toUpperCase() }),
    });
  });
  registry.add("wrapper", 1, (draft) => {
    draft.wrap(
      "count",
      (execute) =>
        async (...args) =>
          execute(...args),
    );
  });
  for (let rebuild = 0; rebuild < 2; rebuild += 1) {
    assert.deepEqual(registry.rebuild().errors, []);
    const messages = await executeToolCalls(
      { messages: [], tools: registry.values() },
      assistant("", {
        calls: [
          call("a", "count", { count: "21", optional: null }),
          call("b", "text", { text: true }),
        ],
      }),
      config,
      undefined,
      () => undefined,
    );
    assert.deepEqual(
      messages.map(({ message }) => message.details),
      [42, "TRUE"],
    );
    assert.ok(messages.every(({ message }) => !message.isError));
  }
});

test("compatibility runs before validation and hook replacements are revalidated", async () => {
  const seen: number[] = [];
  const tool = bindTool({
    name: "count",
    description: "Count",
    parameters: Type.Object({ count: Type.Number() }),
    prepareArguments: (args) => ({ count: args.legacy }),
    execute: async (input) => {
      seen.push(input.count);
      return { content: [], details: input.count };
    },
  });
  for (const scenario of [
    { replacement: { count: "3" }, isError: false },
    { replacement: { count: {} }, isError: true },
  ]) {
    const result = await executeToolCalls(
      { messages: [], tools: [tool] },
      assistant("", { calls: [call("a", "count", { legacy: "2" })] }),
      {
        ...config,
        beforeToolCall: async ({ args }) => {
          assert.deepEqual(args, { count: 2 });
          return { args: scenario.replacement };
        },
      },
      undefined,
      () => undefined,
    );
    assert.equal(result[0]?.message.isError, scenario.isError);
  }
  assert.deepEqual(seen, [3]);
});

test("concurrent results retain source order and identity; failed tools retain progress and ignore late updates", async () => {
  const release = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const original = { content: [], details: false };
  let update: ToolCall<boolean>["update"] | undefined;
  const tool = bindTool({
    name: "work",
    description: "Concurrent work",
    parameters: Type.Object({ fail: Type.Boolean() }),
    execute: async (input, call) => {
      if (!input.fail) {
        await release.promise;
        return original;
      }
      update = call.update;
      call.update({ content: [{ type: "text", text: "partial" }], details: 0 });
      secondStarted.resolve();
      throw new Error("stopped");
    },
  });
  const events: AgentEvent[] = [];
  const batch = executeToolCalls(
    { messages: [], tools: [tool] },
    assistant("", {
      calls: [call("first", "work", { fail: false }), call("second", "work", { fail: true })],
    }),
    config,
    undefined,
    (event) => {
      events.push(event);
    },
  );
  try {
    await within(secondStarted.promise);
  } finally {
    release.resolve();
  }
  const messages = await within(batch);
  assert.deepEqual(
    messages.map(({ message }) => message.toolCallId),
    ["first", "second"],
  );
  assert.deepEqual(messages[1]?.message.content, [
    { type: "text", text: "stopped" },
    { type: "text", text: "partial" },
  ]);
  assert.equal(messages[1]?.message.details, 0);
  const end = events.find(
    (event) => event.type === "tool_execution_end" && event.toolCallId === "first",
  );
  assert.ok(end?.type === "tool_execution_end");
  assert.equal(end.result, original);
  const settledCount = events.length;
  update?.({ content: [], details: true });
  assert.equal(events.length, settledCount);
});

test("after hooks retain every falsy details override", async () => {
  for (const details of [null, false, 0, ""]) {
    const messages = await executeToolCalls(
      {
        messages: [],
        tools: [
          bindTool({
            name: "work",
            description: "Work",
            parameters: Type.Object({}),
            execute: async () => ({ content: [], details: "original" }),
          }),
        ],
      },
      assistant("", { calls: [call("a", "work")] }),
      { ...config, afterToolCall: async () => ({ details }) },
      undefined,
      () => undefined,
    );
    assert.equal(messages[0]?.message.details, details);
  }
});
