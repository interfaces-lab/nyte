import { assert, expect, it } from "vitest";
import { fakeModels, open } from "../fake-models.ts";
import { until } from "../../src/harness.ts";

it("keeps a streamed text part's version moving forward when its text lands", async () => {
  const fake = fakeModels();
  const gate = Promise.withResolvers<void>();

  fake.reply({
    content: [{ type: "text", text: "The answer is forty-two." }],
    until: gate.promise,
  });
  await using host = await open(fake);
  const session = await host.sessions.create();
  const receipt = await session.send("What is the answer?");

  const streamed = await until(async () => {
    const last = (await session.view()).messages.at(-1);

    return last?.kind === "part" && JSON.stringify(last.state).includes("forty-two")
      ? last
      : undefined;
  });

  gate.resolve();
  await receipt.settled();
  const landed = (await session.view()).messages.at(-1);

  assert(landed?.kind === "part" && landed.part === streamed.part);
  expect(streamed.status.kind).toBe("live");
  expect(landed.status.kind).toBe("settled");
  expect(landed.version).toBeGreaterThan(streamed.version);
});
