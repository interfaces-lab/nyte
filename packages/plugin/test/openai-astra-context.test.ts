import { expect, it } from "vitest";
import astraContext from "../src/openai-astra-context.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";

it("gives gpt-6-astra its window and threshold and leaves other models alone", async () => {
  const fake = fakeModels(
    [testModel("gpt-6-astra", { provider: "openai" }), testModel("gpt-5", { provider: "openai" })],
    "openai",
  );

  await using host = await open(fake, [astraContext]);
  const catalog = await host.models.list();
  const models = catalog.providers.find((provider) => provider.id === "openai")?.models ?? [];

  expect(models.map((model) => [model.ref.id, model.contextWindow, model.compactAt])).toEqual([
    ["gpt-6-astra", 1_000_000, 400_000],
    ["gpt-5", 100_000, 80_000],
  ]);
});
