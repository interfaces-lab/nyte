import { describe, expect, it } from "vitest";
import { storedAccounts } from "./credential-fixture.ts";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { ApiKeyAuth } from "../src/auth/types.ts";
import { calculateCost, createModels, createProvider } from "../src/models.ts";
import {
  InMemoryModelsStore,
  type ModelsStore,
  type ModelsStoreEntry,
} from "../src/models-store.ts";
import type { Usage } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import {
  testModel,
  type ProviderCall,
  testProvider,
  context,
  envKeyAuth,
  testOAuth,
} from "./models-fixture.ts";

describe("Models runtime", () => {
  it("enumerates credential metadata without exposing secrets", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("api-provider", async () =>
      storedAccounts({ type: "api_key", key: "secret" }),
    );
    await credentials.modify("oauth-provider", async () =>
      storedAccounts({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      }),
    );

    expect(await credentials.list()).toEqual([
      {
        providerId: "api-provider",
        type: "api_key",
        id: "default",
        label: "Default",
        active: true,
      },
      {
        providerId: "oauth-provider",
        type: "oauth",
        id: "default",
        label: "Default",
        active: true,
      },
    ]);
  });

  it("caches account usage before resolving auth and invalidates after account selection", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("p1", async () => ({
      active: "personal",
      accounts: [
        { id: "personal", label: "Personal", credential: { type: "api_key", key: "personal-key" } },
        { id: "work", label: "Work", credential: { type: "api_key", key: "work-key" } },
      ],
    }));
    let resolutions = 0;
    const requested: (string | undefined)[] = [];
    const models = createModels({ credentials });
    models.setProvider(
      testProvider({
        id: "p1",
        auth: {
          apiKey: {
            name: "Stored key",
            resolve: async ({ credential }) => {
              resolutions += 1;

              return credential ? { auth: { apiKey: credential.key } } : undefined;
            },
          },
        },
        fetchAccountLimits: async ({ auth }) => {
          requested.push(auth.apiKey);

          return {
            providerId: "p1",
            observedAt: Date.now(),
            windows: [
              {
                id: "five_hour",
                label: "5-hour",
                usedPercent: auth.apiKey === "personal-key" ? 20 : 80,
              },
            ],
          };
        },
      }),
    );

    const first = await models.fetchAccountLimits("p1");
    expect(await models.fetchAccountLimits("p1")).toEqual(first);
    expect(resolutions).toBe(1);
    expect(requested).toEqual(["personal-key"]);
    await models.selectAccount("p1", "work");
    expect(models.getAccountLimits("p1")).toBeUndefined();
    expect(await models.fetchAccountLimits("p1")).toMatchObject({
      kind: "ready",
      stale: false,
      limits: { windows: [{ usedPercent: 80 }] },
    });
    expect(resolutions).toBe(2);
    expect(requested).toEqual(["personal-key", "work-key"]);
    expect(models.getAccountLimits("p1", "personal")).toBeUndefined();

    const calls: ProviderCall[] = [];
    models.setProvider(testProvider({ id: "p1", calls, auth: { apiKey: envKeyAuth(undefined) } }));
    await models.completeSimple(testModel("p1", "model-a"), context);
    await calls[0]?.options?.onAccountLimits?.(
      {
        providerId: "p1",
        observedAt: Date.now(),
        windows: [{ id: "five_hour", label: "5-hour", usedPercent: 85 }],
      },
      testModel("p1", "model-a"),
    );
    expect(await models.fetchAccountLimits("p1")).toMatchObject({
      kind: "ready",
      limits: { windows: [{ usedPercent: 85 }] },
    });
  });

  it("applies request-wide pricing tiers above the configured input threshold", () => {
    const model = testModel("openai", "gpt-5.6-sol");
    model.cost = {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      tiers: [
        {
          inputTokensAbove: 272000,
          input: 10,
          output: 45,
          cacheRead: 1,
          cacheWrite: 12.5,
        },
      ],
    };
    const createUsage = (cacheWrite: number): Usage => ({
      input: 200000,
      output: 100000,
      cacheRead: 72000,
      cacheWrite,
      totalTokens: 372000 + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });

    const short = calculateCost(model, createUsage(0));
    expect(short).toMatchObject({ input: 1, output: 3, cacheRead: 0.036, cacheWrite: 0 });

    const long = calculateCost(model, createUsage(1));
    expect(long.input).toBe(2);
    expect(long.output).toBe(4.5);
    expect(long.cacheRead).toBe(0.072);
    expect(long.cacheWrite).toBe(0.0000125);
  });

  it("swallows provider source failures for both all-provider and single-provider listing", () => {
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "broken",
        getModels: () => {
          throw new Error("boom");
        },
      }),
    );
    models.setProvider(testProvider({ id: "ok", models: [testModel("ok", "m1")] }));

    expect(models.getModels().map((m) => m.id)).toEqual(["m1"]);
    expect(models.getModels("broken")).toEqual([]);
    expect(() => models.getProvider("broken")?.getModels()).toThrow("boom");
  });

  it("refresh() updates every configured dynamic provider and reports failures", async () => {
    let list = [testModel("dyn", "before")];
    let refreshes = 0;
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "dyn",
        getModels: () => list,
        refreshModels: async (refresh) => {
          if (!refresh.allowNetwork) return;
          refreshes++;
          await refresh.publish({
            update: () => {
              list = [testModel("dyn", "after")];
            },
          });
        },
      }),
    );
    models.setProvider(testProvider({ id: "static", models: [testModel("static", "s1")] }));

    expect(models.getModel("dyn", "before")).toBeDefined();
    const first = await models.refresh();
    expect(first.errors.size).toBe(0);
    expect(refreshes).toBe(1);
    expect(models.getModel("dyn", "after")).toBeDefined();
    expect(models.getModel("dyn", "before")).toBeUndefined();

    models.setProvider(
      testProvider({
        id: "flaky",
        refreshModels: async (input) => {
          if (input.allowNetwork) throw new Error("fetch failed");
        },
      }),
    );
    const second = await models.refresh();
    expect(refreshes).toBe(2);
    expect(second.errors.get("flaky")?.message).toBe("fetch failed");
  });

  it("restricts refresh work to selected providers", async () => {
    const calls: string[] = [];
    const models = createModels();
    for (const id of ["one", "two"]) {
      models.setProvider(
        testProvider({
          id,
          refreshModels: async (input) => {
            calls.push(`${id}:${input.allowNetwork ? "network" : "cache"}`);
          },
        }),
      );
    }

    const result = await models.refresh({ providers: ["two", "unknown"] });

    expect(result.errors.size).toBe(0);
    expect(calls).toEqual(["two:cache", "two:network"]);
  });

  it("restores cached models before waiting for network auth", async () => {
    const store = new InMemoryModelsStore();
    await store.write("dynamic", { models: [testModel("dynamic", "cached")] });
    let markAuthStarted: (() => void) | undefined;
    let finishAuth: (() => void) | undefined;
    const authStarted = new Promise<void>((resolve) => {
      markAuthStarted = resolve;
    });
    const blockedAuth = new Promise<void>((resolve) => {
      finishAuth = resolve;
    });
    const provider = createProvider<"test-api">({
      id: "dynamic",
      auth: {
        apiKey: {
          name: "Blocked auth",
          resolve: async () => {
            markAuthStarted?.();
            await blockedAuth;
            return { auth: { apiKey: "key" } };
          },
        },
      },
      api: {
        stream: () => new AssistantMessageEventStream(),
        streamSimple: () => new AssistantMessageEventStream(),
      },
    });
    const models = createModels({ modelsStore: store });
    models.setProvider(provider);
    const controller = new AbortController();
    const pending = models.refresh({ providers: ["dynamic"], signal: controller.signal });
    await authStarted;

    expect(models.getModel("dynamic", "cached")).toBeDefined();
    controller.abort();
    expect(await pending).toMatchObject({ aborted: true });
    finishAuth?.();
  });

  it("lets providers choose persistent deletion and ephemeral publication atomically", async () => {
    let entry: ModelsStoreEntry | undefined = { models: [testModel("dynamic", "stored")] };
    const store: ModelsStore = {
      read: async () => entry,
      write: async (_providerId, next) => {
        entry = next;
      },
      delete: async () => {
        entry = undefined;
      },
    };
    let state = "initial";
    const models = createModels({ modelsStore: store });
    models.setProvider(
      testProvider({
        id: "dynamic",
        refreshModels: async (context) => {
          expect(context.stored?.models).toEqual([testModel("dynamic", "stored")]);
          await context.publish({
            persist: null,
            update: () => {
              expect(entry).toBeUndefined();
              state = "deleted";
            },
          });
          await context.publish({
            update: () => {
              state = "ephemeral";
            },
          });
        },
      }),
    );

    const result = await models.refresh({ allowNetwork: false });

    expect(result.errors.size).toBe(0);
    expect(entry).toBeUndefined();
    expect(state).toBe("ephemeral");
  });

  it("passes effective credentials and refreshes providers without auth", async () => {
    let effectiveCredential: unknown;
    let forceRefresh: boolean | undefined;
    let unconfiguredRefreshes = 0;
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "configured",
        auth: { apiKey: envKeyAuth("ambient-key") },
        refreshModels: async (context) => {
          if (!context.allowNetwork) return;
          effectiveCredential = context.credential;
          forceRefresh = context.force;
        },
      }),
    );
    models.setProvider(
      testProvider({
        id: "unconfigured",
        auth: { apiKey: envKeyAuth(undefined) },
        refreshModels: async (input) => {
          if (input.allowNetwork) unconfiguredRefreshes++;
        },
      }),
    );

    await models.refresh({ force: true });
    expect(effectiveCredential).toEqual({ type: "api_key", key: "ambient-key", env: undefined });
    expect(forceRefresh).toBe(true);
    expect(unconfiguredRefreshes).toBe(1);
  });

  it("refreshes expired OAuth before refreshing models", async () => {
    const credentials = new InMemoryCredentialStore();
    let modelRefreshCredential: unknown;
    await credentials.modify("oauth-dynamic", async () =>
      storedAccounts({
        type: "oauth",
        access: "expired",
        refresh: "refresh",
        expires: 0,
      }),
    );
    const models = createModels({ credentials });
    models.setProvider(
      testProvider({
        id: "oauth-dynamic",
        auth: {
          oauth: testOAuth({
            refresh: async () => ({
              type: "oauth",
              access: "fresh",
              refresh: "rotated",
              expires: Date.now() + 60_000,
            }),
          }),
        },
        refreshModels: async (context) => {
          if (context.allowNetwork) modelRefreshCredential = context.credential;
        },
      }),
    );

    expect((await models.refresh()).errors.size).toBe(0);
    expect(modelRefreshCredential).toMatchObject({
      type: "oauth",
      access: "fresh",
      refresh: "rotated",
    });
    expect(await credentials.read("oauth-dynamic")).toMatchObject({
      accounts: [{ credential: { access: "fresh", refresh: "rotated" } }],
    });
  });

  it("binds model-store waits to the provider refresh signal", async () => {
    const storageSignals: (AbortSignal | undefined)[] = [];
    const store: ModelsStore = {
      read: async (_providerId, options) => {
        storageSignals.push(options?.signal);
        return undefined;
      },
      write: async (_providerId, _entry, options) => {
        storageSignals.push(options?.signal);
      },
      delete: async (_providerId, options) => {
        storageSignals.push(options?.signal);
      },
    };
    let providerSignal: AbortSignal | undefined;
    const models = createModels({ modelsStore: store });
    models.setProvider(
      testProvider({
        id: "dynamic",
        auth: { apiKey: envKeyAuth("key") },
        refreshModels: async (context) => {
          providerSignal = context.signal;
          if (!context.allowNetwork) return;
          await context.publish({ persist: { models: [testModel("dynamic", "fresh")] } });
        },
      }),
    );

    const result = await models.refresh({ providers: ["dynamic"] });

    expect(result.errors.size).toBe(0);
    expect(result.aborted).toBe(false);
    expect(providerSignal).toBeInstanceOf(AbortSignal);
    expect(storageSignals).toHaveLength(3);
    expect(storageSignals.every((signal) => signal === providerSignal)).toBe(true);
  });

  it("stops waiting on abort when a provider ignores its signal", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    let rejectRefresh: ((error: Error) => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const stalled = new Promise<void>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    let calls = 0;
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "dynamic",
        refreshModels: async () => {
          calls++;
          if (calls !== 1) return;
          markStarted?.();
          await stalled;
        },
      }),
    );

    const pending = models.refresh({ signal: controller.signal });
    await started;
    controller.abort();

    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.errors.size).toBe(0);

    rejectRefresh?.(new Error("late provider failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.errors.size).toBe(0);
  });

  it("rejects late publication from a superseded non-cooperative provider", async () => {
    const store = new InMemoryModelsStore();
    let state = "initial";
    let calls = 0;
    let markFirstStarted: (() => void) | undefined;
    let finishFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const models = createModels({ modelsStore: store });
    models.setProvider(
      testProvider({
        id: "dynamic",
        refreshModels: async (context) => {
          if (!context.allowNetwork) return;
          calls++;
          const current = calls;
          if (current === 1) {
            markFirstStarted?.();
            await firstBlocked;
          }
          const value = `generation-${current}`;
          await context.publish({
            persist: { models: [testModel("dynamic", value)] },
            update: () => {
              state = value;
            },
          });
        },
      }),
    );

    const first = models.refresh({ providers: ["dynamic"] });
    await firstStarted;
    const second = models.refresh({ providers: ["dynamic"] });
    await second;
    await first;
    finishFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state).toBe("generation-2");
    expect((await store.read("dynamic"))?.models).toEqual([testModel("dynamic", "generation-2")]);
  });

  it("merges auth without dropping request options", async () => {
    const calls: ProviderCall[] = [];
    const apiKey: ApiKeyAuth = {
      name: "Test",
      resolve: async () => ({
        auth: {
          apiKey: "resolved-key",
          headers: { Authorization: "Bearer resolved-key", "x-a": "auth", "x-b": "auth" },
          baseUrl: "https://auth.test/v1",
        },
      }),
    };
    const models = createModels();
    models.setProvider(testProvider({ id: "p1", auth: { apiKey }, calls }));
    const model = testModel("p1", "model-a");

    const options = {
      apiKey: "explicit-key",
      headers: { authorization: "Explicit token", "x-b": "explicit" },
      temperature: 0.2,
      maxTokens: 7,
      vendor_field: { enabled: true },
    };
    const result = await models.completeSimple(model, context, options);
    expect(result.stopReason).toBe("stop");
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({
      apiKey: "explicit-key",
      temperature: 0.2,
      maxTokens: 7,
      vendor_field: { enabled: true },
    });
    expect(calls[0].options?.headers).toEqual({
      authorization: "Explicit token",
      "x-a": "auth",
      "x-b": "explicit",
    });
    expect(calls[0].model.baseUrl).toBe("https://auth.test/v1");

    const result2 = await models.completeSimple(model, context);
    expect(result2.stopReason).toBe("stop");
    expect(calls[1].options?.apiKey).toBe("resolved-key");

    await models.complete(model, context, options);
    expect(calls[2].options).toMatchObject({ apiKey: "explicit-key", temperature: 0.2 });
    expect(calls[2].options?.headers).toEqual(calls[0].options?.headers);
    expect(calls[2].model.baseUrl).toBe("https://auth.test/v1");
  });

  it("adds model headers only for model auth and transforms assembled headers once", async () => {
    const calls: ProviderCall[] = [];
    const models = createModels();
    models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("key") }, calls }));
    const model = testModel("p1", "model-a");
    model.headers = { "x-model": "model", "x-shared": "model" };

    expect((await models.getAuth("p1"))?.auth.headers).toBeUndefined();
    expect((await models.getAuth(model))?.auth.headers).toEqual({
      "x-model": "model",
      "x-shared": "model",
    });

    let transforms = 0;
    await models.completeSimple(model, context, {
      headers: { "x-explicit": "explicit", "X-Shared": "explicit" },
      transformHeaders: async (headers) => {
        transforms++;
        expect(headers).toEqual({
          "x-model": "model",
          "x-explicit": "explicit",
          "X-Shared": "explicit",
        });
        return { ...headers, "x-transformed": "yes" };
      },
    });

    expect(transforms).toBe(1);
    expect(calls[0].options?.headers).toEqual({
      "x-model": "model",
      "x-explicit": "explicit",
      "X-Shared": "explicit",
      "x-transformed": "yes",
    });
    expect(calls[0].options).not.toHaveProperty("transformHeaders");
  });

  it("produces an error stream for unknown providers instead of throwing", async () => {
    const models = createModels();
    const result = await models.completeSimple(testModel("ghost", "model-a"), context);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Unknown provider: ghost");
  });
});
