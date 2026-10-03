/**
 * Based on https://github.com/earendil-works/pi/blob/main/packages/ai/test/oauth-auth.test.ts
 * Synced with pi a276dabe5.
 */
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import { createModels } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import { githubCopilotProvider } from "../src/providers/github-copilot.ts";

function createAccessToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64");
  return `${header}.${payload}.signature`;
}

describe("OAuthAuth adapters", () => {
  it("openai-codex toAuth derives the api key from the access token", async () => {
    const access = createAccessToken("account-123");
    const auth = await openaiCodexOAuth.toAuth({ type: "oauth", access, refresh: "r", expires: 0 });
    expect(auth).toEqual({ apiKey: access, headers: { "chatgpt-account-id": "account-123" } });
  });
});

describe("OAuth through Models.getAuth (lazy load chain)", () => {
  it("resolves stored anthropic oauth credentials via the lazy flow import", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("anthropic", async () => ({
      type: "oauth",
      access: "oauth-access-token",
      refresh: "r",
      // Keep this beyond getAuth()'s refresh window.
      expires: Date.now() + 10 * 60_000,
    }));
    const models = createModels({ credentials });
    models.setProvider(anthropicProvider());

    const result = await models.getAuth("anthropic");
    expect(result?.auth.apiKey).toBe("oauth-access-token");
    expect(result?.source).toBe("OAuth");
  });

  it("resolves stored github-copilot oauth credentials including per-credential baseUrl", async () => {
    const access = "tid=abc;exp=123;proxy-ep=proxy.business.githubcopilot.com;rest";
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("github-copilot", async () => ({
      type: "oauth",
      access,
      refresh: "r",
      // Keep this beyond getAuth()'s refresh window.
      expires: Date.now() + 10 * 60_000,
      availableModelIds: [],
    }));
    const models = createModels({ credentials });
    models.setProvider(githubCopilotProvider());

    const result = await models.getAuth("github-copilot");
    expect(result?.auth.apiKey).toBe(access);
    expect(result?.auth.baseUrl).toBe("https://api.business.githubcopilot.com");
  });
});
