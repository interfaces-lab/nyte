import { expect, test } from "bun:test";
import { openTestHost, until } from "../fixture/host.ts";

test("the test host runs a turn against the scripted provider", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "Hello." }] });

  const session = await fixture.host.sessions.create();
  const receipt = await session.send("hi");
  const request = await fixture.requested(1);

  expect(JSON.stringify(request.context.messages)).toContain("hi");
  expect(await receipt.settled()).toMatchObject({ kind: "completed" });

  const answer = await until(async () =>
    (await session.view()).messages.find(
      (message) => message.kind === "part" && message.partKind === "text",
    ),
  );

  expect(answer).toMatchObject({ state: { markdown: "Hello." } });
});
