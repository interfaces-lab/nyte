import { expect, it } from "vitest";
import rename from "../src/rename.ts";
import { fakeModels, open, until } from "./fake-models.ts";

it("titles an untitled session from its first message, and a later run asks nothing", async () => {
  const fake = fakeModels();
  const title = Promise.withResolvers<void>();

  fake.reply(
    {
      after: title.promise,
      content: [{ type: "text", text: "\nTimeout for flaky fetch\nignored" }],
    },
    { content: [{ type: "text", text: "Use a 30 s timeout." }] },
    { content: [{ type: "text", text: "Done." }] },
  );

  await using host = await open(fake, [rename]);
  const { session, receipt: started } = await host.sessions.start({
    content: "Why does fetch time out?\nIt hangs on CI.",
  });

  await started.settled();
  expect((await session.info()).name).toBeNull();
  title.resolve();

  expect(await until(async () => (await session.info()).name ?? undefined)).toBe(
    "Timeout for flaky fetch",
  );
  expect(fake.requests[0]?.context.messages.at(-1)).toMatchObject({
    role: "user",
    content:
      "Here is the first message of the conversation:\n\n<message>\nWhy does fetch time out?\nIt hangs on CI.\n</message>\n\nReply with only the title.",
  });

  await (await session.send("Thanks.")).settled();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(fake.requests).toHaveLength(3);
  expect((await session.info()).name).toBe("Timeout for flaky fetch");
});
