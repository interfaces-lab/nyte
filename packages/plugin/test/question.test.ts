/**
 * The question tool from a user's seat: the model asks, the run parks, the
 * client sees one waiting call to render, and the reply channel settles it.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { definePlugin, inlinePlugin, ToolWait } from "@nyte-ai/plugin";
import type { ToolResultMessage } from "@nyte-ai/schema";
import { Type } from "typebox";
import { answerFor, questionPlugin, type QuestionInput } from "../examples/question.ts";
import {
  eventsSoFar,
  lastAssistantText,
  prompt,
  respond,
  testModel,
  toolCall,
  toolParts,
  TestWorkspace,
} from "./host.ts";

const QUESTION: QuestionInput = {
  question: "Which implementation?",
  options: [{ label: "Small patch", description: "Change one owner" }, { label: "Broad rewrite" }],
};

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
});

function isToolResult(message: { role: string }): message is ToolResultMessage {
  return message.role === "toolResult";
}

/** A model that asks once, then carries on with whatever the user answered. */
const askingModel: StreamFn = (model, context) => {
  const answered = context.messages.findLast(isToolResult);
  if (answered === undefined) return respond(model, [toolCall("q-1", "question", QUESTION)]);
  const answer = answered.content.find((part) => part.type === "text")?.text ?? "";
  return respond(model, [{ type: "text", text: `Proceeding with ${answer}` }]);
};

async function openParked(): Promise<{
  sdk: Nyte;
  sessionId: SessionId;
  callId: string;
  waitId: string;
}> {
  const world = TestWorkspace.create("nyte-question-");
  workspaces.push(world);
  const sdk = await world.open({
    streamFn: askingModel,
    plugins: [inlinePlugin(questionPlugin)],
    model: testModel,
  });
  const { sessionId } = world;
  assert.equal((await prompt(sdk, sessionId, "help me choose")).kind, "waiting");
  const waiting = (await eventsSoFar(sdk, sessionId)).find(
    (event) => event.kind === "effect" && event.state === "waiting",
  );
  assert.ok(waiting?.kind === "effect", "a client is told which call is waiting");
  return { sdk, sessionId, callId: waiting.callId, waitId: waiting.waitId };
}

/** Answer the parked call and return what the transcript shows for it. */
async function reply(
  sdk: Nyte,
  sessionId: SessionId,
  callId: string,
  waitId: string,
  answer: string,
) {
  assert.deepEqual(await sdk.runs.reply({ sessionId, callId, waitId, reply: answer }), {
    kind: "signalled",
  });
  assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
  const [part, ...rest] = await toolParts(sdk, sessionId);
  assert.ok(part !== undefined && rest.length === 0, "one question was asked");
  assert.ok(part.result !== undefined, "the question settled");
  return part.result;
}

test("asking parks the run; the waiting call carries the question a client renders", async () => {
  const { sdk, sessionId, callId, waitId } = await openParked();
  const events = await eventsSoFar(sdk, sessionId);
  const waiting = events.find((event) => event.kind === "effect" && event.state === "waiting");
  assert.ok(waiting?.kind === "effect" && waiting.state === "waiting");
  assert.equal(waiting.tool, "question");
  assert.deepEqual(waiting.args, QUESTION);
  // The selection is what a client renders: no tool knowledge, no arg schema.
  const selection = {
    title: "Which implementation?",
    choices: [
      { id: "1", label: "Small patch", description: "Change one owner" },
      { id: "2", label: "Broad rewrite" },
    ],
    other: "Or type your own answer",
  };
  assert.deepEqual(waiting.selection, selection);
  // A client that opens the session later answers from the snapshot alone.
  const snapshot = await sdk.sessions.snapshot({ sessionId });
  assert.deepEqual(
    snapshot?.parked?.map((call) => [call.callId, call.waitId, call.selection]),
    [[callId, waitId, selection]],
  );
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "waiting");

  // A conversation message is not an answer: the call stays parked.
  await sdk.messages.send({ sessionId, content: "actually, one more thing" });
  assert.equal((await sdk.runs.wait({ sessionId })).kind, "waiting");
  assert.equal((await toolParts(sdk, sessionId))[0]?.result, undefined);

  const settled = await reply(sdk, sessionId, callId, waitId, "2");
  assert.equal(settled.output, "Broad rewrite");
  assert.equal(settled.isError, false);
  assert.deepEqual(settled.details, { question: "Which implementation?", answer: "Broad rewrite" });
  assert.equal(settled.title, "Which implementation?");
  assert.equal(await lastAssistantText(sdk, sessionId), "Proceeding with Broad rewrite");
});

