import { isPart, tool } from "@nyte-ai/core";
import { assert, expect, it } from "vitest";
import bashDescription from "../src/bash-description.ts";
import { fakeModels, open } from "./fake-models.ts";

it("requires a description on bash and carries it on the shell call's class", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "sh",
          name: "bash",
          arguments: { command: "ls", description: "List the project files" },
        },
      ],
    },
    { content: [{ type: "text", text: "Listed." }] },
  );

  await using host = await open(fake, [bashDescription]);
  const session = await host.sessions.create();
  await (await session.send("List.")).settled();

  const [system] = fake.requests[0]?.context.messages ?? [];

  assert(system?.role === "system");
  const bash = system.toolsAdded?.find((declared) => declared.name === "bash");

  expect(bash?.parameters).toMatchObject({ required: ["command", "description"] });

  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool));
  expect(call.state.class).toEqual({ kind: "shell", command: "ls", description: "List the project files" });
});
