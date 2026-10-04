import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { Type } from "typebox";
import { executeToolCalls } from "../src/kernel/loop/agent-loop.ts";
import { activate, type Activation } from "../src/kernel/sdk/activation.ts";
import { definePlugin, type ExecutionEnv, type Plugin } from "../src/plugins/index.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";
import { ContributionRegistry, ToolMapDraft } from "../src/plugins/registry.ts";
import type { AgentEvent, AgentLoopConfig, AgentTool, ToolCall } from "../src/kernel/loop/types.ts";
import { bindEnv } from "./builtin-tools.ts";
import { assistant, call, localEnv, toolCall, within } from "./kernel/helpers.ts";

const env = localEnv("/tmp");

/** `plugins` activated in `env`, as a session runs them. */
async function activated(plugins: readonly Plugin[], env: ExecutionEnv) {
  const outcome = await activate({
    target: { kind: "new-session" },
    plugins,
    env,
  });

  assert.ok(outcome.kind === "active");

  return outcome.activation;
}

const writePlugin = definePlugin({
  id: "tools",
  session(api) {
    api.tools.add((draft) => draft.set("write", { ...createWriteToolDefinition(), name: "write" }));
  },
});

async function writeNote(activation: Activation, content: string) {
  const write = activation.tools().find((tool) => tool.name === "write");
  assert.ok(write);
  await write.execute({ path: "note.txt", content }, toolCall("call"));
}

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
  const registry = new ContributionRegistry<AgentTool, ToolMapDraft>(() => new ToolMapDraft());
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
      { messages: [], tools: registry.values().map((tool) => bindEnv(tool, env)) },
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
      { messages: [], tools: [bindEnv(tool, env)] },
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
    { messages: [], tools: [bindEnv(tool, env)] },
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
          bindEnv(
            bindTool({
              name: "work",
              description: "Work",
              parameters: Type.Object({}),
              execute: async () => ({ content: [], details: "original" }),
            }),
            env,
          ),
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

test("environment wraps compose over a tool's file operations but cannot change the environment's id or cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-env-wrap-"));
  const base = localEnv(directory);
  const seen: { id: string; cwd: string }[] = [];

  try {
    const activation = await activated(
      [
        writePlugin,
        definePlugin({
          id: "witness",
          session(api) {
            api.tools.add((draft) =>
              draft.wrap("write", (execute) => async (input, call) => {
                seen.push({ id: call.env.id, cwd: call.env.cwd });

                return execute(input, call);
              }),
            );
          },
        }),
        definePlugin({
          id: "loud",
          session(api) {
            // @ts-expect-error Forges identity on purpose, to prove the kernel re-attaches the provider's.
            api.wrapEnv((inner) => {
              const forged = {
                ...inner,
                id: "forged",
                cwd: "/forged",
                writeFile: (path: string, content: string) =>
                  inner.writeFile(path, content.toUpperCase()),
              };

              return forged;
            });
          },
        }),
        definePlugin({
          id: "tail",
          session(api) {
            api.wrapEnv((inner) => ({
              ...inner,
              writeFile: (path, content) => inner.writeFile(path, `${content}tail\n`),
            }));
          },
        }),
      ],
      base,
    );

    try {
      await writeNote(activation, "quiet\n");
      assert.equal(await readFile(join(directory, "note.txt"), "utf8"), "QUIET\nTAIL\n");
      assert.deepEqual(seen, [{ id: base.id, cwd: directory }]);
      assert.throws(() => {
        // @ts-expect-error The environment's identity is read-only.
        activation.env.id = "forged";
      }, TypeError);
    } finally {
      await activation.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a wrap that mutates its inner operations reaches no other activation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-env-wrap-"));
  const base = localEnv(directory);
  const note = join(directory, "note.txt");

  try {
    const muted = await activated(
      [
        writePlugin,
        definePlugin({
          id: "mute",
          session(api) {
            api.wrapEnv((inner) => {
              inner.writeFile = async () => undefined;

              return inner;
            });
          },
        }),
      ],
      base,
    );

    const plain = await activated([writePlugin], base);

    try {
      await writeNote(muted, "muted\n");
      await assert.rejects(readFile(note, "utf8"), { code: "ENOENT" });
      await writeNote(plain, "plain\n");
      assert.equal(await readFile(note, "utf8"), "plain\n");
    } finally {
      await muted.close();
      await plain.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
