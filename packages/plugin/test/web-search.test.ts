/**
 * Web search from a user's seat: the model asks for a search, the provider
 * the routing choice names is called the way its route expects, and the
 * transcript shows results a client can render.
 *
 * The providers are separate plugins, so these tests compose the set the way
 * a host does and prove the join: the tool the model sees carries whichever
 * provider plugins were activated beside it.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { inlinePlugin, toJsonValue } from "@nyte-ai/plugin";
import type { JsonValue, ToolResultMessage } from "@nyte-ai/schema";
import {
  exaPlugin,
  firecrawlPlugin,
  parallelPlugin,
  tavilyPlugin,
  webSearchPlugin,
  type WebSearchCredentials,
  type WebSearchPluginOptions,
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
  TestWorkspace,
} from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
});

function fetchMock(
  calls: Request[],
  respondWith: (request: Request) => Response,
): typeof globalThis.fetch {
  return (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return Promise.resolve(respondWith(request));
  };
}

function mcp(result: JsonValue): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

function mcpSse(result: JsonValue): Response {
  return new Response(
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function bodyOf(request: Request): Promise<JsonValue> {
  return toJsonValue(await request.json());
}

/** A process environment with exactly these variables set. */
function environment(variables: Record<string, string>): (name: string) => string | undefined {
  return (name) => variables[name];
}

function isToolResult(message: { role: string }): message is ToolResultMessage {
  return message.role === "toolResult";
}

/** A model that searches once for `query`, then reports what it read. */
function searchingModel(query: string): StreamFn {
  return (model, context) => {
    if (context.messages.some(isToolResult)) {
      return respond(model, [{ type: "text", text: "done" }]);
    }
    return respond(model, [toolCall("search-1", "websearch", { query })]);
  };
}

/** A model that records the tools it was offered, then answers without calling one. */
function toolNamesModel(seen: string[][]): StreamFn {
  return (model, context) => {
    seen.push((context.tools ?? []).map((tool) => tool.name));
    return respond(model, [{ type: "text", text: "done" }]);
  };
}

/** The tool plugin and every provider plugin, the way a host composes them. */
function plugins(options: WebSearchPluginOptions) {
  return [webSearchPlugin(options), exaPlugin, firecrawlPlugin, parallelPlugin, tavilyPlugin].map(
    (plugin) => inlinePlugin(plugin),
  );
}

async function openSearch(
  query: string,
  options: WebSearchPluginOptions,
): Promise<{ sdk: Nyte; sessionId: SessionId }> {
  const world = TestWorkspace.create("nyte-web-search-");
  workspaces.push(world);
  const sdk = await world.open({
    streamFn: searchingModel(query),
    plugins: plugins(options),
    model: testModel,
  });
  return { sdk, sessionId: world.sessionId };
}

async function answer(
  sdk: Nyte,
  sessionId: SessionId,
  callId: string,
  reply: string,
): Promise<void> {
  const waiting = (await sdk.sessions.snapshot({ sessionId }))?.parked?.find(
    (call) => call.callId === callId,
  );
  assert.ok(waiting);
  await sdk.runs.reply({ sessionId, callId, waitId: waiting.waitId, reply });
}

/** Ask for a search and return what the transcript shows for it. */
async function search(query: string, options: WebSearchPluginOptions) {
  const { sdk, sessionId } = await openSearch(query, options);
  const outcome = await prompt(sdk, sessionId, "look this up");
  if (outcome.kind === "waiting") {
    await answer(sdk, sessionId, "search-1", "auto");
    assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
  } else {
    assert.deepEqual(outcome, { kind: "idle" });
  }
  const [part, ...rest] = await toolParts(sdk, sessionId);
  assert.ok(part !== undefined && rest.length === 0, "one search ran");
  assert.ok(part.result !== undefined, "the search settled");
  return { sdk, sessionId, result: part.result };
}

/** Only this provider holds a key, so `auto` routes to it. */
function onlyKeyed(variable: string, value: string): WebSearchPluginOptions {
  return { environment: environment({ [variable]: value }) };
}

