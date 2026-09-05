import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { headRef } from "../../src/kernel/names.ts";
import { SqliteStore } from "../../src/kernel/sqlite.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { assistant, call, openStore, storePath, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "admission-model",
  name: "Admission",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

async function open(
  store: Store = openStore(),
  toolGate?: { readonly started: () => void; readonly release: Promise<void> },
) {
  const requests: { content: string; agent: string }[] = [];
  const runIds: string[] = [];
  const nyte = await createNyte({
    store,
    model,
    models: { getModels: () => [model], getModel: () => model },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "personas",
          session(api) {
            api.agents.add((draft) => {
              draft.set("agent-a", { id: "agent-a", system: "Agent A" });
              draft.set("agent-b", { id: "agent-b", system: "Agent B" });
            });
            api.prompt.add((draft) => draft.set("base", { text: "Host" }));
            api.hook("before_request", (input) => {
              runIds.push(input.runId);
              return undefined;
            });
            if (toolGate !== undefined) {
              api.tools.add((draft) =>
                draft.set("hold", {
                  name: "hold",
                  description: "waits for the test to release it",
                  parameters: Type.Object({}),
                  execute: async () => {
                    toolGate.started();
                    await toolGate.release;
                    return { content: [{ type: "text", text: "finished" }], details: {} };
                  },
                }),
              );
            }
          },
        }),
      ),
    ],
    env: { cwd: "/tmp/nowhere" },
    streamFn: (_model, context) => {
      const latest = context.messages.findLast((message) => message.role === "user");
      assert.ok(latest !== undefined && !Array.isArray(latest.content));
      requests.push({
        content: latest.content,
        agent: context.systemPrompt?.trim().split("\n").at(-1) ?? "",
      });
      const stream = createAssistantMessageEventStream();
      const wantsTool = toolGate !== undefined && requests.length === 1;
      const answer = wantsTool
        ? assistant("", { calls: [call("hold-1", "hold")] })
        : assistant("answered");
      queueMicrotask(() => {
        stream.push({ type: "done", reason: wantsTool ? "toolUse" : "stop", message: answer });
      });
      return stream;
    },
  });
  return { nyte, requests, runIds, store };
}

test("concurrent sends keep each message with its selected agent", async () => {
  const { nyte, requests } = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    await Promise.all([
      nyte.messages.send({ sessionId: id, content: "first", agent: "agent-a", key: "first" }),
      nyte.messages.send({ sessionId: id, content: "second", agent: "agent-b", key: "second" }),
    ]);
    nyte.attach();
    await within(nyte.runs.wait({ sessionId: id }));
    assert.deepEqual(
      requests.toSorted((left, right) => left.content.localeCompare(right.content)),
      [
        { content: "first", agent: "Agent A" },
        { content: "second", agent: "Agent B" },
      ],
    );
  } finally {
    await nyte.close();
  }
});

test("an idempotent send retry cannot change the agent for later messages", async () => {
  const { nyte, requests, store } = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const first = await nyte.messages.send({
      sessionId: id,
      content: "first",
      agent: "agent-a",
      key: "same-request",
    });
    const session = await store.open(id);
    const beforeRetry = await session.events.last();
    const retry = await nyte.messages.send({
      sessionId: id,
      content: "changed retry",
      agent: "agent-b",
      key: "same-request",
    });
    assert.deepEqual(retry, { kind: "duplicate", change: first.change });
    assert.equal(await session.events.last(), beforeRetry);
    await session.close();
    await nyte.messages.send({ sessionId: id, content: "follow-up" });
    nyte.attach();
    await within(nyte.runs.wait({ sessionId: id }));
    assert.deepEqual(requests, [
      { content: "first", agent: "Agent A" },
      { content: "follow-up", agent: "Agent A" },
    ]);
  } finally {
    await nyte.close();
  }
});

