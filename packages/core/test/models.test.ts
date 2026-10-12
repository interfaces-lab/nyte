import { asId, standard } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type { Configuration, ModelRef } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import { contributionsOf, createLogin, modelInfo, settingsVersion, usageOf } from "../src/index.ts";
import type { Plugin } from "../src/index.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import { main, until } from "./harness.ts";

const smart: ModelRef = { provider: "test", id: "smart" };

const basic: ModelRef = { provider: "test", id: "model" };

/** Returns a fake provider with a plain model and a reasoning model that has a fast sibling. */
function catalog() {
  return fakeModels({
    models: [
      testModel("model"),
      testModel("smart", {
        name: "Smart",
        api: "openai-responses",
        reasoning: true,
        modes: ["fast"],
        thinkingLevelMap: { minimal: null, xhigh: "xhigh" },
        input: ["text", "image"],
        contextWindow: 200_000,
        maxTokens: 32_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      }),
    ],
  });
}

const tone = {
  id: "tone",
  label: "Tone",
  schema: standard(Type.Union([Type.Literal("calm"), Type.Literal("loud")])),
  default: "calm",
  scope: "session",
} as const;

const extras: Plugin<"core"> = {
  id: "extras",
  contribute: {
    settings: [tone],
    agents: [{ id: "reviewer", model: smart }],
    modelContext: [{ model: basic, contextWindow: 50_000, compactAt: 10_000 }],
  },
};

