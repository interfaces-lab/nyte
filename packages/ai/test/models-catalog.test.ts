import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyAuth } from "../src/auth/types.ts";
import { createModels, createProvider, ModelsError } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import type { FetchFunction, Model, ProviderStreams } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const auth: ApiKeyAuth = {
  name: "Test",
  resolve: async () => ({ auth: {} }),
};

const streams: ProviderStreams = {
  stream: () => new AssistantMessageEventStream(),
  streamSimple: () => new AssistantMessageEventStream(),
};

function model(id: string, api = "test-api"): Model<string> {
  return {
    id,
    name: id,
    api,
    provider: "test-provider",
    baseUrl: "https://api.example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 10_000,
    maxTokens: 1_000,
  };
}

function provider() {
  return createProvider<"test-api">({
    id: "test-provider",
    auth: { apiKey: auth },
    api: { "test-api": streams },
  });
}

function jsonResponse(value: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), { status: 200, headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted model catalogs", () => {
  it("persists validators, skips fresh checks, and revalidates with ETag when forced", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
    const requests: Request[] = [];
    const responses = [
      jsonResponse([model("first")], {
        ETag: '"catalog-v1"',
        "Last-Modified": "Tue, 31 Mar 2026 23:00:00 GMT",
      }),
      new Response(null, { status: 304 }),
    ];
    const fetch: FetchFunction = async (input, init) => {
      requests.push(new Request(input, init));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected catalog request");
      return response;
    };
    const store = new InMemoryModelsStore();
    const models = createModels({
      modelsStore: store,
      catalog: { url: "https://catalog.example.test/root/", fetch },
    });
    models.setProvider(provider());

    const first = await models.refresh({ providers: ["test-provider"] });

    expect(first.errors.size).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://catalog.example.test/root/test-provider.json");
    expect(requests[0]?.headers.get("accept")).toBe("application/json");
    expect(requests[0]?.headers.get("if-none-match")).toBeNull();
    expect(await store.read("test-provider")).toEqual({
      models: [model("first")],
      etag: '"catalog-v1"',
      lastModified: Date.parse("Tue, 31 Mar 2026 23:00:00 GMT"),
      checkedAt: Date.now(),
    });

    await models.refresh({ providers: ["test-provider"] });
    expect(requests).toHaveLength(1);

    vi.setSystemTime(new Date("2026-04-01T00:01:00.000Z"));
    const forced = await models.refresh({ providers: ["test-provider"], force: true });

    expect(forced.errors.size).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get("if-none-match")).toBe('"catalog-v1"');
    expect(models.getModels("test-provider")).toEqual([model("first")]);
    expect(await store.read("test-provider")).toEqual({
      models: [model("first")],
      etag: '"catalog-v1"',
      lastModified: Date.parse("Tue, 31 Mar 2026 23:00:00 GMT"),
      checkedAt: Date.now(),
    });
  });

  it("drops invalid, foreign, and undispatchable feed entries", async () => {
    const good = model("good");
    const foreign = { ...model("foreign"), provider: "other-provider" };
    const unsupported = model("unsupported", "unknown-api");
    const fetch: FetchFunction = async () =>
      jsonResponse([good, { id: "invalid" }, foreign, unsupported]);
    const models = createModels({ catalog: { fetch } });
    models.setProvider(provider());

    const result = await models.refresh({ providers: ["test-provider"] });

    expect(result.errors.size).toBe(0);
    expect(models.getModels("test-provider")).toEqual([good]);
  });

  it("reports HTTP failures and retains the previous catalog", async () => {
    let request = 0;
    const fetch: FetchFunction = async () => {
      request += 1;
      return request === 1
        ? jsonResponse([model("cached")])
        : new Response("sensitive body", { status: 500 });
    };
    const models = createModels({ catalog: { fetch } });
    models.setProvider(provider());
    await models.refresh({ providers: ["test-provider"] });

    const result = await models.refresh({ providers: ["test-provider"], force: true });
    const error = result.errors.get("test-provider");

    expect(error).toBeInstanceOf(ModelsError);
    if (!(error instanceof ModelsError)) throw new Error("Expected ModelsError");
    expect(error.code).toBe("model_source");
    expect(error.message).toContain("test-provider");
    expect(error.message).toContain("500");
    expect(error.message).not.toContain("sensitive body");
    expect(models.getModels("test-provider")).toEqual([model("cached")]);
  });

  it("restores stored models without network access", async () => {
    const store = new InMemoryModelsStore();
    await store.write("test-provider", {
      models: [model("stored")],
      etag: '"stored"',
      checkedAt: 1,
    });
    let requests = 0;
    const fetch: FetchFunction = async () => {
      requests += 1;
      throw new Error("Unexpected catalog request");
    };
    const models = createModels({ modelsStore: store, catalog: { fetch } });
    models.setProvider(provider());

    const result = await models.refresh({
      providers: ["test-provider"],
      allowNetwork: false,
    });

    expect(result.errors.size).toBe(0);
    expect(requests).toBe(0);
    expect(models.getModels("test-provider")).toEqual([model("stored")]);
  });

  it("stops an in-flight catalog request cleanly when aborted", async () => {
    const entered = Promise.withResolvers<void>();
    const fetch: FetchFunction = async (_input, init) => {
      entered.resolve();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected catalog signal");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const models = createModels({ catalog: { fetch } });
    models.setProvider(provider());
    const controller = new AbortController();
    const pending = models.refresh({
      providers: ["test-provider"],
      signal: controller.signal,
    });
    await entered.promise;

    controller.abort();
    const result = await pending;

    expect(result.aborted).toBe(true);
    expect(result.errors.size).toBe(0);
    expect(models.getModels("test-provider")).toEqual([]);
  });
});
