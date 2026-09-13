import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";
import { createModels } from "../src/models.ts";
import { githubCopilotProvider } from "../src/providers/github-copilot.ts";
import { parseGitHubCopilotCatalog } from "../src/providers/github-copilot-catalog.ts";
import {
  EXCHANGE,
  MODELS,
  ORIGIN,
  SESSION_TOKEN,
  TOKEN,
  copilotModels,
  fakeFetch,
  interaction,
  json,
  sessionToken,
  signIn,
} from "./github-copilot-fixture.ts";

const listedModel = (id: string) => ({ id, model_picker_enabled: true });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GitHub Copilot account availability", () => {
  test("accepts account IDs without endpoints, limits, billing, or capability metadata", () => {
    assert.deepEqual(
      parseGitHubCopilotCatalog(
        { data: [listedModel("gemini-3.8-flash"), listedModel("claude-sonnet-4.6")] },
        ORIGIN,
      ),
      {
        availableModelIds: ["gemini-3.8-flash", "claude-sonnet-4.6"],
        needsApproval: false,
      },
    );
  });

  test("respects disabled policies, hidden models, and explicit lack of tools", () => {
    const parsed = parseGitHubCopilotCatalog(
      {
        data: [
          listedModel("gemini-3.8-flash"),
          { ...listedModel("disabled"), policy: { state: "disabled" } },
          { id: "hidden", model_picker_enabled: false, policy: { state: "enabled" } },
          { ...listedModel("no-tools"), capabilities: { supports: { tool_calls: false } } },
          { ...listedModel("claude-sonnet-4.6"), policy: { state: "unconfigured" } },
          { ...listedModel("unknown-policy-model"), policy: { state: "unconfigured" } },
          "garbage",
          { id: 42 },
          listedModel("gemini-3.8-flash"),
        ],
      },
      ORIGIN,
    );
    assert.deepEqual(parsed, {
      availableModelIds: ["gemini-3.8-flash"],
      needsApproval: true,
    });
  });

  test("falls back only to explicit enabled policies on Individual when every picker flag is false", () => {
    const raw = {
      data: [
        { id: "gemini-3.8-flash", model_picker_enabled: false, policy: { state: "enabled" } },
        { id: "unconfirmed", model_picker_enabled: false },
        { id: "disabled", model_picker_enabled: false, policy: { state: "disabled" } },
      ],
    };
    assert.deepEqual(parseGitHubCopilotCatalog(raw, ORIGIN).availableModelIds, [
      "gemini-3.8-flash",
    ]);
    assert.deepEqual(
      parseGitHubCopilotCatalog(raw, "https://api.business.githubcopilot.com").availableModelIds,
      [],
    );
  });

  test("malformed availability metadata cannot authorize a model or discard valid peers", () => {
    const catalog = parseGitHubCopilotCatalog(
      {
        data: [
          listedModel("claude-sonnet-4.6"),
          { id: "wrong-picker", model_picker_enabled: "true" },
          { ...listedModel("wrong-policy"), policy: { state: false } },
          { ...listedModel("wrong-tools"), capabilities: { supports: { tool_calls: "true" } } },
        ],
      },
      ORIGIN,
    );
    assert.deepEqual(catalog.availableModelIds, ["claude-sonnet-4.6"]);
  });

  test("an actual empty list is valid, but a malformed list fails discovery", () => {
    assert.deepEqual(parseGitHubCopilotCatalog({ data: [] }, ORIGIN).availableModelIds, []);
    assert.throws(() => parseGitHubCopilotCatalog({ models: [] }, ORIGIN), /not a model list/);
  });
});

