import assert from "node:assert/strict";
import type { ModelInfo } from "@nyte-ai/protocol";
import { test } from "vitest";
import { serverCatalog } from "./server-connection.ts";

const model: ModelInfo = {
  id: "gpt-fixture",
  provider: "openai",
  name: "GPT Fixture",
  contextWindow: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  thinkingLevels: ["off"],
};

test("a server without a default model still yields a catalog of its models", () => {
  const catalog = serverCatalog([model], undefined);

  assert.equal(catalog.defaults, undefined);
  assert.deepEqual(
    catalog.models.map((entry) => entry.key),
    ["openai/gpt-fixture"],
  );
});

test("a server's default model becomes the catalog default", () => {
  assert.deepEqual(serverCatalog([model], model).defaults, {
    model: { provider: "openai", id: "gpt-fixture" },
    thinkingLevel: "off",
    fast: false,
  });
});
