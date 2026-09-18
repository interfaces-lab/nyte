/**
 * Delegation end to end: the parent selects an exact model through `task`, the
 * call parks, the host runs the child in its own session, and the
 * child's terminal state wakes the parent. The provider is a script; the
 * store, the runner, and both sessions are real. Design: design.mdx, "Agents".
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Context } from "@nyte-ai/schema";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import type { HeadName, ModelCatalog, Nyte, SessionId } from "../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin, type LoadedPlugin } from "../src/plugins/index.ts";
import type { AgentTool, StreamFn } from "../src/kernel/loop/types.ts";
import { Type } from "typebox";
import { assistant, call, openStore, sleep, within } from "./kernel/helpers.ts";

const model: Model<Api> = {
  id: "script-model",
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

const CHILD_PROMPT = "Count the files.";
const TASK_TITLE = "Count workspace files";

/**
 * One script for both sessions. A user message `delegate <provider/model>` makes the
 * parent call `task`; the child answers its prompt; a session that has seen a
 * tool result repeats it. Every request records the tool names it was offered
 * and the system prompt it saw, keyed by the tail user message, so a test
 * reads what each session could do.
 */
function script(
  options: {
    readonly childGate?: () => Promise<void>;
    readonly taskArguments?: Parameters<typeof call>[2];
    readonly onRequest?: (context: Context) => void;
  } = {},
) {
  const offered = new Map<string, readonly string[]>();
  const prompts = new Map<string, string>();
  const selected = new Map<string, Model<Api>>();
  const reasoning = new Map<string, string | undefined>();
  const streamFn: StreamFn = (selectedModel, context, streamOptions) => {
    options.onRequest?.(context);
    const messages = context.messages.slice(
      context.messages.findLastIndex((item) => item.role === "user"),
    );
    const tail = messages[0];
    const text = tail?.role === "user" && !Array.isArray(tail.content) ? tail.content : "";
    offered.set(
      text,
      (context.tools ?? []).map((tool) => tool.name),
    );
    prompts.set(text, context.systemPrompt ?? "");
    selected.set(text, selectedModel);
    reasoning.set(text, streamOptions?.reasoning);
    const result = messages.findLast((item) => item.role === "toolResult");
    let answer: AssistantMessage;
    if (result !== undefined && result.role === "toolResult") {
      const said = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      answer = assistant(`${result.isError ? "error" : "got"}: ${said}`);
    } else if (text.startsWith("delegate ")) {
      const args = options.taskArguments ?? {
        model: text.slice("delegate ".length),
        title: TASK_TITLE,
        prompt: CHILD_PROMPT,
      };
      answer = assistant("", { calls: [call("task-1", "task", args)] });
    } else {
      answer = assistant(`three files (${text})`);
    }
    const stream = createAssistantMessageEventStream();
    const aborted = new Promise<"aborted">((resolve) => {
      const signal = streamOptions?.signal;
      if (signal === undefined) return;
      if (signal.aborted) resolve("aborted");
      else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    void (async () => {
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      const gate = text === CHILD_PROMPT ? options.childGate?.() : undefined;
      const outcome = await Promise.race([gate ?? Promise.resolve(), aborted]);
      if (outcome === "aborted") {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...answer, stopReason: "aborted", content: [] },
        });
        return;
      }
      stream.push({
        type: "done",
        reason: answer.stopReason === "toolUse" ? "toolUse" : "stop",
        message: answer,
      });
    })();
    return stream;
  };
  return { streamFn, offered, prompts, selected, reasoning };
}

const noopParameters = Type.Object({});
function noopTool(name: string): AgentTool<typeof noopParameters> {
  return {
    name,
    description: name,
    parameters: noopParameters,
    execute: async () => ({ content: [{ type: "text", text: "" }], details: {} }),
  };
}

function plugins(extra: readonly LoadedPlugin[] = []): LoadedPlugin[] {
  return [
    inlinePlugin(
      definePlugin({
        id: "tools",
        session(api) {
          api.tools.add((draft) => {
            for (const name of ["read", "ls", "bash", "edit"]) draft.set(name, noopTool(name));
          });
          api.prompt.add((draft) => draft.set("p", { text: "You are a test." }));
        },
      }),
    ),
    ...extra,
  ];
}

