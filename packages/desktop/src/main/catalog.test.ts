import assert from "node:assert/strict";
import { test } from "vitest";
import { createModels, InMemoryCredentialStore } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/ai";
import { readCatalog } from "./catalog.ts";
import { EMPTY_MODEL_PREFERENCES } from "./model-preferences.ts";

const PROVIDER_ID = "oauth-fixture";

function fixtureModel(id: string, name: string): Model<Api> {
  return {
    id,
    name,
    api: "openai-responses",
    provider: PROVIDER_ID,
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1_000,
  };
}

const blocked = fixtureModel("blocked", "Blocked");
const allowed = fixtureModel("allowed", "Allowed");

async function fixtureCatalog(availableModelIds?: readonly string[]) {
  const credentials = new InMemoryCredentialStore();
  if (availableModelIds !== undefined) {
    await credentials.modify(PROVIDER_ID, async () => ({
      type: "oauth",
      refresh: "fixture-refresh",
      access: "fixture-access",
      expires: Date.now() + 60_000,
      availableModelIds: [...availableModelIds],
    }));
  }
  const models = createModels({ credentials });
  models.setProvider({
    id: PROVIDER_ID,
    name: "OAuth fixture",
    auth: {
      oauth: {
        name: "Fixture subscription",
        login: () => Promise.reject(new Error("The catalog test does not log in")),
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [blocked, allowed],
    filterModels: (definitions, credential) => {
      if (credential?.type !== "oauth" || !Array.isArray(credential.availableModelIds)) return [];
      const ids = new Set(credential.availableModelIds.filter((id) => typeof id === "string"));
      return definitions.filter((model) => ids.has(model.id));
    },
    stream: () => {
      throw new Error("The catalog test does not stream");
    },
    streamSimple: () => {
      throw new Error("The catalog test does not stream");
    },
  });
  return models;
}

test("the desktop catalog lists and selects only models allowed by the OAuth credential", async () => {
  const models = await fixtureCatalog([allowed.id]);
  const result = await readCatalog(models, {
    providers: {},
    defaults: { model: { provider: PROVIDER_ID, id: blocked.id } },
  });

  assert.deepEqual(
    result.catalog.models.map((model) => [model.id, model.listed]),
    [
      [blocked.id, false],
      [allowed.id, true],
    ],
  );
  assert.deepEqual(result.catalog.defaults.model, { provider: PROVIDER_ID, id: allowed.id });
  assert.equal(result.defaultModel, allowed);
});

test("a disconnected provider keeps its static definitions available for browsing", async () => {
  const result = await readCatalog(await fixtureCatalog(), EMPTY_MODEL_PREFERENCES);

  assert.deepEqual(
    result.catalog.models.map((model) => [model.id, model.listed]),
    [
      [blocked.id, false],
      [allowed.id, false],
    ],
  );
  assert.deepEqual(result.catalog.defaults.model, { provider: PROVIDER_ID, id: blocked.id });
});

test("an empty account catalog keeps Settings reachable without listing unavailable models", async () => {
  const result = await readCatalog(await fixtureCatalog([]), EMPTY_MODEL_PREFERENCES);
  assert.equal(result.catalog.models.length, 2);
  assert.ok(result.catalog.models.every((model) => !model.listed));
  assert.deepEqual(result.catalog.defaults.model, { provider: PROVIDER_ID, id: blocked.id });
});
