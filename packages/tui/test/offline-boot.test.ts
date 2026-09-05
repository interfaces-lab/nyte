import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createModels,
  defaultProviderAuthContext,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  opencodeProvider,
} from "@uji-ai/ai";
import type { Api, FetchFunction, Model } from "@uji-ai/ai";
import { createCliModels, defaultModel, loadProviderCatalog } from "../src/catalog.ts";

/**
 * The airplane contract: every boot, including the first one ever, must
 * produce a usable model list with zero network. Baked catalogs cover the
 * first boot, the persisted models store covers later ones, and the only
 * network freshen is the background `loadAuthenticatedModels` warm — nothing
 * on the boot path may wait for a socket. The worst network is not a refused
 * connection but a hung one — airplane wifi that accepts the TCP handshake
 * and never answers — so these tests model the network as a fetch that never
 * settles.
 */

/** The URL a fetch input names, whichever of the three shapes it arrives as. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** Records requests and never settles, like a captive portal that eats packets. */
function hangingFetch(requested: string[]): FetchFunction {
  return (input, init) =>
    new Promise((_, reject) => {
      requested.push(requestUrl(input));
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
}

function seededModel(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "opencode",
    baseUrl: "https://opencode.ai/zen/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 8_192,
  };
}

function minimalOpenCodeCatalog(): object {
  const model = {
    id: "cached-model",
    name: "Cached Model",
    tool_call: true,
    reasoning: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 100_000, output: 8_192 },
    cost: { input: 0, output: 0 },
    provider: { npm: "@ai-sdk/openai-compatible" },
  };
  return {
    opencode: { id: "opencode", models: { "cached-model": model } },
    "opencode-go": { id: "opencode-go", models: { "cached-model": model } },
  };
}

async function withTempHome(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "uji-offline-"));
  const previousHome = process.env["UJI_HOME"];
  process.env["UJI_HOME"] = directory;
  try {
    await run(directory);
  } finally {
    if (previousHome === undefined) delete process.env["UJI_HOME"];
    else process.env["UJI_HOME"] = previousHome;
    await rm(directory, { recursive: true, force: true });
  }
}

void describe("offline boot", () => {
  void test("static provider catalogs need no network", async () => {
    await withTempHome(async () => {
      const requested: string[] = [];
      const models = createCliModels({ fetch: hangingFetch(requested) });
      for (const providerId of ["openai-codex", "openai", "anthropic"]) {
        assert.ok(models.getModels(providerId).length > 0, providerId);
        assert.equal(defaultModel(models, providerId).provider, providerId);
      }
      assert.deepEqual(requested, []);
    });
  });

  void test("an offline refresh settles without touching the network", async () => {
    await withTempHome(async () => {
      const requested: string[] = [];
      const models = createCliModels({ fetch: hangingFetch(requested) });
      const result = await models.refresh({ allowNetwork: false });
      assert.deepEqual([...result.errors], []);
      assert.equal(result.aborted, false);
      assert.deepEqual(requested, []);
      assert.ok(models.getModels("openai-codex").length > 0);
    });
  });

  void test("a persisted catalog restores offline without credentials", async () => {
    // The ai layer already restores a stored catalog before any network or
    // auth work. This pins the machinery the persistent-store wiring in
    // createCliModels will stand on.
    const requested: string[] = [];
    const modelsStore = new InMemoryModelsStore();
    await modelsStore.write("opencode", { models: [seededModel("stored-model")] });
    const models = createModels({
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
      modelsStore,
    });
    models.setProvider(opencodeProvider({ fetch: hangingFetch(requested) }));
    const result = await models.refresh({ allowNetwork: false });
    assert.deepEqual([...result.errors], []);
    assert.equal(models.getModel("opencode", "stored-model")?.name, "stored-model");
    assert.deepEqual(requested, []);
  });

  void test("first boot offline: opencode ships a baked catalog", async () => {
    await withTempHome(async () => {
      const models = createCliModels({ fetch: hangingFetch([]) });
      await models.refresh({ allowNetwork: false });
      assert.ok(models.getModels("opencode").length > 0, "opencode has no baked models");
      assert.ok(models.getModels("opencode-go").length > 0, "opencode-go has no baked models");
    });
  });

  void test("boot never waits for the catalog network fetch", async () => {
    await withTempHome(async () => {
      const requested: string[] = [];
      const models = createCliModels({ fetch: hangingFetch(requested) });
      await models.login("opencode", "api_key", {
        signal: new AbortController().signal,
        prompt: async () => "test-key",
        notify() {},
      });
      // The bound is generous: the point is "settles promptly" versus "hangs
      // until the fetch does", not a latency budget.
      const outcome = await Promise.race([
        loadProviderCatalog(models, "opencode").then(() => "loaded" as const),
        delay(1_000).then(() => "hung" as const),
      ]);
      assert.equal(outcome, "loaded");
      assert.deepEqual(requested, []);
      assert.ok(models.getModels("opencode").length > 0);
    });
  });

  void test("a fetched catalog survives into the next boot", async () => {
    await withTempHome(async () => {
      const onlineFetch: FetchFunction = async () =>
        new Response(JSON.stringify(minimalOpenCodeCatalog()), {
          headers: { "content-type": "application/json" },
        });
      const firstBoot = createCliModels({ fetch: onlineFetch });
      const firstRefresh = await firstBoot.refresh({ force: true });
      assert.deepEqual([...firstRefresh.errors], []);
      assert.equal(firstBoot.getModel("opencode", "cached-model")?.name, "Cached Model");

      // Same UJI_HOME, new process as far as the catalog is concerned: the
      // second instance must restore what the first one fetched.
      const secondBoot = createCliModels({ fetch: hangingFetch([]) });
      await secondBoot.refresh({ allowNetwork: false });
      assert.equal(secondBoot.getModel("opencode", "cached-model")?.name, "Cached Model");
    });
  });
});
