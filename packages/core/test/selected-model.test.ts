/**
 * A selected model is a choice. When this host's catalog cannot resolve it,
 * the run fails and says so instead of answering on the host's default, which
 * would put an answer from one model under another model's name.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import type { Nyte, SessionId } from "../src/kernel/sdk/types.ts";
import type { StreamFn } from "../src/types.ts";
import { assistant, openStore, sleep, within } from "./kernel/helpers.ts";

const fallback: Model<Api> = {
  id: "fallback-model",
  name: "Fallback",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const selectable: Model<Api> = { ...fallback, id: "selected-model", name: "Selected" };

function scripted() {
  const answered: Model<Api>[] = [];
  const streamFn: StreamFn = (model) => {
    answered.push(model);
    const answer = assistant(`answered by ${model.id}`);
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    stream.push({ type: "done", reason: "stop", message: answer });
    return stream;
  };
  return { streamFn, answered };
}

async function open(streamFn: StreamFn, catalog: readonly Model<Api>[]): Promise<Nyte> {
  return createNyte({
    store: openStore(),
    streamFn,
    models: {
      getModels: () => catalog,
      getModel: (provider, id) =>
        catalog.find((candidate) => candidate.provider === provider && candidate.id === id),
      getAvailable: async () => catalog,
    },
    model: fallback,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
  });
}

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

async function turnText(nyte: Nyte, id: SessionId): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId: id });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) =>
          part.kind === "assistant" || part.kind === "note" ? [part.text] : [],
        )
      : [],
  );
}

test("a selection this host cannot resolve fails instead of answering on the default", async () => {
  // The catalog stops carrying the model after it was selected: a session that
  // arrived from a host with a wider catalog, or a model the release dropped.
  const catalog: Model<Api>[] = [fallback, selectable];
  const { streamFn, answered } = scripted();
  const nyte = await open(streamFn, catalog);
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    const choice = await nyte.sessions.configure({
      sessionId: id,
      model: { provider: selectable.provider, id: selectable.id },
    });
    assert.equal(choice.kind, "queued");
    catalog.splice(catalog.indexOf(selectable), 1);

    await nyte.messages.send({ sessionId: id, content: "hello" });
    await untilIdle(nyte, id);

    assert.deepEqual(answered, [], "no model answered in place of the selection");
    assert.ok(
      (await turnText(nyte, id)).some((text) =>
        text.includes("Selected model is unavailable: openai/selected-model"),
      ),
      "the failure names the model that was selected",
    );
  } finally {
    await nyte.close();
  }
});

test("a selection this host can resolve still runs on it", async () => {
  const { streamFn, answered } = scripted();
  const nyte = await open(streamFn, [fallback, selectable]);
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.sessions.configure({
      sessionId: id,
      model: { provider: selectable.provider, id: selectable.id },
    });
    await nyte.messages.send({ sessionId: id, content: "hello" });
    await untilIdle(nyte, id);

    assert.deepEqual(
      answered.map((model) => model.id),
      [selectable.id],
    );
  } finally {
    await nyte.close();
  }
});
