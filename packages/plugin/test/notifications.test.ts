/**
 * Notifications from a user's seat: a finished turn and a parked question
 * ask for attention, a chat set to `off` and a child chat stay quiet.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import type { Nyte, SessionEvent, SessionId, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { ToolResultMessage } from "@nyte-ai/schema";
import { NOTIFICATIONS_SETTING_ID, notificationsPlugin } from "../examples/notifications.ts";
import { questionPlugin } from "../examples/question.ts";
import { prompt, respond, testModel, toolCall, TestWorkspace } from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const opened of workspaces.splice(0)) await opened.close();
});

function workspace(): TestWorkspace {
  const created = TestWorkspace.create("nyte-notifications-");
  workspaces.push(created);
  return created;
}

type Notification = Extract<SessionEvent, { kind: "notification" }>;

interface Collected<T> {
  readonly seen: T[];
  readonly stop: () => void;
}

/** Notifications are live only, so collect from a watch that is open before the run. */
function collect(sdk: Nyte, sessionId: SessionId): Collected<Notification> {
  const controller = new AbortController();
  const seen: Notification[] = [];
  void (async () => {
    for await (const event of sdk.watch({ sessionId, live: true, signal: controller.signal })) {
      if (event.kind === "notification") seen.push(event);
    }
  })().catch(() => undefined);
  return { seen, stop: () => controller.abort() };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

function isToolResult(message: { role: string }): message is ToolResultMessage {
  return message.role === "toolResult";
}

const askingModel: StreamFn = (model, context) => {
  if (context.messages.some(isToolResult)) return respond(model, [{ type: "text", text: "ok" }]);
  return respond(model, [
    toolCall("q-1", "question", { question: "Which one?", options: [{ label: "This one" }] }),
  ]);
};

test("a finished turn and a parked question notify; the sound follows the setting", async () => {
  const world = workspace();
  const sdk = await world.open({
    streamFn: askingModel,
    plugins: [inlinePlugin(notificationsPlugin), inlinePlugin(questionPlugin)],
    model: testModel,
  });
  const { sessionId } = world;
  const live = collect(sdk, sessionId);
  await settle();

  assert.equal((await prompt(sdk, sessionId, "choose")).kind, "waiting");
  await settle();
  assert.deepEqual(
    live.seen.map((event) => [event.message, event.title, event.sound]),
    [["Input needs response", "Which one?", false]],
  );

  await sdk.plugins.settings.apply({ sessionId, id: NOTIFICATIONS_SETTING_ID, choiceId: "sound" });
  const waiting = (await sdk.sessions.snapshot({ sessionId }))?.parked?.[0];
  assert.ok(waiting);
  await sdk.runs.reply({ sessionId, callId: "q-1", waitId: waiting.waitId, reply: "that one" });
  await sdk.runs.wait({ sessionId });
  await settle();
  assert.deepEqual(
    live.seen.slice(1).map((event) => [event.message, event.sound]),
    [["Turn finished", true]],
  );
  live.stop();
});

test("off silences a chat, and a child chat never notifies", async () => {
  const world = workspace();
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [inlinePlugin(notificationsPlugin)],
    model: testModel,
  });
  const { sessionId } = world;
  await sdk.plugins.settings.apply({ sessionId, id: NOTIFICATIONS_SETTING_ID, choiceId: "off" });
  const quiet = collect(sdk, sessionId);
  await settle();
  await prompt(sdk, sessionId, "hello");
  await settle();
  assert.deepEqual(quiet.seen, []);
  quiet.stop();

  const child = await sdk.sessions.create({
    parent: { sessionId, runId: "run", callId: "call", depth: 1 },
  });
  const childLive = collect(sdk, child.sessionId);
  await settle();
  await prompt(sdk, child.sessionId, "hello from a child");
  await settle();
  assert.deepEqual(childLive.seen, []);
  childLive.stop();
});
