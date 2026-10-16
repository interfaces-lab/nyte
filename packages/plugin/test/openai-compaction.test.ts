import type { Models } from "@nyte-ai/ai";
import type { CompactionPlan } from "@nyte-ai/schema";
import { afterEach, assert, expect, it, vi } from "vitest";
import { openaiCompaction } from "../src/openai-compaction.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";

const responses = testModel("gpt-test", {
  provider: "openai",
  api: "openai-responses",
  baseUrl: "https://openai.test/v1",
});

const models: Pick<Models, "getModel" | "getAuth"> = {
  getModel: (provider, id) => (provider === "openai" && id === "gpt-test" ? responses : undefined),
  getAuth: async () => ({ auth: { apiKey: "sk-test" }, source: "test" }),
};

const plan: CompactionPlan = {
  model: { provider: "openai", id: "gpt-test" },
  reason: "threshold",
  instructions: null,
  tokensBefore: 90_000,
  summarise: [{ role: "user", content: "Long history.", timestamp: 1 }],
  keep: [],
  result: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("supplies the compact endpoint's window as material for an OpenAI Responses model, and leaves other models to core", async () => {
  const sent: string[] = [];

  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    sent.push(String(input instanceof Request ? input.url : input));

    return Response.json({
      output: [{ type: "compaction", encrypted_content: "opaque" }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    });
  });

  const plugin = openaiCompaction(models);
  await using host = await open(fakeModels(), [plugin]);
  const session = await host.sessions.create();
  const runtime = host.kernel.plugins.runtime(session.id);
  await runtime.ready;
  const api = runtime.api("openai-compaction");
  const handler = plugin.hooks?.before_compaction;

  assert(api !== undefined && typeof handler === "function");
  const context = {
    api,
    signal: new AbortController().signal,
    session: session.id,
    head: null,
    run: null,
  };

  expect(await handler(plan, context)).toMatchObject({
    result: {
      kind: "material",
      provider: "openai",
      api: "openai-responses",
      model: "gpt-test",
      data: [{ type: "compaction", encrypted_content: "opaque" }],
      usage: { input: 100, output: 10, total: 110, reasoning: 0 },
    },
  });
  expect(sent).toEqual(["https://openai.test/v1/responses/compact"]);

  const other = { ...plan, model: { provider: "test", id: "model" } };

  expect(await handler(other, context)).toBe(other);
});
