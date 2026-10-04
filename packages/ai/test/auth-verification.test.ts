import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { openrouterProvider } from "../src/providers/openrouter.ts";
import { vercelAiGatewayProvider } from "../src/providers/vercel-ai-gateway.ts";
import type { FetchFunction } from "../src/types.ts";

const SECRET = "vck_secret_value";

function authContext(env: Record<string, string>): AuthContext {
  return { env: async (name) => env[name], fileExists: async () => false };
}

function gatewayModels(env: Record<string, string>, fetch: FetchFunction) {
  vi.stubGlobal("fetch", fetch);
  const models = createModels({ authContext: authContext(env) });
  models.setProvider(vercelAiGatewayProvider());

  return models;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyAuth", () => {
  it("accepts a credential the gateway answers for and reports its balance", async () => {
    const requests: Request[] = [];
    const models = gatewayModels({ VERCEL_OIDC_TOKEN: SECRET }, async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({ balance: "95.50", total_used: "4.50" });
    });

    await expect(models.verifyAuth("vercel-ai-gateway")).resolves.toEqual({
      ok: true,
      source: "VERCEL_OIDC_TOKEN",
      verified: true,
      detail: "balance 95.50",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://ai-gateway.vercel.sh/v1/credits",
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("reports a credential the gateway refuses as rejected", async () => {
    const models = gatewayModels(
      { AI_GATEWAY_API_KEY: SECRET },
      async () => new Response("unauthorized", { status: 401 }),
    );

    const verification = await models.verifyAuth("vercel-ai-gateway");

    expect(verification).toMatchObject({ ok: false, reason: "rejected" });
    expect(JSON.stringify(verification)).not.toContain(SECRET);
  });

  it("reports a network failure as unreachable", async () => {
    const models = gatewayModels({ AI_GATEWAY_API_KEY: SECRET }, async () => {
      throw new TypeError(`fetch failed for ${SECRET}`);
    });

    const verification = await models.verifyAuth("vercel-ai-gateway");

    expect(verification).toMatchObject({ ok: false, reason: "unreachable" });
    expect(JSON.stringify(verification)).not.toContain(SECRET);
  });

  it("reports a provider without a credential as unconfigured without calling it", async () => {
    const fetch = vi.fn<FetchFunction>();
    const models = gatewayModels({}, fetch);

    await expect(models.verifyAuth("vercel-ai-gateway")).resolves.toMatchObject({
      ok: false,
      reason: "unconfigured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("gateway catalogs", () => {
  it.each([
    ["vercel-ai-gateway", vercelAiGatewayProvider],
    ["openrouter", openrouterProvider],
  ])("serves every bundled %s model from the stored catalog", async (id, provider) => {
    const catalog: unknown = JSON.parse(
      readFileSync(new URL(`../catalog/${id}.json`, import.meta.url), "utf8"),
    );
    if (!Array.isArray(catalog)) throw new Error(`${id} catalog is not an array`);
    const modelsStore = new InMemoryModelsStore();
    await modelsStore.write(id, { models: catalog });
    const models = createModels({ modelsStore });
    models.setProvider(provider());

    const result = await models.refresh({ allowNetwork: false });

    expect(result.errors.size).toBe(0);
    expect(models.getModels(id)).toHaveLength(catalog.length);
  });
});
