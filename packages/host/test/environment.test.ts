import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { NyteClosed } from "@nyte-ai/core";
import type { LoginAttempt, ProviderCatalog } from "@nyte-ai/protocol";
import {
  createProviderEnvironment,
  type ProviderEnvironmentOptions,
  type ProviderEnvironmentService,
} from "../src/environment.ts";

const catalog: ProviderCatalog = { source: "local", providers: [], models: [] };

const services: ProviderEnvironmentService[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(services.splice(0).map((service) => service.close()));
});

function environment(overrides: Partial<ProviderEnvironmentOptions>): ProviderEnvironmentService {
  const service = createProviderEnvironment({
    catalog: async () => catalog,
    setPreference: async () => undefined,
    usage: () => Promise.reject(new Error("unused")),
    accountLimits: async () => [],
    login: async () => undefined,
    refresh: async () => true,
    logout: async () => undefined,
    ...overrides,
  });

  services.push(service);

  return service;
}

function ended(service: ProviderEnvironmentService, attempt: string): Promise<LoginAttempt> {
  return vi.waitFor(async () => {
    const state = await service.operations["environment.loginAttempt"]({ attempt });

    assert.notEqual(state.kind, "running");

    return state;
  });
}

const browser = { kind: "browser" } as const;

test("an API key answers the secret prompt, and a known attempt ID answers that attempt", async () => {
  const flows: string[] = [];

  const service = environment({
    login: async (provider, type, interaction) => {
      flows.push(
        `${provider} ${type} ${await interaction.prompt({ type: "secret", message: "Key" })}`,
      );
    },
  });

  const input = {
    provider: "openai",
    method: { kind: "api_key", key: "sk-1" },
    attempt: "a1",
  } as const;

  assert.deepEqual(await service.operations["environment.login"](input), { kind: "running" });

  const settled = await ended(service, "a1");

  assert.deepEqual(settled, {
    kind: "settled",
    outcome: { kind: "connected", catalogRefreshed: true },
  });
  assert.deepEqual(await service.operations["environment.login"](input), settled);
  assert.deepEqual(flows, ["openai api_key sk-1"]);
});

test("a browser sign-in shows its link while it accepts a pasted code", async () => {
  const answers: string[] = [];

  const service = environment({
    login: async (_provider, _type, interaction) => {
      answers.push(
        await interaction.prompt({
          type: "select",
          message: "Sign in with",
          options: [{ id: "browser", label: "Browser" }],
        }),
      );
      interaction.notify({ type: "auth_url", url: "https://auth.example/start" });
      answers.push(await interaction.prompt({ type: "manual_code", message: "Paste the code" }));
    },
  });

  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a1",
  });

  await vi.waitFor(async () => {
    assert.deepEqual(await service.operations["environment.loginAttempt"]({ attempt: "a1" }), {
      kind: "running",
      browser: { url: "https://auth.example/start", instructions: undefined, acceptsCode: true },
    });
  });

  await service.operations["environment.answerLogin"]({ attempt: "a1", code: "code-1" });

  assert.deepEqual(await ended(service, "a1"), {
    kind: "settled",
    outcome: { kind: "connected", catalogRefreshed: true },
  });
  assert.deepEqual(answers, ["browser", "code-1"]);
});

test("a saved credential is connected when the model refresh after it fails", async () => {
  const service = environment({ refresh: () => Promise.reject(new Error("offline")) });

  await service.operations["environment.login"]({
    provider: "openai",
    method: browser,
    attempt: "a1",
  });

  assert.deepEqual(await ended(service, "a1"), {
    kind: "settled",
    outcome: { kind: "connected", catalogRefreshed: false },
  });
});

test("a flow that fails or needs a terminal prompt ends failed", async () => {
  const service = environment({
    login: async (provider, _type, interaction) => {
      if (provider === "broken") throw new Error("upstream said no");
      await interaction.prompt({ type: "text", message: "Account name" });
    },
  });

  await service.operations["environment.login"]({
    provider: "broken",
    method: browser,
    attempt: "a1",
  });
  await service.operations["environment.login"]({
    provider: "prompting",
    method: browser,
    attempt: "a2",
  });

  assert.deepEqual(await ended(service, "a1"), { kind: "failed" });
  assert.deepEqual(await ended(service, "a2"), { kind: "failed" });
});

