import assert from "node:assert/strict";
import { afterEach, describe, expect, test } from "vitest";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";
import {
  WEB_SEARCH_SETTING_ID,
  WEB_SEARCH_TOOL_NAME,
  WebSearchRequestError,
  webSearchPlugin,
  webSearchProviderPlugin,
  type WebSearchCredentials,
  type WebSearchProvider,
} from "../examples/web-search/index.ts";
import {
  eventsSoFar,
  prompt,
  respond,
  runCommand,
  settingOf,
  testModel,
  toolCall,
  toolParts,
  toolResultOf,
  TestWorkspace,
} from "./host.ts";

const RAW_ERROR = "private upstream error https://upstream.invalid/?token=raw-secret";
const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
});

type SearchResponse = (request: Request) => Response | Promise<Response>;

function httpFailure(status: number): SearchResponse {
  return (request) =>
    new Response(`${RAW_ERROR} ${request.headers.get("Authorization") ?? ""}`, { status });
}

/** Only the remote services are scripted. Routing, waits, and storage run in the SDK. */
function searchFixture() {
  const world = TestWorkspace.create("nyte-web-search-routing-");
  workspaces.push(world);
  const requests: Request[] = [];
  const offered: string[][] = [];
  const randomValues: number[] = [];
  const state = {
    randomValues,
    random: 0,
    keys: new Map<string, string>(),
    environment: new Map<string, string>(),
    responses: new Map<string, SearchResponse[]>(),
    requests,
    offered,
  };
  const credentials: WebSearchCredentials = {
    read: (provider) => Promise.resolve(state.keys.get(provider)),
    write: (provider, key) => {
      if (key === undefined) state.keys.delete(provider);
      else state.keys.set(provider, key);
      return Promise.resolve();
    },
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    state.requests.push(request);
    const provider = new URL(request.url).hostname.replace(".search.invalid", "");
    const response = state.responses.get(provider)?.shift();
    return response === undefined ? new Response(null) : response(request);
  };
  const providers: WebSearchProvider[] = ["alpha", "beta", "gamma"].map((id) => ({
    id,
    name: id.toUpperCase(),
    keyEnvironment: `${id.toUpperCase()}_API_KEY`,
    async execute(input) {
      const response = await input.fetch(`https://${id}.search.invalid/search`, {
        method: "POST",
        body: input.query,
        headers: input.key === undefined ? {} : { Authorization: `Bearer ${input.key}` },
        signal: input.signal ?? null,
      });
      if (!response.ok) {
        throw new WebSearchRequestError(await response.text(), {
          status: response.status,
          cause: new Error(RAW_ERROR),
        });
      }
      return [{ url: `https://results.invalid/${id}`, title: `${id} result`, time: {} }];
    },
  }));
  let call = 0;
  const streamFn: StreamFn = (model, context) => {
    state.offered.push((context.tools ?? []).map((tool) => tool.name));
    const last = context.messages.at(-1);
    if (last?.role === "user" && state.offered.at(-1)?.includes(WEB_SEARCH_TOOL_NAME)) {
      const text = Array.isArray(last.content)
        ? last.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
        : last.content;
      if (text.startsWith("search ")) {
        call += 1;
        const calls = [toolCall(`search-${String(call)}`, WEB_SEARCH_TOOL_NAME, { query: text })];
        if (text === "search concurrent") {
          call += 1;
          calls.push(
            toolCall(`search-${String(call)}`, WEB_SEARCH_TOOL_NAME, { query: "second query" }),
          );
        }
        return respond(model, calls);
      }
    }
    return respond(model, [{ type: "text", text: "done" }]);
  };
  const open = () =>
    world.open({
      model: testModel,
      streamFn,
      plugins: [
        inlinePlugin(
          webSearchPlugin({
            credentials,
            environment: (name) => state.environment.get(name),
            random: () => state.randomValues.shift() ?? state.random,
            fetch,
          }),
        ),
        ...providers.map((provider) => inlinePlugin(webSearchProviderPlugin(provider))),
      ],
    });
  return { world, state, open };
}

function destinations(requests: readonly Request[]): string[] {
  return requests.map((request) => new URL(request.url).hostname.replace(".search.invalid", ""));
}

