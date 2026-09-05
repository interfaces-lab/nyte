/**
 * Delegation end to end: the `agents` registry becomes the `task` tool, a
 * parent's call parks, the host runs the child in its own session, and the
 * child's terminal state wakes the parent. The provider is a script; the
 * store, the runner, and both sessions are real. Design: design.mdx, "Agents".
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import type { Nyte, SessionId } from "../src/kernel/sdk/types.ts";
import { EXPLORE_AGENT, GENERAL_AGENT } from "../src/plugins/builtin/agents.ts";
import { buildTaskDescription, invokableAgents } from "../src/plugins/builtin/subagents.ts";
import {
  definePlugin,
  inlinePlugin,
  stockAgentsPlugin,
  type Agent,
  type LoadedPlugin,
} from "../src/plugins/index.ts";
import type { AgentTool, StreamFn } from "../src/types.ts";
import { Type } from "typebox";
import { assistant, call, openStore, sleep, within } from "./kernel/helpers.ts";
import type { Store } from "../src/kernel/store.ts";

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

/**
 * One script for both sessions. A user message `delegate <agent>` makes the
 * parent call `task`; the child answers its prompt; a session that has seen a
 * tool result repeats it. Every request records the tool names it was offered
 * and the system prompt it saw, keyed by the tail user message, so a test
 * reads what each agent could do.
 */
function script(options: { readonly childGate?: () => Promise<void> } = {}) {
  const offered = new Map<string, readonly string[]>();
  const prompts = new Map<string, string>();
  const streamFn: StreamFn = (_model, context, streamOptions) => {
    const tail = context.messages.findLast((item) => item.role === "user");
    const text = tail !== undefined && !Array.isArray(tail.content) ? tail.content : "";
    offered.set(
      text,
      (context.tools ?? []).map((tool) => tool.name),
    );
    prompts.set(text, context.systemPrompt ?? "");
    const result = context.messages.findLast((item) => item.role === "toolResult");
    let answer: AssistantMessage;
    if (result !== undefined && result.role === "toolResult") {
      const said = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      answer = assistant(`${result.isError ? "error" : "got"}: ${said}`);
    } else if (text.startsWith("delegate ")) {
      const agent = text.slice("delegate ".length);
      answer = assistant("", { calls: [call("task-1", "task", { agent, prompt: CHILD_PROMPT })] });
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
  return { streamFn, offered, prompts };
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
    inlinePlugin(stockAgentsPlugin()),
    ...extra,
  ];
}

async function open(
  streamFn: StreamFn,
  extra: { readonly store?: Store; readonly plugins?: readonly LoadedPlugin[] } = {},
): Promise<Nyte> {
  return createNyte({
    store: extra.store ?? openStore(),
    streamFn,
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
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
async function untilIdle(nyte: Nyte, id: SessionId): Promise<void> {
  await within(
    (async () => {
      for (;;) {
        const outcome = await nyte.runs.wait({ sessionId: id });
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

test("the task menu is the invokable agents: not primary, not hidden, not disabled", () => {
  const agents: Agent[] = [
    { id: "build", mode: "primary", description: "talks to the user" },
    { id: "general", mode: "subagent", description: "does things" },
    { id: "secret", hidden: true },
    { id: "off", disabled: true },
    { id: "both" },
  ];
  assert.deepEqual(
    invokableAgents(agents).map((agent) => agent.id),
    ["general", "both"],
  );
  assert.equal(
    buildTaskDescription(invokableAgents(agents)),
    [
      "Delegate a task to a specialized agent that runs in its own session and",
      "returns a final result. Pick the agent whose description best fits the task.",
      "",
      "Available agents:",
      "- general: does things",
      "- both: (no description)",
    ].join("\n"),
  );
});

test("a parent delegates asynchronously and wakes with the child's answer", async () => {
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
    await nyte.messages.send({ sessionId: parent, content: "delegate general" });
    assert.equal((await within(nyte.runs.wait({ sessionId: parent }), 10_000)).kind, "waiting");

    const child = await onlyChild(nyte, parent);
    release?.();
    await untilIdle(nyte, parent);

    assert.deepEqual(await transcript(nyte, parent), [
      "user:delegate general",
      "tool",
      `assistant:got: three files (${CHILD_PROMPT})`,
    ]);
    assert.equal(child.parent?.sessionId, parent);
    assert.equal(child.parent?.callId, "task-1");
    assert.equal(child.parent?.agent, GENERAL_AGENT.id);
    assert.equal(child.parent?.depth, 1);
    assert.equal(child.config.agent, GENERAL_AGENT.id);
    assert.deepEqual(await transcript(nyte, child.sessionId), [
      "config",
      `user:${CHILD_PROMPT}`,
      `assistant:three files (${CHILD_PROMPT})`,
    ]);

    assert.ok(offered.get("delegate general")?.includes("task"));
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

test("explore runs with its declared tools only, and its persona on top of the base prompt", async () => {
  const { streamFn, offered, prompts } = script();
  const nyte = await open(streamFn);
  try {
    const { sessionId: parent } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent, content: "delegate explore" });
    await untilIdle(nyte, parent);
    assert.deepEqual(offered.get(CHILD_PROMPT), ["read", "ls"]);
    const prompt = prompts.get(CHILD_PROMPT) ?? "";
    assert.ok(prompt.startsWith("You are a test."));
    assert.ok(EXPLORE_AGENT.system !== undefined && prompt.endsWith(EXPLORE_AGENT.system));
    const child = await onlyChild(nyte, parent);
    assert.equal(child.config.agent, EXPLORE_AGENT.id);
  } finally {
    await nyte.close();
  }
});