describe("models", () => {
  it("projects the catalog: credentials, methods, limits, base models, thinking, fast siblings and policies", async () => {
    const fake = catalog();
    const plain = fakeModels({ id: "plain", into: fake.models, verify: false });
    plain.configured = false;
    await using host = await open(fake, { plugins: [extras] });
    const listed = await host.models.list();

    expect(listed.generation).toBe(host.kernel.host.current().catalog);
    expect(listed.default).toEqual(basic);
    expect(listed.providers.map((provider) => [provider.id, provider.credential])).toEqual([
      ["test", "configured"],
      ["plain", "missing"],
    ]);

    const [test] = listed.providers;

    expect(test.methods).toEqual([{ kind: "oauth" }, { kind: "key" }]);
    expect(test.limits).toEqual([]);
    expect(test.models.map((model) => model.ref.id)).toEqual(["model", "smart"]);
    expect(test.models[0]).toMatchObject({
      thinking: ["off"],
      fast: null,
      contextWindow: 50_000,
      compactAt: 10_000,
    });
    expect(test.models[1]).toEqual({
      ref: smart,
      name: "Smart",
      reasoning: true,
      thinking: ["off", "low", "medium", "high", "xhigh"],
      fast: { provider: "test", id: "smart-fast" },
      contextWindow: 200_000,
      compactAt: 160_000,
      maxOutput: 32_000,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });
    const session = await host.sessions.create();
    const runtime = host.kernel.pluginsFor(session.id);
    await runtime.ready;

    expect(modelInfo(fake.models, { provider: "test", id: "smart-fast" }, runtime)).toMatchObject({
      ref: { provider: "test", id: "smart-fast" },
      fast: null,
    });
    expect(modelInfo(fake.models, { provider: "test", id: "nope" }, runtime)).toBeNull();

    fake.reply({
      content: [{ type: "text", text: "Hi." }],
      limits: [
        { id: "five_hour", usedPercent: 40, resetsAt: 1_000 },
        { id: "seven_day", usedPercent: 5 },
      ],
    });

    await host.kernel.request(session.id, {
      model: basic,
      messages: [{ role: "user", content: "Hi.", timestamp: 0 }],
    });

    expect((await host.models.list()).providers[0].limits).toEqual([
      { label: "five_hour", used: 40, limit: 100, resetsAt: 1_000 },
      { label: "seven_day", used: 5, limit: 100, resetsAt: null },
    ]);
  });

  it("moves the catalog generation when a response changes a provider's account limits", async () => {
    const fake = catalog();
    await using host = await open(fake);
    const session = await host.sessions.create();
    const messages = [{ role: "user" as const, content: "Hi.", timestamp: 0 }];
    const window = { id: "five_hour", usedPercent: 40, resetsAt: 1_000 };
    const generation = () => host.kernel.host.current().catalog;

    await until(() => (host.kernel.catalog(session.id).tools.length > 0 ? true : undefined));

    fake.reply(
      { content: [{ type: "text", text: "Plain." }] },
      { content: [{ type: "text", text: "Limited." }], limits: [window] },
      { content: [{ type: "text", text: "Same." }], limits: [window] },
      { content: [{ type: "text", text: "Turned." }], limits: [{ ...window, usedPercent: 45 }] },
    );

    const before = generation();
    await host.kernel.request(session.id, { model: basic, messages });

    expect(generation()).toBe(before);

    await host.kernel.request(session.id, { model: basic, messages });
    const limited = generation();

    expect(limited).not.toBe(before);

    await host.kernel.request(session.id, { model: basic, messages });

    expect(generation()).toBe(limited);

    await (await session.send("Go.")).settled();

    expect(generation()).not.toBe(limited);
    expect((await host.models.list()).providers[0].limits).toEqual([
      { label: "five_hour", used: 45, limit: 100, resetsAt: 1_000 },
    ]);
  });

  it("sets the default model, answering unknown-model for one the catalog lacks", async () => {
    const fake = catalog();
    await using host = await open(fake);
    const before = host.kernel.host.current().catalog;

    expect(await host.models.setDefault({ provider: "test", id: "nope" })).toEqual({
      kind: "unknown-model",
    });
    expect(await host.models.setDefault(smart)).toEqual({ kind: "set" });
    expect(host.kernel.host.current().catalog).not.toBe(before);
    expect((await host.models.list()).default).toEqual(smart);

    const session = await host.sessions.create();

    expect(
      await host.kernel.resolveConfiguration({
        session: session.id,
        head: main,
        selected: null,
        patch: null,
        contributions: contributionsOf(host.kernel.pluginsFor(session.id)),
      }),
    ).toMatchObject({ model: smart, thinking: "low" });
  });

  it("refreshes providers, naming each one whose refresh failed", async () => {
    const fake = catalog();

    fake.models.setProvider({
      ...fakeModels({ id: "broken" }).provider,
      refreshModels: async () => {
        throw new Error("The catalog is down.");
      },
    });

    await using host = await open(fake);
    const before = host.kernel.host.current().catalog;

    await host.models.refresh("test");
    const after = host.kernel.host.current().catalog;

    expect(after).not.toBe(before);
    await expect(host.models.refresh()).rejects.toMatchObject({
      code: "unavailable",
      message: "Refreshing models failed for broken (The catalog is down.).",
    });
    expect(host.kernel.host.current().catalog).not.toBe(after);
  });

  it("verifies a credential: verified, unverified without a provider check, failed", async () => {
    const fake = catalog();
    fakeModels({ id: "plain", into: fake.models, verify: false });
    await using host = await open(fake);

    const credential = async (id: string) =>
      (await host.models.list()).providers.find((provider) => provider.id === id)?.credential;

    expect(await host.models.verify("test")).toEqual({ kind: "verified" });
    expect(await credential("test")).toBe("verified");
    expect(await host.models.verify("plain")).toEqual({ kind: "unverified" });
    expect(await credential("plain")).toBe("configured");

    fake.verdict = { ok: false, reason: "rejected", message: "The key was refused." };

    expect(await host.models.verify("test")).toEqual({
      kind: "failed",
      reason: "The key was refused.",
    });
    expect(await credential("test")).toBe("failed");

    await host.models.logout("test");

    expect(await credential("test")).toBe("configured");
  });

  it("runs a key login through paste, and an oauth login through open, choose and waiting", async () => {
    const fake = catalog();
    fake.configured = false;
    await using host = await open(fake);
    const key = host.models.login({ provider: "test", method: { kind: "key" } });

    await expect(key.answer("early")).rejects.toMatchObject({ code: "invalid" });

    const keySteps: unknown[] = [];

    for await (const step of key.steps()) {
      keySteps.push(step);

      if (step.kind === "paste") await key.answer("sk-test");
    }

    expect(keySteps).toEqual([
      { kind: "paste", message: "Paste your key.", secret: true },
      { kind: "done" },
    ]);
    expect((await host.models.list()).providers[0].credential).toBe("configured");

    const oauth = host.models.login({ provider: "test", method: { kind: "oauth" } });
    const oauthSteps: unknown[] = [];

    for await (const step of oauth.steps()) {
      oauthSteps.push(step);

      if (step.kind === "choose") {
        await expect(oauth.answer("three")).rejects.toMatchObject({ code: "invalid" });
        await oauth.answer("one");
      }
    }

    expect(oauthSteps).toEqual([
      { kind: "open", url: "https://example.test/device", code: "ABCD-1234" },
      {
        kind: "choose",
        message: "Pick an organisation.",
        options: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      },
      { kind: "waiting" },
      { kind: "done" },
    ]);

    const refused = createLogin(host.kernel, fake.models, {
      provider: "test",
      method: { kind: "oauth" },
    });

    const last: unknown[] = [];

    for await (const step of refused.steps()) {
      if (step.kind === "choose") await refused.answer("two");
      last.push(step);
    }

    expect(last.at(-1)).toEqual({ kind: "failed", reason: "Organisation two has no access." });
  });

  it("cancels a login when its iterator is dropped", async () => {
    const fake = catalog();
    await using host = await open(fake);
    const login = host.models.login({ provider: "test", method: { kind: "key" } });

    for await (const step of login.steps()) {
      expect(step.kind).toBe("paste");
      break;
    }

    await expect(login.answer("late")).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("resolveConfiguration", () => {
  it("resolves patches field by field and checks exact configurations", async () => {
    const fake = catalog();
    await using host = await open(fake, { plugins: [extras] });
    const session = await host.sessions.create();

    const resolve = (
      patch: Configuration | Parameters<typeof host.kernel.resolveConfiguration>[0]["patch"],
      selected: Configuration | null = null,
    ) =>
      host.kernel.resolveConfiguration({
        session: session.id,
        head: main,
        selected,
        patch,
        contributions: contributionsOf(host.kernel.pluginsFor(session.id)),
      });

    const version = await settingsVersion(
      contributionsOf(host.kernel.pluginsFor(session.id)).settings,
    );

    const base = await resolve(null);

    expect(base).toEqual({
      kind: "exact",
      model: basic,
      thinking: "off",
      agent: null,
      settings: {},
      settingsVersion: version,
    });
    assert(base.kind === "exact");

    expect(await resolve({ model: { provider: "test", id: "nope" } })).toEqual({
      kind: "unknown-model",
      model: { provider: "test", id: "nope" },
    });
    expect(await resolve({ agent: "ghost" })).toEqual({ kind: "unknown-agent", agent: "ghost" });
    expect(await resolve({ agent: "reviewer" })).toMatchObject({
      model: smart,
      agent: "reviewer",
      thinking: "low",
    });
    expect(await resolve({ model: smart, thinking: "minimal" })).toMatchObject({
      kind: "invalid",
      issues: [{ path: ["thinking"] }],
    });

    const deep = await resolve({ model: smart, thinking: "xhigh" });

    assert(deep.kind === "exact");
    expect(deep.thinking).toBe("xhigh");
    expect(await resolve({ model: basic }, deep)).toMatchObject({ model: basic, thinking: "off" });
    expect(await resolve({ thinking: null }, deep)).toMatchObject({
      model: smart,
      thinking: "low",
    });
    expect(await resolve({ settings: { tone: "loud" } }, deep)).toMatchObject({
      settings: { tone: "loud" },
      thinking: "xhigh",
    });
    const rejected = await resolve({ settings: { tone: 3, missing: true } });

    assert(rejected.kind === "invalid");
    expect([...new Set(rejected.issues.map((issue) => issue.path.join(".")))]).toEqual([
      "settings.tone",
      "settings.missing",
    ]);
    expect(await resolve(base)).toEqual(base);
    expect(await resolve({ ...base, settingsVersion: "old" })).toMatchObject({
      kind: "invalid",
      issues: [{ path: ["settingsVersion"] }],
    });
    expect(await resolve({ ...base, agent: "ghost" })).toEqual({
      kind: "unknown-agent",
      agent: "ghost",
    });
    expect(await session.configure({ model: smart })).toMatchObject({
      kind: "configured",
      selected: { model: smart, thinking: "low" },
    });
  });
});

describe("request", () => {
  it("answers structured output parsed and validated, and charges the request", async () => {
    const fake = catalog();
    const steps: string[] = [];

    const watcher: Plugin<"core"> = {
      id: "watcher",
      hooks: {
        after_request: (event) => {
          steps.push(`${event.step}:${event.usage.total}`);
        },
      },
    };

    await using host = await open(fake, { plugins: [watcher] });
    const session = await host.sessions.create();
    const output = standard(Type.Object({ title: Type.String() }));
    const events: string[] = [];

    host.kernel.bus.subscribe(session.id, (event) => {
      if (event.kind === "request")
        events.push(`${event.step}:${event.head}:${event.context.tokens}`);
    });

    fake.reply(
      {
        content: [{ type: "text", text: '```json\n{ "title": "A greeting" }\n```' }],
        usage: { input: 30, output: 6 },
      },
      { content: [{ type: "text", text: '{ "name": 1 }' }] },
      { content: [{ type: "text", text: "Plain words." }], stopReason: "length" },
      { content: [], rawStopReason: "incomplete.content_filter" },
    );

    const messages = [{ role: "user" as const, content: "Hello.", timestamp: 0 }];

    const named = await host.kernel.request(session.id, {
      model: basic,
      system: "Name it.",
      messages,
      output,
    });

    expect(named).toMatchObject({ kind: "ok", value: { title: "A greeting" }, stop: "end" });
    assert(named.kind === "ok");
    expect(named.usage).toMatchObject({ input: 30, output: 6, total: 36 });

    const system = fake.requests[0].context.messages[0];

    assert(system?.role === "system");
    expect(contentText(system.content)).toContain("Name it.\n\nAnswer with one JSON value");
    expect(contentText(system.content)).toContain('"title"');

    expect(await host.kernel.request(session.id, { model: basic, messages, output })).toMatchObject(
      { kind: "failed", failure: { class: "provider" } },
    );
    expect(await host.kernel.request(session.id, { model: basic, messages })).toMatchObject({
      kind: "ok",
      value: "Plain words.",
      stop: "length",
    });
    expect(await host.kernel.request(session.id, { model: basic, messages })).toMatchObject({
      kind: "refused",
    });

    await expect(
      host.kernel.request(session.id, { model: { provider: "test", id: "nope" }, messages }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      host.kernel.request(asId("gone"), { model: basic, messages }),
    ).rejects.toMatchObject({ code: "unknown" });

    await until(() => (steps.length === 4 ? true : undefined));
    expect(steps[0]).toBe("plugin:36");
    expect(events).toEqual([
      "plugin:null:36",
      "plugin:null:15",
      "plugin:null:15",
      "plugin:null:15",
    ]);
  });

  it("prices usage from the model's rates unless the adapter priced it", () => {
    const info = {
      ref: basic,
      name: "model",
      reasoning: false,
      thinking: ["off"] as const,
      fast: null,
      contextWindow: 1_000,
      compactAt: 800,
      maxOutput: 100,
      input: ["text"] as const,
      cost: { input: 2, output: 4, cacheRead: 1, cacheWrite: 0 },
    };

    const message = {
      role: "assistant" as const,
      content: [],
      api: "test-api",
      provider: "test",
      model: "model",
      usage: {
        input: 1_000_000,
        output: 500_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: 0,
    };

    expect(usageOf(message, info)).toEqual({
      input: 1_000_000,
      output: 500_000,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: null,
      total: 1_500_000,
      cost: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0, total: 4 },
    });

    const priced = {
      ...message,
      usage: {
        ...message.usage,
        reasoning: 7,
        totalTokens: 1_500_010,
        cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      },
    };

    expect(usageOf(priced, info)).toMatchObject({
      reasoning: 7,
      total: 1_500_010,
      cost: { total: 2 },
    });
  });
});