test("cancelling ends a flow waiting for its code", async () => {
  const service = environment({
    login: async (_provider, _type, interaction) => {
      await interaction.prompt({ type: "manual_code", message: "Paste the code" });
    },
  });

  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a1",
  });
  await service.operations["environment.cancelLogin"]({ attempt: "a1" });

  assert.deepEqual(await ended(service, "a1"), { kind: "settled", outcome: { kind: "cancelled" } });
});

test("an owner's abort cancels the attempts it started and no others, all on the shared registry", async () => {
  const service = environment({
    login: async (_provider, _type, interaction) => {
      await interaction.prompt({ type: "manual_code", message: "Paste the code" });
    },
  });

  const owner = new AbortController();
  const owned = service.owned(owner.signal);

  await owned["environment.login"]({ provider: "anthropic", method: browser, attempt: "a1" });
  await service.operations["environment.login"]({
    provider: "openai",
    method: browser,
    attempt: "a2",
  });

  assert.deepEqual(await service.operations["environment.loginAttempt"]({ attempt: "a1" }), {
    kind: "running",
  });
  owner.abort();

  assert.deepEqual(await ended(service, "a1"), { kind: "settled", outcome: { kind: "cancelled" } });
  assert.deepEqual(await service.operations["environment.loginAttempt"]({ attempt: "a2" }), {
    kind: "running",
  });
  assert.deepEqual(await owned["environment.loginAttempt"]({ attempt: "a2" }), {
    kind: "running",
  });
});

test("a new attempt for the provider starts once the one it supersedes has stopped", async () => {
  const events: string[] = [];
  let flows = 0;

  const service = environment({
    login: async (_provider, _type, interaction) => {
      const flow = ++flows;

      events.push(`start ${flow}`);

      try {
        if (flow === 1)
          await interaction.prompt({ type: "manual_code", message: "Paste the code" });
      } finally {
        events.push(`stop ${flow}`);
      }
    },
  });

  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a1",
  });
  await vi.waitFor(() => assert.deepEqual(events, ["start 1"]));
  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a2",
  });

  assert.deepEqual(await ended(service, "a1"), { kind: "settled", outcome: { kind: "cancelled" } });
  assert.deepEqual(await ended(service, "a2"), {
    kind: "settled",
    outcome: { kind: "connected", catalogRefreshed: true },
  });
  assert.deepEqual(events, ["start 1", "stop 1", "start 2", "stop 2"]);
});

test("logout deletes the credential only after a running sign-in has stopped", async () => {
  const events: string[] = [];

  const service = environment({
    login: async (_provider, _type, interaction) => {
      await interaction
        .prompt({ type: "manual_code", message: "Paste the code" })
        .finally(() => events.push("flow stopped"));
    },
    logout: async (provider) => {
      events.push(`logout ${provider}`);
    },
  });

  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a1",
  });
  await service.operations["environment.logout"]({ provider: "anthropic" });

  assert.deepEqual(events, ["flow stopped", "logout anthropic"]);
});

test("a preference change answers with the catalog read after it", async () => {
  const events: string[] = [];

  const service = environment({
    setPreference: async (change) => {
      events.push(`set ${change.kind}`);
    },
    catalog: async () => {
      events.push("read");

      return catalog;
    },
  });

  const answer = await service.operations["environment.setPreference"]({
    kind: "provider",
    provider: "openai",
    enabled: false,
  });

  assert.equal(answer, catalog);
  assert.deepEqual(events, ["set provider", "read"]);
});

test("close cancels running sign-ins and refuses new ones", async () => {
  const service = environment({
    login: async (_provider, _type, interaction) => {
      await interaction.prompt({ type: "manual_code", message: "Paste the code" });
    },
  });

  await service.operations["environment.login"]({
    provider: "anthropic",
    method: browser,
    attempt: "a1",
  });
  await service.close();

  assert.deepEqual(await service.operations["environment.loginAttempt"]({ attempt: "a1" }), {
    kind: "settled",
    outcome: { kind: "cancelled" },
  });
  await assert.rejects(
    service.operations["environment.login"]({
      provider: "anthropic",
      method: browser,
      attempt: "a2",
    }),
    NyteClosed,
  );
});

test("a finished attempt is forgotten after five minutes", async () => {
  vi.useFakeTimers();
  const service = environment({});

  await service.operations["environment.login"]({
    provider: "openai",
    method: browser,
    attempt: "a1",
  });
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(
    (await service.operations["environment.loginAttempt"]({ attempt: "a1" })).kind,
    "settled",
  );

  await vi.advanceTimersByTimeAsync(5 * 60_000);

  assert.deepEqual(await service.operations["environment.loginAttempt"]({ attempt: "a1" }), {
    kind: "unknown",
  });
});
