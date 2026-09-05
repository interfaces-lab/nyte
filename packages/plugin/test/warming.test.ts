/**
 * Warming from a user's seat: after a real turn, and only when switched on,
 * the chat's own context goes back to the model with the keep-alive line and
 * the same tools, on the interval, until the chat goes cold.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { contentText } from "@nyte-ai/ai";
import type { Api, Model, SimpleStreamOptions } from "@nyte-ai/ai";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { Context } from "@nyte-ai/schema";
import {
  KEEP_ALIVE_PROMPT,
  nextWarmAt,
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

test("the next keep-alive falls one interval after activity and stops once the chat is cold", () => {
  const activity = { at: 1_000, expires: 2_000 };
  assert.equal(nextWarmAt(activity, 1_000, 100), 1_100);
  assert.equal(nextWarmAt(activity, 1_500, 100), 1_500);
  assert.equal(nextWarmAt({ at: 1_950, expires: 2_000 }, 1_950, 100), undefined);
  assert.equal(nextWarmAt(activity, 2_000, 100), undefined);
});

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
