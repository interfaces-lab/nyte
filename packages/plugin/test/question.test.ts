import { isPart, memoryStore, tool } from "@nyte-ai/core";
import { assert, expect, it } from "vitest";
import question from "../src/question.ts";
import { fakeModels, open, until } from "./fake-models.ts";

it("parks the run on an ask/question modal and resumes it with the chosen answer", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "ask",
          name: "question",
          arguments: { prompt: "Deploy?", options: ["yes", "no"] },
        },
      ],
    },
    { content: [{ type: "text", text: "Deploying." }] },
  );

  await using host = await open(fake, [question]);
  const session = await host.sessions.create();
  const receipt = await session.send("Ask me.");

  const asked = await until(async () =>
    (await session.view()).parts.find((part) => part.partKind === "ask/question"),
  );

  expect(asked).toMatchObject({
    placement: { kind: "modal" },
    state: { prompt: "Deploy?", options: ["yes", "no"] },
  });
  expect(fake.requests).toHaveLength(1);
  expect(await session.part(asked.id).act("answer", { choice: "no" })).toEqual({
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
    content: [{ kind: "text", text: "no" }],
    parts: [asked.id],
  });
});

it("resumes the run with an answer given on a cold host sharing the store, which resolves the question's owner (§48h)", async () => {
  const store = memoryStore();
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "ask",
          name: "question",
          arguments: { prompt: "Ship it?", options: ["yes", "no"] },
        },
      ],
    },
    { content: [{ type: "text", text: "Shipping." }] },
  );

  await using parked = await open(fake, [question], { store, poll: 10 });
  const session = await parked.sessions.create();
  const receipt = await session.send("Ask me.");

  const asked = await until(async () =>
    (await session.view()).parts.find((part) => part.partKind === "ask/question"),
  );

  await using cold = await open(fakeModels(), [question], {
    store,
    execution: { kind: "admit-only" },
  });

  expect(await cold.session(session.id).part(asked.id).act("answer", { choice: "yes" })).toEqual({
    kind: "ok",
    output: undefined,
  });

  const end = await receipt.settled();

  assert(end.kind === "completed");

  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({
    kind: "ok",
    content: [{ kind: "text", text: "yes" }],
  });
});
