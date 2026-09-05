/**
 * The question tool from a user's seat: the model asks, the run parks, the
 * client sees one waiting call to render, and the reply channel settles it.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { ToolResultMessage } from "@nyte-ai/schema";
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

async function openParked(): Promise<{ sdk: Nyte; sessionId: SessionId; callId: string }> {
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
  return { sdk, sessionId, callId: waiting.callId };
}

/** Answer the parked call and return what the transcript shows for it. */
async function reply(sdk: Nyte, sessionId: SessionId, callId: string, answer: string) {
  assert.deepEqual(await sdk.runs.reply({ sessionId, callId, reply: answer }), {
    kind: "signalled",
  });
  assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
  const [part, ...rest] = await toolParts(sdk, sessionId);
  assert.ok(part !== undefined && rest.length === 0, "one question was asked");
  assert.ok(part.result !== undefined, "the question settled");
  return part.result;
}

test("asking parks the run; the waiting call carries the question a client renders", async () => {
  const { sdk, sessionId, callId } = await openParked();
  const events = await eventsSoFar(sdk, sessionId);
  const waiting = events.find((event) => event.kind === "effect" && event.state === "waiting");
  assert.ok(waiting?.kind === "effect");
  assert.equal(waiting.tool, "question");
  assert.deepEqual(waiting.args, QUESTION);
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "waiting");

  // A conversation message is not an answer: the call stays parked.
  await sdk.messages.send({ sessionId, content: "actually, one more thing" });
  assert.equal((await sdk.runs.wait({ sessionId })).kind, "waiting");
  assert.equal((await toolParts(sdk, sessionId))[0]?.result, undefined);

  const settled = await reply(sdk, sessionId, callId, "2");
  assert.equal(settled.output, "Broad rewrite");
  assert.equal(settled.isError, false);
  assert.deepEqual(settled.details, { question: "Which implementation?", answer: "Broad rewrite" });
  assert.equal(settled.title, "Which implementation?");
  assert.equal(await lastAssistantText(sdk, sessionId), "Proceeding with Broad rewrite");
});

test("a reply in the user's own words is the answer", async () => {
  const { sdk, sessionId, callId } = await openParked();
  const settled = await reply(sdk, sessionId, callId, "  Wait for the migration  ");
  assert.equal(settled.output, "Wait for the migration");
  assert.equal(settled.isError, false);
  assert.equal(await lastAssistantText(sdk, sessionId), "Proceeding with Wait for the migration");
});

test("walking away is not an answer", async () => {
  const { sdk, sessionId, callId } = await openParked();
  const settled = await reply(sdk, sessionId, callId, "   ");
  assert.equal(settled.isError, true);
  assert.match(settled.output, /unanswered/);
  assert.deepEqual(settled.details, { question: "Which implementation?" });
});

test("a reply selects by number or label; anything else is its own answer", () => {
  assert.equal(answerFor(QUESTION, "2"), "Broad rewrite");
  assert.equal(answerFor(QUESTION, "broad rewrite"), "Broad rewrite");
  assert.equal(answerFor(QUESTION, "  Wait for the migration  "), "Wait for the migration");
});