async function open(
  streamFn: StreamFn,
  extra: {
    readonly plugins?: readonly LoadedPlugin[];
    readonly catalog?: readonly Model<Api>[];
    readonly getAvailable?: ModelCatalog["getAvailable"];
  } = {},
): Promise<Nyte> {
  const catalog = extra.catalog ?? [model];
  return createNyte({
    store: openStore(),
    streamFn,
    models: {
      getModels: () => catalog,
      getModel: (provider, id) =>
        catalog.find((candidate) => candidate.provider === provider && candidate.id === id),
      getAvailable: extra.getAvailable ?? (async () => catalog),
    },
    model,
    plugins: plugins(extra.plugins),
    env: { cwd: "/tmp/nowhere" },
  });
}

async function transcript(nyte: Nyte, id: SessionId): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId: id });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.map((part) =>
          part.kind === "user"
            ? `user:${Array.isArray(part.content) ? "…" : part.content}`
            : part.kind === "assistant"
              ? `assistant:${part.text}`
              : part.kind,
        )
      : [turn.kind],
  );
}

/**
 * `runs.wait` answers `waiting` for a parked run; a parent parked on a child
 * is woken by the child later, so a test that wants the end keeps waiting.
 */
async function untilIdle(nyte: Nyte, id: SessionId, head?: HeadName): Promise<void> {
  await within(
    (async () => {
      for (;;) {
        const outcome = await nyte.runs.wait({ sessionId: id, head });
        if (outcome.kind === "idle") return;
        await sleep(10);
      }
    })(),
    10_000,
  );
}

async function onlyChild(nyte: Nyte, parent: SessionId) {
  const children = await nyte.sessions.list({ parent });
  assert.equal(children.items.length, 1, "one child session");
  const child = children.items[0];
  assert.ok(child !== undefined);
  return child;
}

test("a foreground parent waits for the child and receives its answer", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { streamFn, offered } = script({ childGate: () => gate });
  const nyte = await open(streamFn);
  try {
    const { sessionId: parent } = await nyte.sessions.create();
    nyte.attach();
    await nyte.setPlugins(plugins());
    await nyte.messages.send({ sessionId: parent, content: "delegate openai/script-model" });
    assert.equal((await within(nyte.runs.wait({ sessionId: parent }), 10_000)).kind, "waiting");

    const child = await onlyChild(nyte, parent);
    release?.();
    await untilIdle(nyte, parent);

    assert.deepEqual(await transcript(nyte, parent), [
      "user:delegate openai/script-model",
      "tool",
      `assistant:got: three files (${CHILD_PROMPT})`,
    ]);
    assert.equal(child.parent?.sessionId, parent);
    assert.equal(child.parent?.callId, "task-1");
    assert.equal(child.parent?.depth, 1);
    assert.equal(child.config.agent, undefined);
    assert.deepEqual(
      (await nyte.jobs.list({ sessionId: parent })).map((job) => job.title),
      [TASK_TITLE],
    );
    assert.deepEqual(await transcript(nyte, child.sessionId), [
      "config",
      `user:${CHILD_PROMPT}`,
      `assistant:three files (${CHILD_PROMPT})`,
    ]);

    assert.ok(offered.get("delegate openai/script-model")?.includes("task"));
    assert.deepEqual(offered.get(CHILD_PROMPT), ["read", "ls", "bash", "edit"]);
    assert.deepEqual(
      (await nyte.sessions.list({ parent: null })).items.map((item) => item.sessionId),
      [parent],
    );
  } finally {
    release?.();
    await nyte.close();
  }
});

const opus: Model<Api> = {
  ...model,
  provider: "anthropic",
  api: "anthropic-messages",
  id: "claude-opus-5",
  name: "Claude Opus 5",
  reasoning: true,
};
const astra: Model<Api> = { ...model, id: "gpt-astra", name: "GPT Astra", reasoning: true };
const defaultTaskModel: Model<Api> = {
  ...model,
  provider: "openai-codex",
  id: "gpt-5.6-sol",
  name: "GPT 5.6 Sol",
  reasoning: true,
};
// Same id under another provider catches dispatch that matches only the model id.
const decoy: Model<Api> = { ...astra, provider: "other" };

