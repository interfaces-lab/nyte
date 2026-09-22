/**
 * Warming from a user's seat: after a real turn, and only when switched on,
 * the chat's own context goes back to the model with the keep-alive line and
 * the same tools, on the interval, until the chat goes cold.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { contentText, createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions } from "@nyte-ai/ai";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { Context } from "@nyte-ai/schema";
import {
  KEEP_ALIVE_PROMPT,
  WARMING_SETTING_ID,
  warmingPlugin,
  type WarmingOptions,
} from "../examples/warming.ts";
import { prompt, respond, testModel, TestWorkspace } from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const opened of workspaces.splice(0)) await opened.close();
});

interface KeepAliveCall {
  readonly model: Model<Api>;
  readonly context: Context;
  readonly options: SimpleStreamOptions | undefined;
}

interface KeepAliveModels {
  readonly models: WarmingOptions["models"];
  readonly calls: readonly KeepAliveCall[];
}

function keepAliveModels(): KeepAliveModels {
  const calls: KeepAliveCall[] = [];
  return {
    calls,
    models: {
      getModel: () => testModel,
      streamSimple(model, context, options) {
        calls.push({ model, context, options });
        return respond(model, [{ type: "text", text: "OK" }]);
      },
    },
  };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out");
    await wait(5);
  }
}

function settleAborted(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  signal: AbortSignal | undefined,
): void {
  signal?.addEventListener(
    "abort",
    () => {
      void respond(model, [])
        .result()
        .then((message) =>
          stream.push({
            type: "error",
            reason: "aborted",
            error: { ...message, stopReason: "aborted", errorMessage: "aborted" },
          }),
        );
    },
    { once: true },
  );
}

test("switched on, a turn is followed by keep-alives over the same context and tools", async () => {
  const world = TestWorkspace.create("nyte-warming-");
  workspaces.push(world);
  const provider = keepAliveModels();
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [
      inlinePlugin(warmingPlugin({ models: provider.models, intervalMs: 20, durationMs: 200 })),
    ],
    model: testModel,
  });
  const { sessionId } = world;

  await prompt(sdk, sessionId, "warm me");
  await wait(60);
  assert.equal(provider.calls.length, 0, "off by default");

  await sdk.plugins.settings.apply({ sessionId, id: WARMING_SETTING_ID, choiceId: "on" });
  await prompt(sdk, sessionId, "now warm me");
  await wait(120);
  const first = provider.calls[0];
  assert.ok(first !== undefined, "a keep-alive went out");
  assert.ok(provider.calls.length >= 2, "and it repeats on the interval");
  assert.equal(first.model.id, testModel.id);
  assert.equal(first.options?.sessionId, sessionId);
  assert.equal(first.options?.toolChoice, "none");
  assert.equal(first.options?.timeoutMs, 30_000);
  assert.ok(first.options?.signal instanceof AbortSignal);
  const tail = first.context.messages.at(-1);
  assert.ok(tail?.role === "user");
  assert.equal(contentText(tail.content), KEEP_ALIVE_PROMPT);
  assert.equal(
    first.context.messages.filter((message) => message.role === "user").length,
    3,
    "the chat's own messages come first",
  );
  assert.ok(Array.isArray(first.context.tools));

  await wait(250);
  const settled = provider.calls.length;
  await wait(80);
  assert.equal(provider.calls.length, settled, "cold after the duration");
});

test("a keep-alive waits for the real run to become idle", async () => {
  const world = TestWorkspace.create("nyte-warming-busy-");
  workspaces.push(world);
  const provider = keepAliveModels();
  let release: (() => void) | undefined;
  const sdk = await world.open({
    streamFn: (model) => {
      const stream = createAssistantMessageEventStream();
      const response = respond(model, [{ type: "text", text: "done" }]).result();
      release = () => {
        void response.then((message) => stream.push({ type: "done", reason: "stop", message }));
      };
      return stream;
    },
    plugins: [
      inlinePlugin(warmingPlugin({ models: provider.models, intervalMs: 20, durationMs: 300 })),
    ],
    model: testModel,
  });
  const { sessionId } = world;
  await sdk.plugins.settings.apply({ sessionId, id: WARMING_SETTING_ID, choiceId: "on" });
  await sdk.messages.send({ sessionId, content: "still working" });
  await waitFor(() => release !== undefined);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "respond");
  await wait(60);
  assert.equal(provider.calls.length, 0);

  const finish = release;
  assert.ok(finish !== undefined);
  finish();
  await sdk.runs.wait({ sessionId });
  await waitFor(() => provider.calls.length > 0);
});

test("a new real request cancels an in-flight keep-alive", async () => {
  const world = TestWorkspace.create("nyte-warming-cancel-");
  workspaces.push(world);
  const calls: KeepAliveCall[] = [];
  const models: WarmingOptions["models"] = {
    getModel: () => testModel,
    streamSimple(model, context, options) {
      calls.push({ model, context, options });
      const stream = createAssistantMessageEventStream();
      settleAborted(stream, model, options?.signal);
      return stream;
    },
  };
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [
      inlinePlugin(
        warmingPlugin({ models, intervalMs: 20, durationMs: 300, requestTimeoutMs: 200 }),
      ),
    ],
    model: testModel,
  });
  const { sessionId } = world;
  await sdk.plugins.settings.apply({ sessionId, id: WARMING_SETTING_ID, choiceId: "on" });
  await prompt(sdk, sessionId, "first");
  await waitFor(() => calls.length === 1);
  const warmingSignal = calls[0]?.options?.signal;
  assert.ok(warmingSignal !== undefined && !warmingSignal.aborted);

  await prompt(sdk, sessionId, "interrupt warming");
  assert.equal(warmingSignal.aborted, true);
  await wait(5);
  assert.equal(calls.length, 1, "the cancelled keep-alive did not overlap another one");
});

test("an in-flight keep-alive stops when the original warming window expires", async () => {
  const world = TestWorkspace.create("nyte-warming-deadline-");
  workspaces.push(world);
  const calls: KeepAliveCall[] = [];
  const models: WarmingOptions["models"] = {
    getModel: () => testModel,
    streamSimple(model, context, options) {
      calls.push({ model, context, options });
      const stream = createAssistantMessageEventStream();
      settleAborted(stream, model, options?.signal);
      return stream;
    },
  };
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [
      inlinePlugin(
        warmingPlugin({ models, intervalMs: 20, durationMs: 100, requestTimeoutMs: 5_000 }),
      ),
    ],
    model: testModel,
  });
  const { sessionId } = world;
  await sdk.plugins.settings.apply({ sessionId, id: WARMING_SETTING_ID, choiceId: "on" });
  await prompt(sdk, sessionId, "warm briefly");
  await waitFor(() => calls.length === 1);
  const warmingSignal = calls[0]?.options?.signal;
  assert.ok(warmingSignal !== undefined && !warmingSignal.aborted);

  await waitFor(() => warmingSignal.aborted, 1_000);
  await wait(20);
  assert.equal(calls.length, 1);
});

test("switching to a model unavailable to warming clears prior activity", async () => {
  const world = TestWorkspace.create("nyte-warming-model-switch-");
  workspaces.push(world);
  const unsupported = { ...testModel, id: "unsupported-model" };
  const provider = keepAliveModels();
  const models: WarmingOptions["models"] = {
    getModel: (providerId, modelId) =>
      providerId === testModel.provider && modelId === testModel.id ? testModel : undefined,
    streamSimple: provider.models.streamSimple,
  };
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [inlinePlugin(warmingPlugin({ models, intervalMs: 100, durationMs: 500 }))],
    model: testModel,
    models: [testModel, unsupported],
  });
  const { sessionId } = world;
  await sdk.plugins.settings.apply({ sessionId, id: WARMING_SETTING_ID, choiceId: "on" });
  await prompt(sdk, sessionId, "supported");
  assert.equal(
    (
      await sdk.sessions.configure({
        sessionId,
        model: { provider: unsupported.provider, id: unsupported.id },
      })
    ).kind,
    "queued",
  );
  await prompt(sdk, sessionId, "unsupported for warming");
  const callsAfterSwitch = provider.calls.length;

  await wait(150);
  assert.equal(provider.calls.length, callsAfterSwitch);
});
