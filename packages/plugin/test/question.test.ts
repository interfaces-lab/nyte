import { isPart, tool } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { assert, expect, it } from "vitest";
import questionPlugin, { question } from "../src/question/question.ts";
import { openQuestions } from "../src/question/schema.ts";
import { fakeModels, open, until } from "./fake-models.ts";

const questions = [
  {
    question: "Deploy?",
    header: "Deployment",
    options: [
      { label: "Yes", description: "Deploy now." },
      { label: "No", description: "Keep reviewing." },
      { label: "Build only", description: "Prepare the package without deploying." },
      { label: "Later", description: "Schedule the deployment later." },
    ],
  },
  {
    question: "Which clients?",
    header: "Clients",
    options: [
      { label: "Desktop", description: "The desktop question tray." },
      { label: "Terminal", description: "The terminal question panel." },
      { label: "Mobile", description: "The mobile answer form." },
    ],
    multiple: true,
  },
  {
    question: "When?",
    header: "Timing",
    options: [],
  },
];

it("parks on one grouped modal and resumes with all selected, custom and unanswered answers", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [{ type: "toolCall", id: "ask", name: "question", arguments: { questions } }],
    },
    { content: [{ type: "text", text: "Deploying." }] },
  );

  await using host = await open(fake, [questionPlugin]);
  const session = await host.sessions.create();
  const receipt = await session.send("Ask me.");

  const asked = await until(async () =>
    (await session.view()).parts.find((part) => part.partKind === "ask/question"),
  );

  expect(asked).toMatchObject({
    placement: { kind: "modal" },
    state: { questions, answers: null },
  });
  expect(openQuestions(await session.view())).toEqual([{ part: asked.id, questions }]);
  expect(fake.requests).toHaveLength(1);
  expect(
    await session
      .part(asked.id)
      .act("answer", { answers: [[" No "], ["Terminal", "Desktop"], []] }),
  ).toEqual({
    kind: "ok",
    output: undefined,
  });

  const end = await receipt.settled();

  assert(end.kind === "completed");
  expect(fake.requests).toHaveLength(2);
  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({
    kind: "ok",
    content: [
      { kind: "text", text: "Deploy?: No\nWhich clients?: Desktop, Terminal\nWhen?: Unanswered" },
    ],
    output: { answers: [["No"], ["Desktop", "Terminal"], []] },
    parts: [asked.id],
  });
  expect(openQuestions(await session.view())).toEqual([]);
});

it("resumes a grouped request answered by a cold host sharing the durable store", async () => {
  const store = memoryStore();
  const fake = fakeModels();

  fake.reply(
    {
      content: [{ type: "toolCall", id: "ask", name: "question", arguments: { questions } }],
    },
    { content: [{ type: "text", text: "Shipping." }] },
  );

  await using parked = await open(fake, [questionPlugin], { store, poll: 10 });
  const session = await parked.sessions.create();
  const receipt = await session.send("Ask me.");

  const asked = await until(async () =>
    (await session.view()).parts.find((part) => part.partKind === "ask/question"),
  );

  await using cold = await open(fakeModels(), [questionPlugin], {
    store,
    execution: { kind: "admit-only" },
  });

  expect(
    await cold
      .session(session.id)
      .part(asked.id)
      .act("answer", {
        answers: [["Yes"], ["Mobile"], [" After the review "]],
      }),
  ).toEqual({ kind: "ok", output: undefined });

  const end = await receipt.settled();

  assert(end.kind === "completed");
  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({
    kind: "ok",
    content: [
      { kind: "text", text: "Deploy?: Yes\nWhich clients?: Mobile\nWhen?: After the review" },
    ],
    output: { answers: [["Yes"], ["Mobile"], ["After the review"]] },
  });
});

it("rejects invalid submissions and keeps the first answer across same-set retries", async () => {
  await using host = await open(fakeModels(), [questionPlugin]);
  const session = await host.sessions.create();

  const part = await session.parts.create(question, {
    state: { questions, answers: null },
    placement: { kind: "modal" },
  });

  for (const answers of [
    [["Yes"]],
    [["Yes", "No"], [], []],
    [[], ["Desktop", " Desktop "], []],
    [[], [], ["  "]],
  ]) {
    expect(await part.act("answer", { answers })).toMatchObject({ kind: "rejected" });
  }

  expect(openQuestions(await session.view())).toEqual([{ part: part.id, questions }]);
  expect(await part.act("answer", { answers: [["Yes"], ["Terminal", "Desktop"], []] })).toEqual({
    kind: "ok",
    output: undefined,
  });
  expect(await part.act("answer", { answers: [[" Yes "], ["Desktop", " Terminal "], []] })).toEqual(
    {
      kind: "ok",
      output: undefined,
    },
  );
  expect(await part.act("answer", { answers: [["No"], ["Desktop"], []] })).toEqual({
    kind: "rejected",
    reason: "These questions were already answered.",
  });
  expect((await session.view()).parts.find((candidate) => candidate.id === part.id)?.state).toEqual(
    {
      questions,
      answers: [["Yes"], ["Desktop", "Terminal"], []],
    },
  );
  expect(openQuestions(await session.view())).toEqual([]);
});