test("task defaults to Codex GPT 5.6 Sol with high thinking", async () => {
  const scripted = script({ taskArguments: { prompt: CHILD_PROMPT } });
  const nyte = await open(scripted.streamFn, { catalog: [model, defaultTaskModel] });
  try {
    const parent = await nyte.sessions.create();
    await nyte.sessions.configure({ sessionId: parent.sessionId, thinkingLevel: "low" });
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate default" });
    await untilIdle(nyte, parent.sessionId);

    const child = await onlyChild(nyte, parent.sessionId);
    assert.deepEqual(scripted.selected.get(CHILD_PROMPT), defaultTaskModel);
    assert.deepEqual(child.config.model, {
      provider: "openai-codex",
      id: "gpt-5.6-sol",
    });
    assert.equal(child.config.thinkingLevel, "high");
    assert.equal(scripted.reasoning.get(CHILD_PROMPT), "high");
    assert.deepEqual(
      (await nyte.jobs.list({ sessionId: parent.sessionId })).map((job) => job.title),
      ["openai-codex/gpt-5.6-sol"],
    );
  } finally {
    await nyte.close();
  }
});

for (const selected of [opus, astra]) {
  test(`task dispatches and persists exactly ${selected.provider}/${selected.id}`, async () => {
    const scripted = script();
    const nyte = await open(scripted.streamFn, { catalog: [decoy, model, astra, opus] });
    try {
      const parent = await nyte.sessions.create();
      await nyte.heads.create({
        sessionId: parent.sessionId,
        head: "research",
        from: { head: "main" },
      });
      await nyte.sessions.configure({
        sessionId: parent.sessionId,
        head: "research",
        thinkingLevel: "high",
      });
      nyte.attach();
      const key = `${selected.provider}/${selected.id}`;
      await nyte.messages.send({
        sessionId: parent.sessionId,
        head: "research",
        content: `delegate ${key}`,
      });
      await untilIdle(nyte, parent.sessionId, "research");
      assert.deepEqual(scripted.selected.get(CHILD_PROMPT), selected);
      const child = await onlyChild(nyte, parent.sessionId);
      assert.deepEqual(child.config.model, { provider: selected.provider, id: selected.id });
      assert.equal(child.config.thinkingLevel, "high");
      const run = await nyte.runs.current({ sessionId: child.sessionId });
      assert.deepEqual(run?.config.model, child.config.model);
      assert.equal(run?.config.thinkingLevel, "high");
      assert.equal(scripted.reasoning.get(CHILD_PROMPT), "high");
      assert.equal(child.config.agent, undefined);
      assert.ok(child.parent && !("agent" in child.parent));
      assert.deepEqual(scripted.offered.get(CHILD_PROMPT), ["read", "ls", "bash", "edit"]);
      assert.equal(scripted.prompts.get(CHILD_PROMPT), "You are a test.");
      const parts = (
        await nyte.messages.list({ sessionId: parent.sessionId, head: "research" })
      ).flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
      const tool = parts.find((part) => part.kind === "tool");
      assert.ok(tool?.kind === "tool");
      assert.deepEqual(tool.result?.details, {
        model: key,
        childSessionId: child.sessionId,
        state: "completed",
      });
    } finally {
      await nyte.close();
    }
  });
}

test("no available models omits task rather than sending an empty model enum", async () => {
  const scripted = script();
  const nyte = await open(scripted.streamFn, { getAvailable: async () => [] });
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "show available models" });
    await untilIdle(nyte, parent.sessionId);
    const tools = scripted.offered.get("show available models");
    assert.ok(tools !== undefined);
    assert.ok(!tools.includes("task"));
    assert.equal((await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind, "done");
  } finally {
    await nyte.close();
  }
});

