import { isPart, tool } from "@nyte-ai/core";
import { assert, describe, expect, it } from "vitest";
import { adapters, webPlugin } from "../src/web/index.ts";
import { fakeModels, open } from "./fake-models.ts";

function recording(body: string) {
  const sent: { readonly url: string; readonly headers: Headers; readonly body: unknown }[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    sent.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    });

    return new Response(body, { status: 200 });
  };

  return { sent, fetch };
}

const signal = new AbortController().signal;

function frame(result: unknown): string {
  return `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`;
}

describe("web search adapters", () => {
  it("posts Tavily's REST search keyless or with a bearer key", async () => {
    const { sent, fetch } = recording(
      JSON.stringify({ results: [{ url: "https://a.test", title: "A", content: "aa" }] }),
    );

    expect(await adapters.tavily({ query: "nyte", key: undefined, fetch, signal })).toEqual([
      { url: "https://a.test", title: "A", content: "aa" },
    ]);
    await adapters.tavily({ query: "nyte", key: "tv", fetch, signal });

    expect(sent.map((request) => request.url)).toEqual([
      "https://api.tavily.com/search",
      "https://api.tavily.com/search",
    ]);
    expect(sent[0]?.headers.get("x-tavily-access-mode")).toBe("keyless");
    expect(sent[1]?.headers.get("authorization")).toBe("Bearer tv");
    expect(sent[0]?.body).toEqual({ query: "nyte", search_depth: "basic", max_results: 8 });
  });

  it("calls Exa's MCP route with the key as a query parameter and reads its text blocks", async () => {
    const text = "Title: Nyte\nURL: https://nyte.test\nPublished: N/A\nText: A harness.";
    const { sent, fetch } = recording(frame({ content: [{ type: "text", text }] }));

    expect(await adapters.exa({ query: "nyte", key: "ex", fetch, signal })).toEqual([
      { url: "https://nyte.test", title: "Nyte", content: "A harness." },
    ]);
    expect(sent[0]?.url).toBe("https://mcp.exa.ai/mcp?exaApiKey=ex");
    expect(sent[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query: "nyte", numResults: 8 } },
    });
  });

  it("calls Firecrawl's MCP route with a bearer key and decodes the JSON inside its text block", async () => {
    const payload = {
      success: true,
      data: { web: [{ url: "https://f.test", title: "F", description: null }] },
    };

    const { sent, fetch } = recording(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
      }),
    );

    expect(await adapters.firecrawl({ query: "nyte", key: "fc", fetch, signal })).toEqual([
      { url: "https://f.test", title: "F" },
    ]);
    expect(sent[0]).toMatchObject({
      url: "https://mcp.firecrawl.dev/v2/mcp",
      body: { params: { name: "firecrawl_search", arguments: { query: "nyte", limit: 8 } } },
    });
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer fc");
  });

  it("calls Parallel's MCP route keyless and reads its structured results", async () => {
    const { sent, fetch } = recording(
      frame({
        content: [],
        structuredContent: {
          results: [{ url: "https://p.test", title: "P", excerpts: ["one", "two"] }],
        },
      }),
    );

    expect(await adapters.parallel({ query: "nyte", key: undefined, fetch, signal })).toEqual([
      { url: "https://p.test", title: "P", content: "one\n\ntwo" },
    ]);
    expect(sent[0]).toMatchObject({
      url: "https://search.parallel.ai/mcp",
      body: {
        params: { name: "web_search", arguments: { objective: "nyte", search_queries: ["nyte"] } },
      },
    });
    expect(sent[0]?.headers.get("authorization")).toBeNull();
  });
});

it("routes web_search by its declared host setting, read through settings.value (§48b)", async () => {
  const { sent, fetch } = recording(
    JSON.stringify({ results: [{ url: "https://a.test", title: "A", content: "aa" }] }),
  );

  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "toolCall", id: "w", name: "web_search", arguments: { query: "nyte" } }] },
    { content: [{ type: "text", text: "Found." }] },
  );

  await using host = await open(fake, [webPlugin(fetch)]);
  expect(await host.settings.apply("web_search.provider", "tavily")).toEqual({ kind: "applied" });
  const { session, receipt: started } = await host.sessions.start({ content: "Search." });
  await started.settled();

  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({
    kind: "ok",
    content: [{ kind: "text", text: "## [A](https://a.test)\n\naa" }],
    output: { provider: "tavily", results: [{ url: "https://a.test", title: "A", content: "aa" }] },
  });
  expect(sent.map((request) => request.url)).toEqual(["https://api.tavily.com/search"]);
});
