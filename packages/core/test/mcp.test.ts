import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FetchLike } from "@modelcontextprotocol/client";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  MCP_PROTOCOL_VERSION,
  ToolError,
  callMcpTool,
  discoverMcpTools,
  mcpToolName,
  type McpHttpServer,
} from "../src/plugins/index.ts";

const RpcRequestSchema = Type.Object({
  jsonrpc: Type.Literal("2.0"),
  id: Type.Union([Type.String(), Type.Number()]),
  method: Type.String(),
  params: Type.Optional(Type.Unknown()),
});
type RpcRequest = Static<typeof RpcRequestSchema>;

interface SeenRequest {
  readonly request: RpcRequest;
  readonly headers: Headers;
}

function parseRequestBody(init: RequestInit | undefined): RpcRequest {
  if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
  const value: unknown = JSON.parse(init.body);
  if (!Value.Check(RpcRequestSchema, value)) throw new Error("invalid JSON-RPC request");
  return value;
}

function complete(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { resultType: "complete", ttlMs: 0, cacheScope: "private", ...value };
}

function serverResult(request: RpcRequest): Readonly<Record<string, unknown>> {
  switch (request.method) {
    case "server/discover":
      return {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: {} },
      };
    case "tools/list":
      return complete({
        tools: [
          {
            name: "remote.echo",
            title: "Remote echo",
            description: "Echo a value",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
      });
    case "tools/call":
      return complete({
        content: [
          { type: "text", text: "echoed" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          { type: "resource_link", name: "source", uri: "https://example.test/source" },
        ],
        structuredContent: { echoed: true },
      });
    default:
      throw new Error(`unexpected MCP method: ${request.method}`);
  }
}

function fakeFetch(
  seen: SeenRequest[],
  result: (request: RpcRequest) => Readonly<Record<string, unknown>> = serverResult,
  methods?: string[],
): FetchLike {
  return (url, init) => {
    assert.equal(new URL(url).href, "https://mcp.example.test/service");
    methods?.push(init?.method ?? "GET");
    const request = parseRequestBody(init);
    seen.push({ request, headers: new Headers(init?.headers) });
    return Promise.resolve(
      Response.json({ jsonrpc: "2.0", id: request.id, result: result(request) }),
    );
  };
}

function remoteServer(seen: SeenRequest[], methods?: string[]): McpHttpServer {
  return {
    id: "example",
    url: new URL("https://mcp.example.test/service"),
    headers: { Authorization: "Bearer secret" },
    fetch: fakeFetch(seen, serverResult, methods),
  };
}

void describe("modern MCP tools", () => {
  void test("builds stable provider-safe tool names", () => {
    assert.equal(
      mcpToolName({ serverId: "example", remoteToolName: "echo" }),
      "mcp_7_example_echo",
    );
    assert.notEqual(
      mcpToolName({ serverId: "a_b", remoteToolName: "c" }),
      mcpToolName({ serverId: "a", remoteToolName: "b_c" }),
    );
    const first = mcpToolName({
      serverId: "server.with spaces",
      remoteToolName:
        "a very long tool name/with punctuation/and/more/segments/than/providers/allow",
    });
    const second = mcpToolName({
      serverId: "server.with spaces",
      remoteToolName:
        "a very long tool name/with punctuation/and/more/segments/than/providers/allow",
    });
    assert.equal(first, second);
    assert.match(first, /^[A-Za-z_][A-Za-z0-9_-]*$/u);
    assert.equal(first.length <= 64, true);
    assert.throws(() => mcpToolName({ serverId: "", remoteToolName: "echo" }), /must not be empty/);
  });

  void test("discovers once, registers a stable tool, and calls without a legacy handshake", async () => {
    const seen: SeenRequest[] = [];
    const methods: string[] = [];
    const tools = await discoverMcpTools({ server: remoteServer(seen, methods) });

    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.ok(tool !== undefined);
    assert.equal(tool.name, mcpToolName({ serverId: "example", remoteToolName: "remote.echo" }));
    assert.equal(tool.label, "Remote echo");
    assert.equal(tool.replay, "never");

    const result = await tool.execute("call-1", { text: "hello" });
    assert.deepEqual(result.content, [
      { type: "text", text: "echoed" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      { type: "text", text: "source: https://example.test/source" },
    ]);
    assert.deepEqual(result.details, {
      serverId: "example",
      remoteToolName: "remote.echo",
      structuredContent: { echoed: true },
    });
    assert.deepEqual(
      seen.map(({ request }) => request.method),
      ["server/discover", "tools/list", "tools/call"],
    );
    assert.deepEqual(methods, ["POST", "POST", "POST"]);
    assert.equal(
      seen.some(({ request }) => request.method === "initialize"),
      false,
    );
    assert.equal(
      seen.every(({ headers }) => headers.get("Authorization") === "Bearer secret"),
      true,
    );
    assert.equal(
      seen.every(({ headers }) => headers.get("MCP-Protocol-Version") === MCP_PROTOCOL_VERSION),
      true,
    );
  });

  void test("turns remote tool failures into structured ToolError values", async () => {
    const seen: SeenRequest[] = [];
    const server = {
      ...remoteServer(seen),
      fetch: fakeFetch(seen, (request) => {
        if (request.method !== "tools/call") return serverResult(request);
        return complete({
          isError: true,
          content: [{ type: "text", text: "remote rejected the request" }],
          structuredContent: { code: "denied" },
        });
      }),
    };

    await assert.rejects(
      callMcpTool({
        server,
        name: "remote.echo",
        arguments: { text: "hello" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.message, "remote rejected the request");
        assert.deepEqual(error.result.details, {
          serverId: "example",
          remoteToolName: "remote.echo",
          structuredContent: { code: "denied" },
        });
        return true;
      },
    );
    assert.deepEqual(
      seen.map(({ request }) => request.method),
      ["server/discover", "tools/list", "tools/call"],
    );
  });

  void test("rejects a legacy server without initialize, GET, or transport fallback", async () => {
    const seen: SeenRequest[] = [];
    const methods: string[] = [];
    const server: McpHttpServer = {
      id: "legacy",
      url: new URL("https://mcp.example.test/service"),
      fetch: fakeFetch(
        seen,
        () => ({
          supportedVersions: ["2025-06-18"],
          capabilities: { tools: {} },
        }),
        methods,
      ),
    };

    await assert.rejects(discoverMcpTools({ server }), /Unsupported protocol version: 2026-07-28/);
    assert.deepEqual(
      seen.map(({ request }) => request.method),
      ["server/discover"],
    );
    assert.deepEqual(methods, ["POST"]);
  });

  void test("rejects conflicting names from one server instead of using order-based suffixes", async () => {
    const seen: SeenRequest[] = [];
    const server: McpHttpServer = {
      ...remoteServer(seen),
      fetch: fakeFetch(seen, (request) => {
        if (request.method !== "tools/list") return serverResult(request);
        const definition = {
          name: "same",
          inputSchema: { type: "object", properties: {} },
        };
        return complete({ tools: [definition, definition] });
      }),
    };

    await assert.rejects(discoverMcpTools({ server }), /conflicting tool names/);
  });
});