/** The latest call's transcript result, with the tool's own message beside it. */
async function lastResult(sdk: Nyte, sessionId: SessionId) {
  const part = (await toolParts(sdk, sessionId)).at(-1);
  assert.ok(part?.result, "the latest search has a durable result");
  const message = await toolResultOf({ sdk, sessionId, callId: part.callId });
  return { ...part.result, message };
}

async function search(sdk: Nyte, sessionId: SessionId, query = "search current releases") {
  assert.deepEqual(await prompt(sdk, sessionId, query), { kind: "idle" });
  return lastResult(sdk, sessionId);
}

async function parked(sdk: Nyte, sessionId: SessionId) {
  assert.equal((await prompt(sdk, sessionId, "search private query")).kind, "waiting");
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "waiting");
  const event = (await eventsSoFar(sdk, sessionId)).findLast(
    (entry) => entry.kind === "effect" && entry.state === "waiting",
  );
  assert.ok(event?.kind === "effect");
  assert.equal(event.tool, WEB_SEARCH_TOOL_NAME);
  assert.deepEqual(event.args, { query: "search private query" });
  assert.equal((await toolParts(sdk, sessionId)).at(-1)?.result, undefined);
  return event.callId;
}

async function idle(sdk: Nyte, sessionId: SessionId) {
  assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
  await expect.poll(async () => (await sdk.runs.current({ sessionId }))?.lease).toBeUndefined();
}

async function reply(sdk: Nyte, sessionId: SessionId, callId: string, value: JsonValue) {
  const waiting = (await sdk.sessions.snapshot({ sessionId }))?.parked?.find(
    (call) => call.callId === callId,
  );
  assert.ok(waiting);
  assert.deepEqual(
    await sdk.runs.reply({ sessionId, callId, waitId: waiting.waitId, reply: value }),
    {
      kind: "signalled",
    },
  );
  await idle(sdk, sessionId);
  return lastResult(sdk, sessionId);
}

async function assertPrivate(sdk: Nyte, sessionId: SessionId, secrets: readonly string[]) {
  const visible = {
    transcript: await sdk.messages.list({ sessionId }),
    settings: await sdk.plugins.settings.list({ sessionId }),
    events: await eventsSoFar(sdk, sessionId),
  };
  for (const [channel, value] of Object.entries(visible)) {
    const serialized = JSON.stringify(value);
    for (const secret of [RAW_ERROR, "raw-secret", ...secrets]) {
      assert.equal(serialized.includes(secret), false, `${channel} leaked ${secret}`);
    }
  }
}

