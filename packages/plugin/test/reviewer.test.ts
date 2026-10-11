import { assert, expect, it } from "vitest";
import reviewer, { REVIEW_PROMPT } from "../src/reviewer.ts";
import { fakeModels, open, until } from "./fake-models.ts";

it("lists the reviewer agent and sends /review under it, its prompt replacing the system prompt", async () => {
  const fake = fakeModels();
  fake.reply({ content: [{ type: "text", text: "No findings." }] });
  await using host = await open(fake, [reviewer]);
  const session = await host.sessions.create();

  expect((await session.view()).catalog.agents).toEqual([
    expect.objectContaining({ id: "reviewer" }),
  ]);
  expect(await session.command("review", { focus: "the parser" })).toMatchObject({ kind: "ran" });

  await until(async () => ((await session.view()).execution.kind === "idle" && fake.requests.length === 1 ? true : undefined));

  const [system, user] = fake.requests[0]?.context.messages ?? [];

  expect(system).toMatchObject({ role: "system", content: REVIEW_PROMPT });
  assert(system?.role === "system");
  expect(system.toolsAdded?.map((declared) => declared.name)).toEqual(["read", "list"]);
  expect(user).toMatchObject({ role: "user", content: expect.stringContaining("focusing on the parser") });
  expect((await session.view()).messages[0]).toMatchObject({ kind: "user", source: { kind: "action", label: "Review changes" } });
});
