/**
 * A parked run stops consuming a process either way, so `phase` alone cannot
 * tell a question from background work. `sessions.get` is what a session list
 * reads, and a list must be able to flag the one that wants an answer without
 * opening every session to inspect its parked calls.
 */
import assert from "node:assert/strict";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { Selection } from "@nyte-ai/protocol";
import { test } from "vitest";
import { Type } from "typebox";
import { sessionMark } from "@nyte-ai/client";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { ToolWait } from "../../src/types.ts";
import { assistant, call, openStore, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "park-model",
  name: "Park",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const selection: Selection = { title: "Continue?", choices: [{ id: "yes", label: "Yes" }] };

/** Parks on the tool the user's message names: `ask` carries a selection, `sleep` does not. */
async function fixture() {
  const nyte = await createNyte({
    store: openStore(),
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    env: { cwd: "/tmp/nowhere" },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "parking",
          session(api) {
            api.tools.add((draft) => {
              draft.set("ask", {
                name: "ask",
                description: "Ask the user",
                parameters: Type.Object({}),
                execute: async () => {
                  throw new ToolWait({ selection });
                },
                wake: async () => ({
                  kind: "settle",
                  result: { content: [{ type: "text", text: "answered" }], details: {} },
                }),
              });
              draft.set("sleep", {
                name: "sleep",
                description: "Wait on background work",
                parameters: Type.Object({}),
                execute: async () => {
                  throw new ToolWait();
                },
                wake: async () => ({
                  kind: "settle",
                  result: { content: [{ type: "text", text: "woke" }], details: {} },
                }),
              });
            });
          },
        }),
      ),
    ],
    streamFn: (_model, context) => {
      const stream = createAssistantMessageEventStream();
      const tail = context.messages.at(-1);
      const tool = tail?.role === "user" && tail.content === "ask" ? "ask" : "sleep";
      stream.push({
        type: "done",
        reason: "toolUse",
        message: assistant("", { calls: [call("parking", tool)] }),
      });
      return stream;
    },
  });
  return nyte;
}

test("a session parked on a question is marked apart from one parked on background work", async () => {
  const nyte = await fixture();
  nyte.attach();
  try {
    const asking = sessionId((await nyte.sessions.create()).sessionId);
    await nyte.messages.send({ sessionId: asking, content: "ask" });
    assert.equal((await within(nyte.runs.wait({ sessionId: asking }))).kind, "waiting");

    const background = sessionId((await nyte.sessions.create()).sessionId);
    await nyte.messages.send({ sessionId: background, content: "sleep" });
    assert.equal((await within(nyte.runs.wait({ sessionId: background }))).kind, "waiting");

    const asked = await nyte.sessions.get({ sessionId: asking });
    const slept = await nyte.sessions.get({ sessionId: background });
    assert.ok(asked !== undefined && slept !== undefined);

    // Both runs are parked; only one of them is waiting on a person.
    assert.equal(asked.heads[0]?.run?.phase.kind, "waiting");
    assert.equal(slept.heads[0]?.run?.phase.kind, "waiting");
    assert.equal(asked.heads[0]?.run?.awaitingReply, true);
    assert.equal(slept.heads[0]?.run?.awaitingReply, undefined);
    assert.equal(sessionMark(asked), "waiting");
    assert.equal(sessionMark(slept), "working");
  } finally {
    await nyte.close();
  }
});
