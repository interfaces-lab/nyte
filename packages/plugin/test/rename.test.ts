import { expect, it } from "vitest";
import rename from "../src/rename.ts";
import { fakeModels, open, until } from "./fake-models.ts";

it("names an unnamed session from its first message, then from a title request, and a later run asks nothing", async () => {
  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "text", text: "\nTimeout for flaky fetch\nignored" }] },
    { content: [{ type: "text", text: "Use a 30 s timeout." }] },
    { content: [{ type: "text", text: "Done." }] },
  );

  await using host = await open(fake, [rename]);
  const { session, receipt: started } = await host.sessions.start({
    content: "\nWhy does fetch time out?\nIt hangs on CI.",
  });

  expect(await until(async () => (await session.info()).name ?? undefined)).toBe(
    "Why does fetch time out?",
  );
  await started.settled();

  expect(
    await until(async () => {
      const name = (await session.info()).name;

      return name === "Why does fetch time out?" ? undefined : name;
    }),
  ).toBe("Timeout for flaky fetch");
  expect(fake.requests[0]?.context.messages.at(-1)).toMatchObject({
    role: "user",
    content: "User: \nWhy does fetch time out?\nIt hangs on CI.",
  });

  await (await session.send("Thanks.")).settled();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(fake.requests).toHaveLength(3);
  expect((await session.info()).name).toBe("Timeout for flaky fetch");
});
