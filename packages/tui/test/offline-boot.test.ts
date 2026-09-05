import assert from "node:assert/strict";
import { test } from "vitest";
import {
  anthropicProvider,
  createModels,
  InMemoryModelsStore,
  openaiCodexProvider,
  openaiProvider,
  opencodeGoProvider,
  opencodeProvider,
} from "@nyte-ai/ai";
import { defaultModel, loadProviderCatalog } from "../src/catalog.ts";

test("provider catalogs supply default models without waiting for network", async () => {
  const models = createModels();
  const requested: unknown[] = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0]) => {
      requested.push(input);
      return new Promise<Response>(() => undefined);
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  models.setProvider(openaiCodexProvider());
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(opencodeProvider({ fetch }));
  models.setProvider(opencodeGoProvider({ fetch }));

  for (const provider of models.getProviders()) {
    await loadProviderCatalog(models, provider.id);
    assert.ok(models.getModels(provider.id).length > 0, provider.id);
    assert.equal(defaultModel(models, provider.id).provider, provider.id);
  }
  assert.deepEqual(requested, []);
});

test("the boot loader restores a persisted catalog without credentials or network", async () => {
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({ modelsStore });
  const requested: unknown[] = [];
  models.setProvider(
    opencodeProvider({
      fetch: Object.assign(
        (input: Parameters<typeof globalThis.fetch>[0]) => {
          requested.push(input);
          return new Promise<Response>(() => undefined);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    }),
  );
  const baked = defaultModel(models, "opencode");
  await modelsStore.write("opencode", {
    models: [{ ...baked, id: "stored-model", name: "Stored Model" }],
  });

  await loadProviderCatalog(models, "opencode");

  assert.equal(models.getModel("opencode", "stored-model")?.name, "Stored Model");
  assert.deepEqual(requested, []);
});
