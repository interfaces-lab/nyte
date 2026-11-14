import { isPart, tool } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import questionPlugin, { question } from "../src/question/question.ts";
import { openQuestions } from "../src/question/schema.ts";
import secretsPlugin from "../src/secret/secret.ts";
import { fakeModels, open, startChat, until } from "./fake-models.ts";
import type { Reply } from "./fake-models.ts";

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
  const { session, receipt } = await host.sessions.start({ content: "Ask me." });

  const asked = await until(async () =>
    (await session.view()).parts.find((part) => part.partKind === "ask/question"),
  );

  expect(asked).toMatchObject({
    placement: { kind: "modal" },
    state: { call: expect.any(String), questions, phase: { kind: "asking" } },
  });
  expect(openQuestions(await session.view())).toEqual([{ part: asked.id, questions, late: false }]);
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
  const { session, receipt } = await parked.sessions.start({
    content: "Ask me.",
  });

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
  });
});

it("rejects invalid submissions and keeps the first answer across same-set retries", async () => {
  await using host = await open(fakeModels(), [questionPlugin]);
  const { session } = await host.sessions.start({ content: "Hi." });

  const part = await session.parts.create(question, {
    state: { call: asId<"call">("asked"), questions, phase: { kind: "asking" } },
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

  expect(openQuestions(await session.view())).toEqual([{ part: part.id, questions, late: false }]);
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
      call: "asked",
      questions,
      phase: { kind: "answered", answers: [["Yes"], ["Desktop", "Terminal"], []], head: null },
    },
  );
  expect(openQuestions(await session.view())).toEqual([]);
});

const asking: Reply = {
  content: [
    { type: "toolCall", id: "ask", name: "question", arguments: { questions } },
    {
      type: "toolCall",
      id: "secret",
      name: "request_secret",
      arguments: { name: "API_KEY", label: "API key", reason: "To call the API." },
    },
  ],
};

const refused = [
  { kind: "failed", message: "A side chat can't ask the user questions." },
  { kind: "failed", message: "A side chat can't ask the user for a secret." },
] as const;

const done: Reply = { content: [{ type: "text", text: "Done." }] };

it.each([
  ["main", ["question", "request_secret"], [], done],
  ["side", [], refused, asking],
  ["subagent", [], refused, asking],
] as const)(
  "a %s chat is offered %j and its asks give %j",
  async (chat, offered, outcomes, reply) => {
    const fake = fakeModels();
    await using host = await open(fake, [questionPlugin, secretsPlugin]);
    const { session, receipt, first } = await startChat(host, fake, chat, [reply, done]);

    assert((await receipt.settled()).kind === "completed");
    const system = fake.requests[first]?.context.messages[0];

    assert(system?.role === "system");
    expect(
      (system.toolsAdded ?? [])
        .map((info) => info.name)
        .filter((name) => name === "question" || name === "request_secret"),
    ).toEqual(offered);
    const view = await session.view();

    expect(
      view.messages.flatMap((message) =>
        isPart(message, tool) && message.state.phase === "settled" ? [message.state.outcome] : [],
      ),
    ).toEqual(outcomes);
    expect(view.parts).toEqual([]);
  },
);