describe("GitHub Copilot generated provider", () => {
  test("has baked definitions without signing in but makes none available", async () => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    const transport = fakeFetch({});
    const models = createModels();
    models.setProvider(githubCopilotProvider({ fetch: transport.fetch }));
    assert.ok(models.getModel("github-copilot", "gemini-3.8-flash"));
    assert.ok(models.getModel("github-copilot", "claude-sonnet-4.6"));
    assert.deepEqual(await models.getAvailable("github-copilot"), []);
    assert.equal(await models.checkAuth("github-copilot"), undefined);
    await models.refresh({ providers: ["github-copilot"] });
    assert.equal(transport.requests.length, 0);
  });

  test("login immediately publishes only account models, with routes supplied by generated definitions", async () => {
    const setup = copilotModels({
      [MODELS]: () =>
        json({
          data: [
            listedModel("gemini-3.8-flash"),
            listedModel("gpt-5.5"),
            listedModel("claude-sonnet-4.6"),
            listedModel("unknown-model"),
          ],
        }),
    });
    await signIn(setup.models);
    const available = await setup.models.getAvailable("github-copilot");
    assert.deepEqual(
      available
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((model) => [model.id, model.api]),
      [
        ["claude-sonnet-4.6", "anthropic-messages"],
        ["gemini-3.8-flash", "openai-completions"],
        ["gpt-5.5", "openai-responses"],
      ],
    );
    const stored = await setup.credentials.read("github-copilot");
    assert.equal(stored?.type, "oauth");
    if (stored?.type !== "oauth") throw new Error("Expected OAuth credential");
    assert.equal(stored.access, SESSION_TOKEN);
    assert.equal(stored.refresh, "gh-token");
    const catalog = setup.requests.find((request) => request.url.endsWith("/models"));
    assert.equal(catalog?.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
    assert.ok(available.every((model) => model.contextWindow > 0 && model.maxTokens > 0));
  });

  test("restores availability from the credential offline, not from an account model cache", async () => {
    const setup = copilotModels({
      [MODELS]: () => json({ data: [listedModel("gemini-3.8-flash")] }),
    });
    await signIn(setup.models);
    const transport = fakeFetch({});
    const restarted = createModels({ credentials: setup.credentials });
    restarted.setProvider(githubCopilotProvider({ fetch: transport.fetch }));
    await restarted.refresh({ allowNetwork: false });
    assert.deepEqual(
      (await restarted.getAvailable("github-copilot")).map((model) => model.id),
      ["gemini-3.8-flash"],
    );
    assert.equal(transport.requests.length, 0);
  });

  test("malformed stored account IDs do not expose generated subscription models", async () => {
    const setup = copilotModels({});
    await signIn(setup.models);
    await setup.credentials.modify("github-copilot", async (credential) =>
      credential?.type === "oauth" ? { ...credential, availableModelIds: [42] } : undefined,
    );
    assert.deepEqual(await setup.models.getAvailable("github-copilot"), []);
  });

  test("account changes and logout cannot retain the previous account's availability", async () => {
    let account = 0;
    const setup = copilotModels({
      [TOKEN]: () => json({ access_token: `github-${++account}` }),
      [MODELS]: () =>
        json({ data: [listedModel(account === 1 ? "gemini-3.8-flash" : "claude-sonnet-4.6")] }),
    });
    await signIn(setup.models);
    assert.deepEqual(
      (await setup.models.getAvailable("github-copilot")).map((model) => model.id),
      ["gemini-3.8-flash"],
    );
    await signIn(setup.models);
    assert.deepEqual(
      (await setup.models.getAvailable("github-copilot")).map((model) => model.id),
      ["claude-sonnet-4.6"],
    );
    await setup.models.logout("github-copilot");
    assert.equal(await setup.credentials.read("github-copilot"), undefined);
    assert.deepEqual(await setup.models.getAvailable("github-copilot"), []);
  });

  test("concurrent requests refresh once under the credential lock and replace account availability", async () => {
    let exchanges = 0;
    let discovery = 0;
    const setup = copilotModels({
      [EXCHANGE]: () =>
        sessionToken(`tid=${++exchanges};proxy-ep=proxy.individual.githubcopilot.com`),
      [MODELS]: () => json({ data: ++discovery === 1 ? [listedModel("gemini-3.8-flash")] : [] }),
    });
    await signIn(setup.models);
    await setup.credentials.modify("github-copilot", async (stored) =>
      stored?.type === "oauth" ? { ...stored, expires: Date.now() + 60_000 } : undefined,
    );
    const resolved = await Promise.all([
      setup.models.getAuth("github-copilot"),
      setup.models.getAuth("github-copilot"),
    ]);
    assert.equal(exchanges, 2);
    assert.equal(discovery, 2);
    assert.equal(resolved[0]?.auth.apiKey, resolved[1]?.auth.apiKey);
    assert.equal(resolved[0]?.auth.apiKey, "tid=2;proxy-ep=proxy.individual.githubcopilot.com");
    assert.deepEqual(await setup.models.getAvailable("github-copilot"), []);
    assert.equal(
      setup.requests.filter((request) => request.url.endsWith("/device/code")).length,
      1,
    );
  });

  test("failed discovery during login never persists a partial credential", async () => {
    const setup = copilotModels({
      [MODELS]: () => new Response("gh-token secret", { status: 503 }),
    });
    await assert.rejects(signIn(setup.models), /catalog request failed \(HTTP 503\)/);
    assert.equal(await setup.credentials.read("github-copilot"), undefined);
    assert.deepEqual(await setup.models.getAvailable("github-copilot"), []);
  });

  test("cancellation during account discovery cannot persist a late login", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const reply = Promise.withResolvers<Response>();
    const entered = Promise.withResolvers<void>();
    const setup = copilotModels({
      [MODELS]: () => {
        entered.resolve();
        return reply.promise;
      },
    });
    const controller = new AbortController();
    const login = setup.models.login("github-copilot", "oauth", interaction(controller.signal));
    const cancelled = assert.rejects(login);
    await vi.advanceTimersByTimeAsync(1000);
    await entered.promise;
    controller.abort();
    await cancelled;
    reply.resolve(json({ data: [listedModel("claude-sonnet-4.6")] }));
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(await setup.credentials.read("github-copilot"), undefined);
    assert.deepEqual(await setup.models.getAvailable("github-copilot"), []);
  });

  test("failed refresh preserves the last complete credential and never falls back to another token", async () => {
    let discovery = 0;
    const setup = copilotModels({
      [MODELS]: () =>
        ++discovery === 1
          ? json({ data: [listedModel("gemini-3.8-flash")] })
          : new Response("secret", { status: 503 }),
    });
    await signIn(setup.models);
    await setup.credentials.modify("github-copilot", async (stored) =>
      stored?.type === "oauth" ? { ...stored, expires: 0 } : undefined,
    );
    const before = await setup.credentials.read("github-copilot");
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "ambient-token");
    await assert.rejects(setup.models.getAuth("github-copilot"), /catalog request failed/);
    assert.deepEqual(await setup.credentials.read("github-copilot"), before);
  });

  test("headless hosts can supply a bearer token without interactive OAuth", async () => {
    const setup = copilotModels({});
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "injected-bearer");
    assert.equal((await setup.models.checkAuth("github-copilot"))?.type, "api_key");
    assert.equal((await setup.models.getAuth("github-copilot"))?.auth.apiKey, "injected-bearer");
    assert.ok((await setup.models.getAvailable("github-copilot")).length > 0);
    assert.equal(setup.requests.length, 0);
  });
});