describe("web search plugin", () => {
  test("sends an optional Exa key, shows progress, and renders Exa's results", async () => {
    const calls: Request[] = [];
    const credentials: WebSearchCredentials = {
      read: (provider) => Promise.resolve(provider === "exa" ? "exa-secret" : undefined),
      write: () => Promise.resolve(),
    };
    const { sdk, sessionId, result } = await search(" Effect 4 ", {
      credentials,
      environment: environment({}),
      fetch: fetchMock(calls, () =>
        mcpSse({
          content: [
            {
              type: "text",
              text: "Title: Effect 4\nURL: https://example.com/effect\nPublished: 2026-01-02\nHighlights:\nCurrent release notes",
            },
          ],
        }),
      ),
    });

    assert.equal(calls.length, 1);
    const request = calls[0];
    assert.ok(request);
    const url = new URL(request.url);
    assert.equal(url.origin + url.pathname, "https://mcp.exa.ai/mcp");
    assert.equal(url.searchParams.get("exaApiKey"), "exa-secret");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Accept"), "application/json, text/event-stream");
    assert.equal(request.headers.get("Content-Type"), "application/json");
    // A stateless tools/call, not an MCP session: no protocol handshake header.
    assert.equal(request.headers.get("MCP-Protocol-Version"), null);
    assert.deepEqual(await bodyOf(request), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query: "Effect 4", numResults: 8 } },
    });

    assert.deepEqual(result.details, {
      provider: "exa",
      mode: "auto",
      credential: "saved key",
      rateLimited: [],
      results: [
        {
          url: "https://example.com/effect",
          title: "Effect 4",
          content: "Current release notes",
          time: { published: Date.parse("2026-01-02") },
        },
      ],
    });
    assert.equal(result.title, "Effect 4 · Exa");
    assert.match(result.output, /## \[Effect 4\]\(https:\/\/example.com\/effect\)/);
    assert.equal(result.isError, false);

    const progress = (await eventsSoFar(sdk, sessionId)).flatMap((event) =>
      event.kind === "tool_progress" ? [event.progress.text] : [],
    );
    assert.deepEqual(progress, ["Searching with Auto · Exa · saved key…"]);
  });

  test("uses Parallel bearer auth and its structured results", async () => {
    const calls: Request[] = [];
    const { result } = await search("current releases", {
      ...onlyKeyed("PARALLEL_API_KEY", "parallel-secret"),
      fetch: fetchMock(calls, () =>
        mcp({
          content: [{ type: "text", text: "ok" }],
          structuredContent: {
            search_id: "search-1",
            session_id: "session-1",
            results: [
              {
                url: "https://example.com/parallel",
                title: "Parallel result",
                publish_date: "2026-03-01",
                excerpts: ["first", "second"],
              },
            ],
          },
        }),
      ),
    });

    const request = calls[0];
    assert.ok(request);
    assert.equal(new URL(request.url).origin, "https://search.parallel.ai");
    assert.equal(request.headers.get("Authorization"), "Bearer parallel-secret");
    assert.deepEqual(await bodyOf(request), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: { objective: "current releases", search_queries: ["current releases"] },
      },
    });
    assert.deepEqual(result.details, {
      provider: "parallel",
      mode: "auto",
      credential: "environment key",
      rateLimited: [],
      results: [
        {
          url: "https://example.com/parallel",
          title: "Parallel result",
          content: "first\n\nsecond",
          time: { published: Date.parse("2026-03-01") },
        },
      ],
    });
  });

  test("uses Firecrawl bearer auth and decodes its text payload", async () => {
    const calls: Request[] = [];
    const { result } = await search("fresh page", {
      ...onlyKeyed("FIRECRAWL_API_KEY", "fire-secret"),
      fetch: fetchMock(calls, () =>
        mcpSse({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: {
                  web: [
                    {
                      url: "https://example.com/fire",
                      title: "Firecrawl result",
                      description: "Fresh page",
                    },
                  ],
                },
              }),
            },
          ],
        }),
      ),
    });

    const request = calls[0];
    assert.ok(request);
    assert.equal(new URL(request.url).origin, "https://mcp.firecrawl.dev");
    assert.equal(request.headers.get("Authorization"), "Bearer fire-secret");
    assert.deepEqual(await bodyOf(request), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "firecrawl_search", arguments: { query: "fresh page", limit: 8 } },
    });
    assert.deepEqual(result.details, {
      provider: "firecrawl",
      mode: "auto",
      credential: "environment key",
      rateLimited: [],
      results: [
        {
          url: "https://example.com/fire",
          title: "Firecrawl result",
          content: "Fresh page",
          time: {},
        },
      ],
    });
  });

  test("asks Tavily's REST route for the keyless mode when no key is held", async () => {
    const calls: Request[] = [];
    const world = TestWorkspace.create("nyte-web-search-tavily-");
    workspaces.push(world);
    // Tavily alone, so `auto` can only route to it.
    const sdk = await world.open({
      streamFn: searchingModel("keyless"),
      plugins: [
        inlinePlugin(
          webSearchPlugin({
            environment: environment({}),
            fetch: fetchMock(calls, () =>
              Response.json({
                results: [
                  { title: "Tavily result", url: "https://example.com/tavily", content: "A page" },
                ],
              }),
            ),
          }),
        ),
        inlinePlugin(tavilyPlugin),
      ],
      model: testModel,
    });
    const { sessionId } = world;
    const outcome = await prompt(sdk, sessionId, "look this up");
    if (outcome.kind === "waiting") {
      await answer(sdk, sessionId, "search-1", "auto");
      assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
    } else {
      assert.deepEqual(outcome, { kind: "idle" });
    }

    const request = calls[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.tavily.com/search");
    assert.equal(request.headers.get("X-Tavily-Access-Mode"), "keyless");
    assert.equal(request.headers.get("Authorization"), null);
    assert.deepEqual(await bodyOf(request), {
      query: "keyless",
      search_depth: "basic",
      chunks_per_source: 3,
      max_results: 8,
    });
    const [part] = await toolParts(sdk, sessionId);
    assert.deepEqual(part?.result?.details, {
      provider: "tavily",
      mode: "auto",
      credential: "anonymous",
      rateLimited: [],
      results: [
        { url: "https://example.com/tavily", title: "Tavily result", content: "A page", time: {} },
      ],
    });
  });

  test("automatic routing prefers the provider holding a key", async () => {
    const calls: Request[] = [];
    const { result } = await search("keyed", {
      // Firecrawl is the only keyed route, so it answers however the shuffle falls.
      environment: environment({ FIRECRAWL_API_KEY: "fire-secret" }),
      random: () => 0.99,
      fetch: fetchMock(calls, () =>
        mcp({
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, data: { web: [] } }),
            },
          ],
        }),
      ),
    });
    assert.deepEqual(
      calls.map((request) => new URL(request.url).hostname),
      ["mcp.firecrawl.dev"],
    );
    assert.deepEqual(result.details, {
      provider: "firecrawl",
      mode: "auto",
      credential: "environment key",
      rateLimited: [],
      results: [],
    });
    assert.equal(result.output, "No search results found. Please try a different query.");
    assert.equal(result.isError, false);
  });

  test("with no key held, automatic routing picks one keyless provider at random", async () => {
    const calls: Request[] = [];
    const { result } = await search("random", {
      environment: environment({}),
      // Four providers join in registration order; 0.5 lands on the third.
      random: () => 0.5,
      fetch: fetchMock(calls, () =>
        mcp({
          content: [{ type: "text", text: "ok" }],
          structuredContent: { search_id: "s", session_id: "s", results: [] },
        }),
      ),
    });
    assert.deepEqual(
      calls.map((request) => new URL(request.url).hostname),
      ["search.parallel.ai"],
    );
    assert.deepEqual(result.details, {
      provider: "parallel",
      mode: "auto",
      credential: "anonymous",
      rateLimited: [],
      results: [],
    });
  });

  test("names the failures a user can act on and never retries a chosen provider", async () => {
    const calls: Request[] = [];
    const rateLimited = await search("busy", {
      ...onlyKeyed("EXA_API_KEY", "exa-secret"),
      fetch: fetchMock(calls, () => new Response("slow down", { status: 429 })),
    });
    assert.equal(calls.length, 1);
    assert.equal(rateLimited.result.isError, true);
    assert.equal(rateLimited.result.output, "Web search rate limited (HTTP 429)");
    assert.deepEqual(rateLimited.result.details, {
      provider: "exa",
      mode: "auto",
      credential: "environment key",
      rateLimited: [],
      results: [],
    });

    const unauthorized = await search("bad key", {
      ...onlyKeyed("EXA_API_KEY", "wrong"),
      fetch: fetchMock([], () => new Response("nope", { status: 401 })),
    });
    assert.equal(unauthorized.result.output, "Web search authentication failed (HTTP 401)");

    const unavailable = await search("down", {
      ...onlyKeyed("EXA_API_KEY", "exa-secret"),
      fetch: fetchMock([], () => new Response("unavailable", { status: 503 })),
    });
    assert.equal(unavailable.result.output, "Web search request failed (HTTP 503)");
  });

  test("a chosen provider is remembered across hosts, and off withholds the tool", async () => {
    const world = TestWorkspace.create("nyte-web-search-policy-");
    workspaces.push(world);
    const keys = new Map<string, string>();
    const credentials: WebSearchCredentials = {
      read: (provider) => Promise.resolve(keys.get(provider)),
      write: (provider, key) => {
        if (key === undefined) keys.delete(provider);
        else keys.set(provider, key);
        return Promise.resolve();
      },
    };
    const calls: Request[] = [];
    const open = (): Promise<Nyte> =>
      world.open({
        streamFn: searchingModel("remembered"),
        plugins: plugins({
          credentials,
          environment: environment({}),
          fetch: fetchMock(calls, () =>
            mcp({
              content: [{ type: "text", text: "ok" }],
              structuredContent: { search_id: "s", session_id: "s", results: [] },
            }),
          ),
        }),
        model: testModel,
      });

    let sdk = await open();
    const { sessionId } = world;
    assert.equal(await settingOf(sdk, sessionId, "websearch-provider"), "auto");
    assert.deepEqual(
      await sdk.plugins.settings.apply({
        sessionId,
        id: "websearch-provider",
        choiceId: "parallel",
      }),
      { kind: "applied" },
    );
    // The key rides the argument; a secret must never become a durable reply.
    assert.equal(
      await runCommand(sdk, sessionId, "websearch-key", "exa saved-secret"),
      "Saved the Exa API key.",
    );
    assert.equal(keys.get("exa"), "saved-secret");
    assert.equal(
      await runCommand(sdk, sessionId, "websearch-key", "exa"),
      "Removed the Exa API key.",
    );
    assert.equal(keys.has("exa"), false);
    await sdk.close();

    sdk = await open();
    assert.equal(await settingOf(sdk, sessionId, "websearch-provider"), "parallel");
    assert.equal((await prompt(sdk, sessionId, "search")).kind, "waiting");
    await answer(sdk, sessionId, "search-1", "parallel");
    assert.deepEqual(await sdk.runs.wait({ sessionId }), { kind: "idle" });
    assert.deepEqual(
      calls.map((request) => new URL(request.url).hostname),
      ["search.parallel.ai"],
    );
    await sdk.close();

    // `off` is opencode's `false` selection: the model stops being offered the tool.
    const offered: string[][] = [];
    sdk = await world.open({
      streamFn: toolNamesModel(offered),
      plugins: plugins({ credentials, environment: environment({}) }),
      model: testModel,
    });
    assert.deepEqual(await prompt(sdk, sessionId, "before"), { kind: "idle" });
    assert.equal(offered.at(-1)?.includes("websearch"), true);
    assert.deepEqual(
      await sdk.plugins.settings.apply({ sessionId, id: "websearch-provider", choiceId: "off" }),
      { kind: "applied" },
    );
    // The tool goes away in the session that turned it off, not only the next one.
    assert.deepEqual(await prompt(sdk, sessionId, "after"), { kind: "idle" });
    assert.equal(offered.at(-1)?.includes("websearch"), false);
    await sdk.close();

    sdk = await world.open({
      streamFn: toolNamesModel(offered),
      plugins: plugins({ credentials, environment: environment({}) }),
      model: testModel,
    });
    assert.deepEqual(await prompt(sdk, sessionId, "anything"), { kind: "idle" });
    assert.equal(offered.at(-1)?.includes("websearch"), false);
    // The routing menu stays, so the user can turn search back on.
    assert.equal(await settingOf(sdk, sessionId, "websearch-provider"), "off");
  });
});
