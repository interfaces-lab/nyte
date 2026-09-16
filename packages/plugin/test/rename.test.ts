/** The rename command from a user's seat: literal names stay literal, while an
 * empty command asks the preferred title model about the transcript and falls
 * back to the chat model without naming conversations on its own. */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { contentText } from "@nyte-ai/ai";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { Nyte, SessionId } from "@nyte-ai/core";
import type { Api, Model } from "@nyte-ai/schema";
import {
  TITLE_MODEL_ID,
  TITLE_PROMPT,
  renamePlugin,
  type TitleModels,
} from "../examples/rename.ts";
import {
  prompt,
  respond,
  runCommand,
  testModel,
  toolCall,
  toolParts,
  TestWorkspace,
} from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const opened of workspaces.splice(0)) await opened.close();
});

function workspace(): TestWorkspace {
  const created = TestWorkspace.create("nyte-rename-");
  workspaces.push(created);
  return created;
}

const primary: Model<Api> = {
  ...testModel,
  id: "chat-model",
  name: "Chat model",
};

const luna: Model<Api> = {
  ...testModel,
  id: TITLE_MODEL_ID,
  name: "Luna",
  provider: "title-provider",
  reasoning: true,
};

interface TitleCall {
  readonly model: Model<Api>;
  readonly context: Parameters<TitleModels["streamSimple"]>[1];
  readonly options: Parameters<TitleModels["streamSimple"]>[2];
}

function titleProvider() {
  const calls: TitleCall[] = [];
  const models: TitleModels = {
    getModels: () => [luna, primary],
    streamSimple(model, context, options) {
      calls.push({ model, context, options });
      if (model.id === TITLE_MODEL_ID) throw new Error("title provider unavailable");
      return respond(model, [
        { type: "text", text: "\n  Retry-focused 500 investigation  \nignored" },
      ]);
    },
  };
  return { models, calls };
}

test("/rename with an argument uses the literal trimmed name without asking a model", async () => {
  const world = workspace();
  const titles = titleProvider();
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [inlinePlugin(renamePlugin({ models: titles.models, model: primary }))],
    model: primary,
  });

  assert.equal(
    await runCommand(sdk, world.sessionId, "rename", "  Launch plan  "),
    "Chat named Launch plan",
  );
  assert.equal((await sdk.sessions.get({ sessionId: world.sessionId }))?.name, "Launch plan");
  assert.equal(titles.calls.length, 0);
});

test("/rename alone builds transcript context and falls back from Luna to the chat model", async () => {
  const world = workspace();
  const titles = titleProvider();
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [inlinePlugin(renamePlugin({ models: titles.models, model: primary }))],
    model: primary,
  });

  // Named by hand first, so the first prompt does not title it and the
  // regeneration below starts from the same place a user's would.
  await sdk.sessions.rename({ sessionId: world.sessionId, name: "draft" });
  await prompt(sdk, world.sessionId, "Investigate production 500s");
  await prompt(sdk, world.sessionId, "Focus on retries");
  assert.equal((await sdk.sessions.get({ sessionId: world.sessionId }))?.name, "draft");
  assert.equal(titles.calls.length, 0);

  assert.equal(await runCommand(sdk, world.sessionId, "rename"), undefined);
  assert.equal(
    (await sdk.sessions.get({ sessionId: world.sessionId }))?.name,
    "Retry-focused 500 investigation",
  );
  assert.deepEqual(
    titles.calls.map((call) => call.model.id),
    [TITLE_MODEL_ID, primary.id],
  );

  const [preferred, fallback] = titles.calls;
  assert.ok(preferred !== undefined && fallback !== undefined);
  assert.equal(preferred.context.systemPrompt, TITLE_PROMPT);
  const request = preferred.context.messages[0];
  assert.ok(request?.role === "user");
  assert.equal(
    contentText(request.content),
    "Original request:\nInvestigate production 500s\n\nRecent conversation:\nAssistant: done\n\nUser: Focus on retries\n\nAssistant: done",
  );
  assert.equal(preferred.options?.reasoning, "medium");
  assert.equal(preferred.options?.maxTokens, 64);
  assert.equal(preferred.options?.cacheRetention, "none");
  assert.equal(fallback.context.systemPrompt, TITLE_PROMPT);
  assert.equal(fallback.options?.reasoning, undefined);
});

async function untilNamed(sdk: Nyte, sessionId: SessionId): Promise<string | undefined> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const name = (await sdk.sessions.get({ sessionId }))?.name;
    if (name !== undefined || Date.now() > deadline) return name;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a root chat with no name is titled in the background on its first prompt, and only then", async () => {
  const world = workspace();
  const titles = titleProvider();
  const sdk = await world.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "done" }]),
    plugins: [inlinePlugin(renamePlugin({ models: titles.models, model: primary }))],
    model: primary,
  });

  await prompt(sdk, world.sessionId, "Investigate production 500s");
  assert.equal(await untilNamed(sdk, world.sessionId), "Retry-focused 500 investigation");
  assert.deepEqual(
    titles.calls.map((call) => call.model.id),
    [TITLE_MODEL_ID, primary.id],
  );
  const request = titles.calls[0]?.context.messages[0];
  assert.ok(request?.role === "user");
  assert.equal(contentText(request.content), "Investigate production 500s");

  // A later prompt, a chat someone already named, and a child chat are left alone.
  await prompt(sdk, world.sessionId, "Focus on retries");
  const named = await sdk.sessions.create({ name: "mine" });
  await prompt(sdk, named.sessionId, "hello");
  const child = await sdk.sessions.create({
    parent: {
      sessionId: world.sessionId,
      runId: "run",
      callId: "call",
      depth: 1,
    },
  });
  await prompt(sdk, child.sessionId, "hello from a child");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(titles.calls.length, 2);
  assert.equal((await sdk.sessions.get({ sessionId: named.sessionId }))?.name, "mine");
  assert.equal((await sdk.sessions.get({ sessionId: child.sessionId }))?.name, undefined);
});

test("the rename_chat tool names the chat, trimming and capping; a blank name is refused", async () => {
  const world = workspace();
  const titles = titleProvider();
  const padded = `  Retry budget for 500s ${"x".repeat(200)}  `;
  // A blank name first, then a padded, over-long one: the tool owns both.
  const names = ["   ", padded];
  const sdk = await world.open({
    streamFn: (model) => {
      const name = names.shift();
      return name === undefined
        ? respond(model, [{ type: "text", text: "done" }])
        : respond(model, [toolCall(`r-${String(names.length)}`, "rename_chat", { name })]);
    },
    plugins: [inlinePlugin(renamePlugin({ models: titles.models, model: primary }))],
    model: primary,
  });

  // Named by hand first, so the first-prompt titling stays out of the way.
  await sdk.sessions.rename({ sessionId: world.sessionId, name: "draft" });

  await prompt(sdk, world.sessionId, "Investigate production 500s");

  const expected = padded.trim().slice(0, 100);
  assert.equal((await sdk.sessions.get({ sessionId: world.sessionId }))?.name, expected);
  assert.equal(titles.calls.length, 0, "the tool names the chat without asking a model");

  const [blank, named, ...rest] = await toolParts(sdk, world.sessionId);
  assert.ok(named !== undefined && rest.length === 0);
  assert.equal(blank?.result?.isError, true);
  assert.equal(named.result?.isError, false);
  assert.equal(named.result?.output, `Chat named ${expected}`);
  assert.deepEqual(named.result?.details, { name: expected });
  assert.equal(named.result?.title, expected);
});