test("a reply in the user's own words is the answer", async () => {
  const { sdk, sessionId, callId, waitId } = await openParked();
  const settled = await reply(sdk, sessionId, callId, waitId, "  Wait for the migration  ");
  assert.equal(settled.output, "Wait for the migration");
  assert.equal(settled.isError, false);
  assert.equal(await lastAssistantText(sdk, sessionId), "Proceeding with Wait for the migration");
});

test("walking away is not an answer", async () => {
  const { sdk, sessionId, callId, waitId } = await openParked();
  const settled = await reply(sdk, sessionId, callId, waitId, "   ");
  assert.equal(settled.isError, true);
  assert.match(settled.output, /unanswered/);
  assert.deepEqual(settled.details, { question: "Which implementation?" });
});

test("a reply selects by number or label; anything else is its own answer", () => {
  assert.equal(answerFor(QUESTION, "2"), "Broad rewrite");
  assert.equal(answerFor(QUESTION, "broad rewrite"), "Broad rewrite");
  assert.equal(answerFor(QUESTION, "  Wait for the migration  "), "Wait for the migration");
});

test("structured replies reject unknown ids, duplicates, and single-choice combinations", () => {
  assert.equal(answerFor(QUESTION, { choices: ["2"] }), "Broad rewrite");
  assert.equal(answerFor(QUESTION, { choices: [], other: "  custom  " }), "custom");
  assert.equal(answerFor(QUESTION, { choices: ["missing"] }), "");
  assert.equal(answerFor(QUESTION, { choices: ["1", "1"] }), "");
  assert.equal(answerFor(QUESTION, { choices: ["1", "2"] }), "");
  assert.equal(answerFor(QUESTION, { choices: ["1"], other: "custom" }), "");
});

/** What an untyped JS plugin might park with. Each must fail the call, never the store. */
const MALFORMED: Record<string, () => unknown> = {
  "blank title": () => ({ title: "  ", choices: [{ id: "a", label: "A" }] }),
  "blank label": () => ({ title: "x", choices: [{ id: "a", label: "\t" }] }),
  "blank description": () => ({
    title: "x",
    choices: [{ id: "a", label: "A", description: "\n" }],
  }),
  "blank own-answer prompt": () => ({
    title: "x",
    choices: [{ id: "a", label: "A" }],
    other: " ",
  }),
  "empty choices": () => JSON.parse('{"title":"x","choices":[]}'),
  "duplicate ids": () => ({
    title: "x",
    choices: [
      { id: "a", label: "A" },
      { id: "a", label: "B" },
    ],
  }),
  "empty id": () => ({ title: "x", choices: [{ id: "", label: "A" }] }),
  // Durable JSON has no getters: a value that could answer the check and the
  // store differently is refused before either reads it.
  "a getter for a field": () => ({
    get title() {
      return "x";
    },
    choices: [{ id: "a", label: "A" }],
  }),
};

test.each(Object.entries(MALFORMED))(
  "a plugin that parks with %s fails its call, not the session",
  async (_name, build) => {
    const world = TestWorkspace.create("nyte-question-malformed-");
    workspaces.push(world);
    const broken = definePlugin({
      id: "broken-ask",
      session(api) {
        api.tools.add((draft) =>
          draft.set("broken", {
            name: "broken",
            description: "parks with garbage",
            parameters: Type.Object({}),
            replay: "never",
            execute: async () => {
              throw Object.assign(new ToolWait(), { selection: build() });
            },
          }),
        );
      },
    });
    const sdk = await world.open({
      streamFn: (model, context) =>
        context.messages.findLast(isToolResult) === undefined
          ? respond(model, [toolCall("b-1", "broken", {})])
          : respond(model, [{ type: "text", text: "moving on" }]),
      plugins: [inlinePlugin(broken)],
      model: testModel,
    });
    const { sessionId } = world;
    assert.equal((await prompt(sdk, sessionId, "go")).kind, "idle");
    const [part] = await toolParts(sdk, sessionId);
    assert.ok(part?.result?.isError === true, "the call settled as a tool error");
    assert.match(part.result.output, /malformed selection/);
    assert.equal((await sdk.sessions.snapshot({ sessionId }))?.parked, undefined);
    assert.equal(await lastAssistantText(sdk, sessionId), "moving on");
  },
);

test("only the selection's own fields reach the ref", async () => {
  const world = TestWorkspace.create("nyte-question-extra-");
  workspaces.push(world);
  const chatty = definePlugin({
    id: "chatty-ask",
    session(api) {
      api.tools.add((draft) =>
        draft.set("chatty", {
          name: "chatty",
          description: "parks with extra fields",
          parameters: Type.Object({}),
          replay: "never",
          execute: async () => {
            throw Object.assign(new ToolWait(), {
              selection: {
                title: "x",
                choices: [{ id: "a", label: "A", weight: 3 }],
                theme: "dark",
              },
            });
          },
        }),
      );
    },
  });
  const sdk = await world.open({
    streamFn: (model) => respond(model, [toolCall("c-1", "chatty", {})]),
    plugins: [inlinePlugin(chatty)],
    model: testModel,
  });
  const { sessionId } = world;
  assert.equal((await prompt(sdk, sessionId, "go")).kind, "waiting");
  assert.deepEqual((await sdk.sessions.snapshot({ sessionId }))?.parked?.[0]?.selection, {
    title: "x",
    choices: [{ id: "a", label: "A" }],
  });
});