test("cancelling a pending message also cancels its agent selection", async () => {
  const { nyte, requests } = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const cancelled = await nyte.messages.send({
      sessionId: id,
      content: "cancel",
      agent: "agent-a",
    });
    assert.deepEqual(await nyte.messages.cancel({ sessionId: id, change: cancelled.change }), {
      kind: "cancelled",
    });
    await nyte.messages.send({ sessionId: id, content: "remaining" });
    nyte.attach();
    await within(nyte.runs.wait({ sessionId: id }));
    assert.deepEqual(requests, [{ content: "remaining", agent: "Host" }]);
    assert.equal((await nyte.sessions.get({ sessionId: id }))?.config.agent, undefined);
  } finally {
    await nyte.close();
  }
});

test("redelivery moves the selected agent with its message to the new lane", async () => {
  const { nyte, requests } = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const moved = await nyte.messages.send({ sessionId: id, content: "moved", agent: "agent-a" });
    await nyte.messages.send({ sessionId: id, content: "first", agent: "agent-b" });
    const redelivered = await nyte.messages.redeliver({
      sessionId: id,
      change: moved.change,
      lane: "queue",
    });
    assert.equal(redelivered.kind, "redelivered");
    nyte.attach();
    await within(nyte.runs.wait({ sessionId: id }));
    assert.deepEqual(requests, [
      { content: "first", agent: "Agent B" },
      { content: "moved", agent: "Agent A" },
    ]);
    assert.equal((await nyte.sessions.get({ sessionId: id }))?.config.agent, "agent-a");
  } finally {
    await nyte.close();
  }
});

test.each(["agent-a", "agent-b"])(
  "a steer message selecting %s during tools uses that agent at the next response boundary",
  async (agent) => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { nyte, requests, runIds } = await open(openStore(), {
      started: started.resolve,
      release: release.promise,
    });
    try {
      const { sessionId: id } = await nyte.sessions.create();
      await nyte.messages.send({ sessionId: id, content: "first", agent: "agent-a" });
      nyte.attach();
      await within(started.promise);
      // A configuration change ahead of the message shares its landing batch.
      await nyte.sessions.configure({ sessionId: id, thinkingLevel: "high" });
      const sent = await nyte.messages.send({ sessionId: id, content: "steering", agent });
      assert.ok(
        (await nyte.messages.pending({ sessionId: id })).some(
          (item) => item.change === sent.change,
        ),
      );
      release.resolve();
      await within(nyte.runs.wait({ sessionId: id }));
      assert.deepEqual(requests, [
        { content: "first", agent: "Agent A" },
        { content: "steering", agent: agent === "agent-a" ? "Agent A" : "Agent B" },
      ]);
      assert.equal(runIds.length, 2);
      assert.equal(runIds[0] === runIds[1], agent === "agent-a");
      assert.deepEqual(await nyte.messages.pending({ sessionId: id }), []);
      const turns = await nyte.messages.list({ sessionId: id });
      assert.equal(
        turns
          .flatMap((turn) => (turn.kind === "turn" ? turn.parts : []))
          .filter((part) => part.kind === "user" && part.content === "steering").length,
        1,
      );
    } finally {
      release.resolve();
      await nyte.close();
    }
  },
);

class ObservedStore extends SqliteStore {
  readonly opened: Session[] = [];

  override async open(id: string): Promise<Session> {
    const session = await super.open(id);
    this.opened.push(session);
    return session;
  }
}

test("concurrent session opens keep one live handle and close every handle at shutdown", async () => {
  const store = new ObservedStore(storePath());
  const seed = await store.create({ id: "cold" });
  await seed.close();
  const { nyte } = await open(store);
  try {
    const id = sessionId("cold");
    const sessions = await Promise.all([
      nyte.sessions.get({ sessionId: id }),
      nyte.sessions.get({ sessionId: id }),
    ]);
    assert.ok(sessions.every((session) => session?.sessionId === id));
    const beforeClose = await Promise.allSettled(
      store.opened.map((session) => session.refs.read(headRef("main"))),
    );
    assert.equal(beforeClose.filter((result) => result.status === "fulfilled").length, 1);
    await nyte.close();
    for (const session of store.opened) {
      await assert.rejects(session.refs.read(headRef("main")), /Session is closed/u);
    }
  } finally {
    await nyte.close();
    await store.close();
  }
});