test("every parent request advertises all currently available cross-provider models", async () => {
  let available = [model, opus];
  const menus: unknown[] = [];
  const scripted = script({
    onRequest(context) {
      const task = context.tools?.find((tool) => tool.name === "task");
      if (task) menus.push(task.parameters);
    },
  });
  const nyte = await open(scripted.streamFn, {
    catalog: [decoy, model, opus, astra],
    getAvailable: async (provider) =>
      provider === undefined ? available : available.filter((item) => item.provider === provider),
  });
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    for (const models of [
      [model, opus],
      [astra, opus],
    ]) {
      available = models;
      await nyte.messages.send({ sessionId: parent.sessionId, content: "show available models" });
      await untilIdle(nyte, parent.sessionId);
    }
    assert.equal(menus.length, 2);
    for (const [index, expected] of [
      [0, ["openai/script-model", "anthropic/claude-opus-5"]],
      [1, ["openai/gpt-astra", "anthropic/claude-opus-5"]],
    ] as const) {
      const schema = menus[index];
      assert.ok(typeof schema === "object" && schema !== null && "properties" in schema);
      const properties = schema.properties;
      assert.ok(typeof properties === "object" && properties !== null && "model" in properties);
      const selection = properties.model;
      assert.ok(typeof selection === "object" && selection !== null && "enum" in selection);
      assert.deepEqual(selection.enum, expected);
      assert.ok(!("agent" in properties));
      assert.ok("required" in schema && Array.isArray(schema.required));
      assert.deepEqual(new Set(schema.required), new Set(["prompt"]));
      assert.ok("additionalProperties" in schema && schema.additionalProperties === false);
    }
  } finally {
    await nyte.close();
  }
});

for (const args of [
  { model: "openai/script-model", prompt: CHILD_PROMPT, thinkingLevel: "invalid" },
  { model: "openai/script-model", prompt: CHILD_PROMPT, thinkingLevel: 42 },
  { model: "gpt-astra", prompt: CHILD_PROMPT },
  { model: "/gpt-astra", prompt: CHILD_PROMPT },
  { model: "openai/", prompt: CHILD_PROMPT },
  { model: 42, prompt: CHILD_PROMPT },
  { model: "openai/script-model", prompt: CHILD_PROMPT, agent: "general" },
  { agent: "explore", prompt: CHILD_PROMPT },
  { model: "openai/script-model" },
  { model: "openai/script-model", prompt: "" },
]) {
  test(`invalid task arguments create no child: ${JSON.stringify(args)}`, async () => {
    const scripted = script({ taskArguments: args });
    const nyte = await open(scripted.streamFn);
    try {
      const parent = await nyte.sessions.create();
      nyte.attach();
      await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate invalid" });
      await untilIdle(nyte, parent.sessionId);
      assert.equal((await nyte.sessions.list({ parent: parent.sessionId })).items.length, 0);
      assert.ok(
        (await transcript(nyte, parent.sessionId)).some((line) =>
          line.includes("Task arguments are invalid"),
        ),
      );
      assert.equal(scripted.selected.has(CHILD_PROMPT), false);
    } finally {
      await nyte.close();
    }
  });
}

test("an unavailable default fails without using another available model", async () => {
  const scripted = script({ taskArguments: { prompt: CHILD_PROMPT } });
  const nyte = await open(scripted.streamFn, { catalog: [model] });
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate default" });
    await untilIdle(nyte, parent.sessionId);

    assert.equal((await nyte.sessions.list({ parent: parent.sessionId })).items.length, 0);
    assert.equal(scripted.selected.has(CHILD_PROMPT), false);
    assert.ok(
      (await transcript(nyte, parent.sessionId)).some((line) =>
        line.includes(
          "Subagent model is unavailable: openai-codex/gpt-5.6-sol. Choose an available model or connect its provider.",
        ),
      ),
    );
  } finally {
    await nyte.close();
  }
});

for (const selected of ["openai/gpt-astra", "anthropic/claude-opus-5", "unknown/script-model"]) {
  test(`unavailable selection ${selected} fails without a child or fallback`, async () => {
    const scripted = script();
    const nyte = await open(scripted.streamFn, {
      catalog: [model, astra, opus, decoy],
      getAvailable: async () => [model, decoy],
    });
    try {
      const parent = await nyte.sessions.create();
      nyte.attach();
      await nyte.messages.send({ sessionId: parent.sessionId, content: `delegate ${selected}` });
      await untilIdle(nyte, parent.sessionId);
      assert.equal((await nyte.sessions.list({ parent: parent.sessionId })).items.length, 0);
      assert.equal(scripted.selected.has(CHILD_PROMPT), false);
      assert.ok(
        (await transcript(nyte, parent.sessionId)).some((line) =>
          line.includes(`Subagent model is unavailable: ${selected}`),
        ),
      );
    } finally {
      await nyte.close();
    }
  });
}