test("several answers, and typed text that looks like an id, arrive as one structured reply", async () => {
  const world = TestWorkspace.create("nyte-question-multi-");
  workspaces.push(world);
  const asked: QuestionInput = { ...QUESTION, multiple: true };
  const sdk = await world.open({
    streamFn: (model, context) => {
      const answered = context.messages.findLast(isToolResult);
      if (answered === undefined) return respond(model, [toolCall("q-1", "question", asked)]);
      const answer = answered.content.find((part) => part.type === "text")?.text ?? "";
      return respond(model, [{ type: "text", text: `Proceeding with ${answer}` }]);
    },
    plugins: [inlinePlugin(questionPlugin)],
    model: testModel,
  });
  const { sessionId } = world;
  assert.equal((await prompt(sdk, sessionId, "choose")).kind, "waiting");
  const parked = (await sdk.sessions.snapshot({ sessionId }))?.parked?.[0];
  assert.ok(parked);
  assert.equal(parked.selection?.multiple, true);
  assert.equal(parked?.until, undefined);
  assert.deepEqual(
    await sdk.runs.reply({
      sessionId,
      callId: "q-1",
      waitId: parked.waitId,
      reply: { choices: ["1", "2"], other: "1" },
    }),
    { kind: "signalled" },
  );
  assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
  assert.equal(
    await lastAssistantText(sdk, sessionId),
    "Proceeding with Small patch, Broad rewrite, 1",
  );
});

test("the timeout setting gives a question a deadline the runner honours without a client", async () => {
  const world = TestWorkspace.create("nyte-question-timeout-");
  workspaces.push(world);
  const sdk = await world.open({
    streamFn: askingModel,
    plugins: [inlinePlugin(questionPlugin)],
    model: testModel,
  });
  const { sessionId } = world;
  assert.deepEqual(
    await sdk.plugins.settings.apply({ sessionId, id: "question-timeout", choiceId: "30s" }),
    { kind: "applied" },
  );
  const before = Date.now();
  assert.equal((await prompt(sdk, sessionId, "help me choose")).kind, "waiting");
  const parked = (await sdk.sessions.snapshot({ sessionId }))?.parked?.[0];
  assert.ok(parked?.until !== undefined, "the deadline is on the parked call for clients to show");
  assert.ok(parked.until >= before + 30_000 && parked.until <= Date.now() + 30_000);
});

test("a wait past its deadline is woken by the runner, with no reply and no client", async () => {
  const world = TestWorkspace.create("nyte-question-deadline-");
  workspaces.push(world);
  const wakes: { expired: boolean; reply: unknown }[] = [];
  const brief = definePlugin({
    id: "brief-wait",
    session(api) {
      api.tools.add((draft) =>
        draft.set("brief", {
          name: "brief",
          description: "waits a moment",
          parameters: Type.Object({}),
          replay: "never",
          execute: async () => {
            throw new ToolWait({ until: Date.now() + 150 });
          },
          wake: async (_waiting, context) => {
            wakes.push({ expired: context.expired, reply: context.reply });
            return {
              kind: "settle",
              result: {
                content: [{ type: "text", text: context.expired ? "expired" : "?" }],
                details: {},
              },
            };
          },
        }),
      );
    },
  });
  const sdk = await world.open({
    streamFn: (model, context) =>
      context.messages.findLast(isToolResult) === undefined
        ? respond(model, [toolCall("b-1", "brief", {})])
        : respond(model, [{ type: "text", text: "carried on" }]),
    plugins: [inlinePlugin(brief)],
    model: testModel,
  });
  const { sessionId } = world;
  const started = Date.now();
  assert.equal((await prompt(sdk, sessionId, "go")).kind, "waiting");
  // Nobody replies. The attached host notices the deadline and steps the run.
  const deadline = Date.now() + 5_000;
  while ((await sdk.runs.wait({ sessionId })).kind !== "idle") {
    if (Date.now() > deadline) assert.fail("the deadline never woke the run");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(Date.now() - started >= 150, "woke no earlier than the deadline");
  assert.deepEqual(wakes, [{ expired: true, reply: undefined }]);
  assert.equal((await toolParts(sdk, sessionId))[0]?.result?.output, "expired");
  assert.equal(await lastAssistantText(sdk, sessionId), "carried on");
});