describe("web search routing through the SDK", () => {
  test("parallel searches share the session's first route", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    fixture.state.randomValues.push(0, 0.99);
    const sdk = await fixture.open();
    await search(sdk, fixture.world.sessionId, "search concurrent");
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "alpha"]);
    const results = await toolParts(sdk, fixture.world.sessionId);
    assert.equal(results.length, 2);
    assert.ok(results.every((part) => part.result?.isError === false));
  });

  test("a restored anonymous wait requires a reply before searching and can fail over after consent", async () => {
    const fixture = searchFixture();
    fixture.state.responses.set("alpha", [httpFailure(429)]);
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    const callId = await parked(sdk, sessionId);
    assert.equal(fixture.state.requests.length, 0);
    await sdk.close();
    const restored = await fixture.open();
    const snapshot = await restored.sessions.snapshot({ sessionId });
    assert.ok(snapshot?.parked?.some((call) => call.callId === callId));
    assert.equal(fixture.state.requests.length, 0);
    const result = await reply(restored, sessionId, callId, "auto");
    expect(result.message.details).toMatchObject({
      provider: "beta",
      credential: "anonymous",
      rateLimited: ["alpha"],
    });
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "beta"]);
    await search(restored, sessionId);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "beta", "beta"]);
  });
  test("automatic keyed routing stays put across searches and host restart, but not across sessions", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    assert.equal((await search(sdk, sessionId)).isError, false);
    fixture.state.random = 0.99;
    assert.equal((await search(sdk, sessionId, "search again")).isError, false);
    await sdk.close();

    const restarted = await fixture.open();
    assert.equal((await search(restarted, sessionId, "search after restart")).isError, false);
    const other = (await restarted.sessions.create()).sessionId;
    assert.equal((await search(restarted, other)).isError, false);
    assert.equal((await search(restarted, sessionId, "search original session")).isError, false);
    assert.deepEqual(destinations(fixture.state.requests), [
      "alpha",
      "alpha",
      "alpha",
      "beta",
      "alpha",
    ]);
    assert.equal(await settingOf(restarted, sessionId, WEB_SEARCH_SETTING_ID), "auto");
  });

  test("HTTP 429 fails over only among keyed providers and remembers the successful route", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.environment.set("BETA_API_KEY", "beta-secret");
    fixture.state.responses.set("alpha", [httpFailure(429)]);
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    const result = await search(sdk, sessionId);
    assert.equal(result.isError, false);
    assert.deepEqual(result.message.details, {
      provider: "beta",
      mode: "auto",
      credential: "environment key",
      rateLimited: ["alpha"],
      results: [{ url: "https://results.invalid/beta", title: "beta result", time: {} }],
    });
    assert.match(result.output, /Rate limited: alpha/);
    assert.match(result.output, /\[beta result\]\(https:\/\/results.invalid\/beta\)/);
    assert.match(result.message.title ?? "", /^search .* · BETA$/);
    const progress = (await eventsSoFar(sdk, sessionId)).flatMap((event) =>
      event.kind === "tool_progress" ? [event.progress.text] : [],
    );
    assert.ok(progress.some((text) => /Rate limited: alpha.*BETA/su.test(text)));
    const setting = (await sdk.plugins.settings.list({ sessionId })).find(
      (entry) => entry.id === WEB_SEARCH_SETTING_ID,
    );
    assert.match(
      setting?.choices.find((choice) => choice.id === "auto")?.description ?? "",
      /BETA.*environment key/,
    );
    assert.ok(
      setting?.choices.every((choice) => choice.status === undefined),
      "search routing belongs in the dialog, not the footer",
    );
    await assertPrivate(sdk, sessionId, ["alpha-secret", "beta-secret"]);
    const repeated = await search(sdk, sessionId, "search after failover");
    assert.equal(repeated.isError, false);
    expect(repeated.message.details).toMatchObject({ rateLimited: [] });
    await sdk.close();
    const restarted = await fixture.open();
    assert.equal((await search(restarted, sessionId)).isError, false);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "beta", "beta", "beta"]);
  });

  test("exhausted HTTP 429 failover tries each keyed provider once and never downgrades to anonymous", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    fixture.state.responses.set("alpha", [httpFailure(429), httpFailure(429)]);
    fixture.state.responses.set("beta", [httpFailure(429), httpFailure(429)]);
    const sdk = await fixture.open();
    const result = await search(sdk, fixture.world.sessionId);
    assert.equal(result.isError, true);
    assert.match(result.output, /HTTP 429/);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "beta"]);
    expect(result.message.details).toMatchObject({ rateLimited: ["alpha"] });
    await assertPrivate(sdk, fixture.world.sessionId, ["alpha-secret", "beta-secret"]);
  });

  test("one keyed provider cannot fail over to anonymous providers", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("beta", "beta-secret");
    fixture.state.responses.set("beta", [httpFailure(429)]);
    const sdk = await fixture.open();
    const result = await search(sdk, fixture.world.sessionId);
    assert.equal(result.isError, true);
    assert.match(result.output, /HTTP 429/);
    assert.deepEqual(destinations(fixture.state.requests), ["beta"]);
  });

  test("explicit selection never fails over, even when another keyed provider is available", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    fixture.state.responses.set("beta", [httpFailure(429)]);
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    assert.deepEqual(
      await sdk.plugins.settings.apply({
        sessionId,
        id: WEB_SEARCH_SETTING_ID,
        choiceId: "beta",
      }),
      { kind: "applied" },
    );
    const result = await search(sdk, sessionId);
    assert.equal(result.isError, true);
    assert.deepEqual(result.message.details, {
      provider: "beta",
      mode: "explicit",
      credential: "saved key",
      rateLimited: [],
      results: [],
    });
    assert.match(result.output, /HTTP 429/);
    assert.deepEqual(destinations(fixture.state.requests), ["beta"]);
    await assertPrivate(sdk, sessionId, ["alpha-secret", "beta-secret"]);
  });

  test.each([
    { name: "HTTP 401", failure: httpFailure(401), message: /authentication failed.*401/ },
    { name: "HTTP 503", failure: httpFailure(503), message: /request failed.*503/ },
    {
      name: "a request error without an HTTP status",
      failure: () => {
        throw new WebSearchRequestError(RAW_ERROR, {});
      },
      message: /Unable to search/,
    },
    {
      name: "an untyped error mentioning HTTP 429",
      failure: () => {
        throw new Error(`${RAW_ERROR} HTTP 429`);
      },
      message: /Unable to search/,
    },
    {
      name: "a provider AbortError",
      failure: () => {
        throw new DOMException(RAW_ERROR, "AbortError");
      },
      message: /Unable to search/,
    },
  ])("does not fail over for $name", async ({ failure, message }) => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    fixture.state.responses.set("alpha", [failure]);
    const sdk = await fixture.open();
    const result = await search(sdk, fixture.world.sessionId);
    assert.equal(result.isError, true);
    assert.match(result.output, message);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha"]);
    await assertPrivate(sdk, fixture.world.sessionId, ["alpha-secret", "beta-secret"]);
  });

  test("aborting an in-flight request prevents failover even if it rejects with HTTP 429", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    fixture.state.keys.set("beta", "beta-secret");
    const started = Promise.withResolvers<Request>();
    fixture.state.responses.set("alpha", [
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new WebSearchRequestError(RAW_ERROR, { status: 429 })),
            { once: true },
          );
          started.resolve(request);
        }),
    ]);
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    await sdk.messages.send({ sessionId, content: "search slow provider" });
    const request = await started.promise;
    await sdk.runs.abort({ sessionId });
    await idle(sdk, sessionId);
    assert.equal(request.signal.aborted, true);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha"]);
    await assertPrivate(sdk, sessionId, ["alpha-secret", "beta-secret"]);
  });

  test.each(["auto", "beta"])(
    "anonymous consent via exact '%s' reply is remembered across searches and restart",
    async (choice) => {
      const fixture = searchFixture();
      const sdk = await fixture.open();
      const sessionId = fixture.world.sessionId;
      const callId = await parked(sdk, sessionId);
      assert.equal(fixture.state.requests.length, 0);
      const result = await reply(sdk, sessionId, callId, choice);
      assert.equal(result.isError, false);
      expect(result.message.details).toMatchObject({
        credential: "anonymous",
        mode: choice === "auto" ? "auto" : "explicit",
      });
      assert.equal(await settingOf(sdk, sessionId, WEB_SEARCH_SETTING_ID), choice);
      fixture.state.random = 0.99;
      assert.equal((await search(sdk, sessionId, "search approved again")).isError, false);
      await sdk.close();
      const restarted = await fixture.open();
      assert.equal(
        (await search(restarted, sessionId, "search remembered consent")).isError,
        false,
      );
      const provider = choice === "auto" ? "alpha" : "beta";
      assert.deepEqual(destinations(fixture.state.requests), [provider, provider, provider]);
      assert.ok(
        fixture.state.requests.every((request) => request.headers.get("Authorization") === null),
      );
      const other = (await restarted.sessions.create()).sessionId;
      await parked(restarted, other);
      assert.equal(fixture.state.requests.length, 3, "another session needs its own consent");
    },
  );

  test("exact off reply sends nothing and withholds search on the next prompt and restart", async () => {
    const fixture = searchFixture();
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    const callId = await parked(sdk, sessionId);
    const result = await reply(sdk, sessionId, callId, "off");
    assert.equal(result.isError, true);
    assert.match(result.output, /Web search is off/);
    assert.equal(await settingOf(sdk, sessionId, WEB_SEARCH_SETTING_ID), "off");
    assert.deepEqual(await prompt(sdk, sessionId, "search disabled"), { kind: "idle" });
    assert.equal(fixture.state.offered.at(-1)?.includes(WEB_SEARCH_TOOL_NAME), false);
    assert.equal((await toolParts(sdk, sessionId)).length, 1);
    await sdk.close();
    const restarted = await fixture.open();
    assert.equal(await settingOf(restarted, sessionId, WEB_SEARCH_SETTING_ID), "off");
    assert.deepEqual(await prompt(restarted, sessionId, "search still disabled"), { kind: "idle" });
    assert.equal(fixture.state.offered.at(-1)?.includes(WEB_SEARCH_TOOL_NAME), false);
    assert.equal(fixture.state.requests.length, 0);
  });

  test.each<JsonValue>(["yes", " auto ", "AUTO", "unknown-provider", "", { provider: "auto" }])(
    "invalid consent reply %j never authorizes anonymous requests",
    async (value) => {
      const fixture = searchFixture();
      const sdk = await fixture.open();
      const sessionId = fixture.world.sessionId;
      const callId = await parked(sdk, sessionId);
      const result = await reply(sdk, sessionId, callId, value);
      assert.equal(result.isError, true);
      assert.match(result.output, /not approved/);
      await parked(sdk, sessionId);
      assert.equal(fixture.state.requests.length, 0);
    },
  );

  test("normal conversation, even an exact option id, cannot approve a waiting search", async () => {
    const fixture = searchFixture();
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    const callId = await parked(sdk, sessionId);
    await sdk.messages.send({ sessionId, content: "auto" });
    assert.equal((await sdk.runs.wait({ sessionId })).kind, "waiting");
    assert.equal((await toolParts(sdk, sessionId)).at(-1)?.result, undefined);
    assert.equal(fixture.state.requests.length, 0);
    assert.equal((await reply(sdk, sessionId, callId, "auto")).isError, false);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha"]);
  });

  test("aborting while waiting sends nothing and grants no consent", async () => {
    const fixture = searchFixture();
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    await parked(sdk, sessionId);
    await sdk.runs.abort({ sessionId });
    await idle(sdk, sessionId);
    assert.equal((await lastResult(sdk, sessionId)).isError, true);
    assert.equal(fixture.state.requests.length, 0);
    await parked(sdk, sessionId);
    assert.equal(fixture.state.requests.length, 0);
  });

  test("adding and removing keys rechecks route eligibility without silently granting anonymous consent", async () => {
    const fixture = searchFixture();
    fixture.state.keys.set("alpha", "alpha-secret");
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    expect((await search(sdk, sessionId)).message.details).toMatchObject({ provider: "alpha" });
    assert.equal(
      await runCommand(sdk, sessionId, "websearch-key", "beta beta-secret"),
      "Saved the BETA API key.",
    );
    fixture.state.random = 0.99;
    expect((await search(sdk, sessionId)).message.details).toMatchObject({ provider: "alpha" });
    assert.equal(
      await runCommand(sdk, sessionId, "websearch-key", "alpha"),
      "Removed the ALPHA API key.",
    );
    expect((await search(sdk, sessionId)).message.details).toMatchObject({ provider: "beta" });
    await runCommand(sdk, sessionId, "websearch-key", "beta");
    await parked(sdk, sessionId);
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "alpha", "beta"]);
    await assertPrivate(sdk, sessionId, ["alpha-secret", "beta-secret"]);
  });

  test("a newly available key replaces an anonymous sticky route and removed keys restore consented anonymous access", async () => {
    const fixture = searchFixture();
    const sdk = await fixture.open();
    const sessionId = fixture.world.sessionId;
    const callId = await parked(sdk, sessionId);
    expect((await reply(sdk, sessionId, callId, "auto")).message.details).toMatchObject({
      provider: "alpha",
    });
    fixture.state.environment.set("BETA_API_KEY", "environment-secret");
    const keyed = await search(sdk, sessionId);
    expect(keyed.message.details).toMatchObject({
      provider: "beta",
      credential: "environment key",
    });
    fixture.state.environment.delete("BETA_API_KEY");
    const anonymous = await search(sdk, sessionId);
    expect(anonymous.message.details).toMatchObject({ provider: "beta", credential: "anonymous" });
    assert.deepEqual(destinations(fixture.state.requests), ["alpha", "beta", "beta"]);
    assert.deepEqual(
      fixture.state.requests.map((request) => request.headers.get("Authorization")),
      [null, "Bearer environment-secret", null],
    );
    await assertPrivate(sdk, sessionId, ["environment-secret"]);
  });
});