test("reused tool call ids dispatch the current explicit choice rather than an earlier child model", async () => {
  const scripted = script();
  const nyte = await open(scripted.streamFn, { catalog: [model, astra, opus] });
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    for (const selected of [opus, astra]) {
      await nyte.messages.send({
        sessionId: parent.sessionId,
        content: `delegate ${selected.provider}/${selected.id}`,
      });
      await untilIdle(nyte, parent.sessionId);
      assert.deepEqual(scripted.selected.get(CHILD_PROMPT), selected);
    }
    const children = (await nyte.sessions.list({ parent: parent.sessionId })).items;
    assert.equal(children.length, 2);
    assert.deepEqual(
      new Set(children.map((child) => `${child.config.model?.provider}/${child.config.model?.id}`)),
      new Set(["anthropic/claude-opus-5", "openai/gpt-astra"]),
    );
  } finally {
    await nyte.close();
  }
});

test("a model removed from the catalog during child setup fails instead of using the parent model", async () => {
  const catalog = [model, opus];
  const scripted = script();
  const nyte = await open(scripted.streamFn, {
    catalog,
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "remove-child-model",
          async session(api) {
            if ((await api.session.info()).child) catalog.splice(catalog.indexOf(opus), 1);
          },
        }),
      ),
    ],
  });
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({
      sessionId: parent.sessionId,
      content: "delegate anthropic/claude-opus-5",
    });
    await untilIdle(nyte, parent.sessionId);
    const child = await onlyChild(nyte, parent.sessionId);
    assert.deepEqual(child.config.model, { provider: opus.provider, id: opus.id });
    const run = await nyte.runs.current({ sessionId: child.sessionId });
    assert.equal(run?.phase.kind, "failed");
    assert.equal(scripted.selected.has(CHILD_PROMPT), false);
    assert.ok(
      (await transcript(nyte, parent.sessionId)).some((line) =>
        line.includes("Subagent model is unavailable: anthropic/claude-opus-5"),
      ),
    );
  } finally {
    await nyte.close();
  }
});

test("a child without an explicit model fails execution rather than inheriting the host default", async () => {
  const scripted = script();
  const nyte = await open(scripted.streamFn);
  try {
    const parent = await nyte.sessions.create();
    const child = await nyte.sessions.create({
      parent: { sessionId: parent.sessionId, runId: "missing-model", callId: "task", depth: 1 },
    });
    nyte.attach();
    await nyte.messages.send({ sessionId: child.sessionId, content: CHILD_PROMPT });
    await untilIdle(nyte, child.sessionId);
    const run = await nyte.runs.current({ sessionId: child.sessionId });
    assert.ok(run?.phase.kind === "failed");
    assert.match(run.phase.failure.message, /requires an exact model/i);
    assert.equal(scripted.selected.has(CHILD_PROMPT), false);
  } finally {
    await nyte.close();
  }
});

for (const thinkingLevel of ["low", "off", "max"] as const) {
  test(`task thinking level ${thinkingLevel} overrides the parent without changing it`, async () => {
    const scripted = script({
      taskArguments: { model: "openai/gpt-astra", prompt: CHILD_PROMPT, thinkingLevel },
    });
    const nyte = await open(scripted.streamFn, { catalog: [model, astra] });
    try {
      const parent = await nyte.sessions.create();
      await nyte.sessions.configure({ sessionId: parent.sessionId, thinkingLevel: "high" });
      nyte.attach();
      await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate override" });
      await untilIdle(nyte, parent.sessionId);
      const child = await onlyChild(nyte, parent.sessionId);
      assert.equal(child.config.thinkingLevel, thinkingLevel);
      assert.equal(
        scripted.reasoning.get(CHILD_PROMPT),
        thinkingLevel === "off" ? undefined : thinkingLevel,
      );
      assert.equal(
        (await nyte.runs.current({ sessionId: parent.sessionId }))?.config.thinkingLevel,
        "high",
      );
    } finally {
      await nyte.close();
    }
  });
}
