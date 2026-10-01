import { getCurrentTools } from "@nyte-ai/schema";
/**
 * MCP through a real stdio server: the pool connects once for every session
 * that names the same config, the plugin puts the server's tools in front of
 * the model, and a server that cannot start is a warning, not a broken session.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpStructuredContentSchema,
  renderToolSignature,
} from "@earendil-works/pi-codemode/declarations";
import { ToolError } from "@nyte-ai/core/plugins";
import { Value } from "typebox/value";
import { afterEach, test, vi } from "vitest";
import type { SessionEvent, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import {
  McpServers,
  bridgedToolName,
  mcpConfigVersion,
  mcpPlugin,
  mcpServerSettingId,
  McpServerConfig,
} from "../src/mcp.ts";
import {
  TestWorkspace,
  prompt,
  respond,
  runCommand,
  settingOf,
  testModel,
  toolCall,
  toolParts,
  toolResultOf,
} from "./host.ts";

const echoServer: McpServerConfig = {
  exposure: "direct",
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/mcp-echo-server.ts", import.meta.url))],
};

/** The tools a stream saw that came over MCP; core offers its own tools alongside them. */
function bridgedNames(tools: readonly { readonly name: string }[]): string[] {
  const bridged = new Set(
    ["echo", "off"].flatMap((server) =>
      ["echo", "fail"].map((tool) => bridgedToolName(server, tool)),
    ),
  );
  return tools.map((tool) => tool.name).filter((name) => bridged.has(name));
}

const workspaces: TestWorkspace[] = [];
const pools: McpServers[] = [];
const savedOutputs: string[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
  for (const pool of pools.splice(0)) await pool.close();
  for (const path of savedOutputs.splice(0)) await rm(path, { force: true });
});

function open(prefix: string): { workspace: TestWorkspace; servers: McpServers } {
  const workspace = TestWorkspace.create(prefix);
  const servers = new McpServers();
  workspaces.push(workspace);
  pools.push(servers);
  return { workspace, servers };
}

test("the pool connects a stdio server, bridges its tools, and shares the connection", async () => {
  const { servers } = open("nyte-mcp-pool-");
  const first = servers.acquire("echo", echoServer, "/tmp");
  const second = servers.acquire("echo", echoServer, "/tmp");
  await first.ready();
  const status = first.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  assert.equal(status.instructions, "Echo repeats what it is told.");
  assert.deepEqual(
    status.tools.map((tool) => tool.name),
    [bridgedToolName("echo", "echo"), bridgedToolName("echo", "fail")],
  );
  assert.equal(second.status(), status);
  const echo = status.tools[0];
  assert.ok(echo);
  assert.equal(echo.namespace?.instructions, "Echo repeats what it is told.");
  const result = await echo.execute("call-1", { text: "hi" });
  assert.deepEqual(result.content, [{ type: "text", text: "echo: hi" }]);
  const fail = status.tools[1];
  assert.ok(fail);
  assert.deepEqual(result.structuredContent, {
    content: [{ type: "text", text: "echo: hi", _meta: { block: true } }],
    structuredContent: { text: "echo: hi" },
  });
  const structuredSchema = mcpStructuredContentSchema({ ...echo.outputSchema });
  assert.ok(typeof structuredSchema === "object" && structuredSchema !== null);
  assert.equal(structuredSchema.type, "object");
  assert.deepEqual(structuredSchema.properties, { text: { type: "string" } });
  assert.deepEqual(structuredSchema.required, ["text"]);
  assert.match(
    renderToolSignature({
      name: echo.name,
      inputSchema: { ...echo.parameters },
      outputSchema: { ...echo.outputSchema },
    }),
    /Promise<CallToolResult</,
  );
  await assert.rejects(fail.execute("call-2", {}), (cause: unknown) => {
    assert.ok(cause instanceof ToolError);
    assert.deepEqual(cause.result.structuredContent, {
      isError: true,
      content: [{ type: "text", text: "no" }],
      structuredContent: { reason: "no" },
    });
    return true;
  });
  first.release();
  second.release();
});

test("a server that cannot start fails with its stderr and never rejects ready()", async () => {
  const { servers } = open("nyte-mcp-fail-");
  const handle = servers.acquire(
    "broken",
    { command: process.execPath, args: ["-e", "process.stderr.write('boom\\n'); process.exit(3)"] },
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "failed");
  if (status.kind === "failed") assert.match(status.error, /boom/);
  handle.release();
});

test("retry subscribers see the replacement connection before it starts", async () => {
  const { servers } = open("nyte-mcp-retry-");
  const config = { command: process.execPath, args: ["-e", "process.exit(1)"] };
  const handle = servers.acquire("broken", config, "/tmp");
  await handle.ready();
  const statuses: string[] = [];
  handle.subscribe(() => statuses.push(handle.status().kind));

  servers.reconnectFailed();
  assert.deepEqual(statuses, ["connecting"]);
  await handle.ready();
  assert.deepEqual(statuses, ["connecting", "failed"]);

  const second = servers.acquire("broken", config, "/tmp");
  assert.deepEqual(statuses, ["connecting", "failed", "connecting"]);
  await second.ready();
  assert.deepEqual(statuses, ["connecting", "failed", "connecting", "failed"]);
  second.release();
  handle.release();
});

test("closing the pool before a server starts never spawns it", async () => {
  const { servers } = open("nyte-mcp-orphan-");
  const pidFile = join(tmpdir(), `nyte-mcp-pid-${randomUUID()}`);
  const handle = servers.acquire(
    "echo",
    { ...echoServer, args: [...(echoServer.args ?? []), pidFile] },
    "/tmp",
  );
  // Closing in the same turn prevents the deferred connection from spawning a child.
  await servers.close();
  await handle.ready();
  // The fixture records its pid at startup, so the file appearing means a server was left running.
  await assert.rejects(readFile(pidFile, "utf8"), /ENOENT/);
  assert.equal(handle.status().kind, "connecting");
});

test("a server that never answers does not hold up the session", async () => {
  const { workspace, servers } = open("nyte-mcp-slow-");
  // The child starts and then says nothing, so the handshake runs to its 30s timeout.
  const config = {
    mute: { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
  };
  const started = Date.now();
  const sdk = await workspace.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "ok" }]),
    model: testModel,
    plugins: [inlinePlugin(mcpPlugin({ servers, config }), { version: mcpConfigVersion(config) })],
  });
  assert.deepEqual(await prompt(sdk, workspace.sessionId, "hi"), { kind: "idle" });
  assert.ok(
    Date.now() - started < 10_000,
    "the session waited on a server instead of opening without it",
  );
}, 60_000);

test("the plugin offers the server's tools to the model and runs a call through it", async () => {
  const { workspace, servers } = open("nyte-mcp-plugin-");
  const offered: string[][] = [];
  const streamFn: StreamFn = (model, context) => {
    offered.push(bridgedNames(getCurrentTools(context.messages)));
    return offered.length === 1
      ? respond(model, [toolCall("c1", bridgedToolName("echo", "echo"), { text: "there" })])
      : respond(model, [{ type: "text", text: "done" }]);
  };
  const config = { echo: echoServer, off: { ...echoServer, disabled: true } };
  const sdk = await workspace.open({
    streamFn,
    model: testModel,
    plugins: [inlinePlugin(mcpPlugin({ servers, config }), { version: mcpConfigVersion(config) })],
  });
  const { sessionId } = workspace;
  assert.deepEqual(await prompt(sdk, sessionId, "echo it"), { kind: "idle" });
  assert.deepEqual(offered, [
    [bridgedToolName("echo", "echo"), bridgedToolName("echo", "fail")],
    [bridgedToolName("echo", "echo"), bridgedToolName("echo", "fail")],
  ]);
  const parts = await toolParts(sdk, sessionId);
  assert.deepEqual(
    parts.map((part) => [part.callId, part.class, part.result?.output, part.result?.isError]),
    [["c1", { kind: "custom", label: "echo: echo" }, "echo: there", false]],
  );
  assert.equal(
    (await toolResultOf({ sdk, sessionId, callId: "c1" })).toolName,
    bridgedToolName("echo", "echo"),
  );
  assert.equal(await runCommand(sdk, sessionId, "mcp"), "echo: 2 tools\noff: off");
});

test("a server's setting turns it off and on for the session", async () => {
  const { workspace, servers } = open("nyte-mcp-setting-");
  const offered: string[][] = [];
  const streamFn: StreamFn = (model, context) => {
    offered.push(bridgedNames(getCurrentTools(context.messages)));
    return respond(model, [{ type: "text", text: "ok" }]);
  };
  const config = { echo: echoServer, off: { ...echoServer, disabled: true } };
  const sdk = await workspace.open({
    streamFn,
    model: testModel,
    plugins: [inlinePlugin(mcpPlugin({ servers, config }), { version: mcpConfigVersion(config) })],
  });
  const { sessionId } = workspace;
  const echoSetting = mcpServerSettingId("echo");
  const offSetting = mcpServerSettingId("off");
  // The manifest's `disabled` is only the default the setting starts from.
  assert.equal(await settingOf(sdk, sessionId, echoSetting), "on");
  assert.equal(await settingOf(sdk, sessionId, offSetting), "off");

  assert.deepEqual(
    await sdk.plugins.settings.apply({ sessionId, id: echoSetting, choiceId: "off" }),
    { kind: "applied" },
  );
  await vi.waitFor(async () => {
    assert.equal(await runCommand(sdk, sessionId, "mcp"), "echo: off\noff: off");
  });
  assert.deepEqual(await prompt(sdk, sessionId, "nothing bridged"), { kind: "idle" });
  assert.deepEqual(offered.at(-1), []);

  assert.deepEqual(
    await sdk.plugins.settings.apply({ sessionId, id: offSetting, choiceId: "on" }),
    { kind: "applied" },
  );
  await vi.waitFor(async () => {
    assert.equal(await runCommand(sdk, sessionId, "mcp"), "echo: off\noff: 2 tools");
  });
  assert.deepEqual(await prompt(sdk, sessionId, "the other one"), { kind: "idle" });
  assert.deepEqual(offered.at(-1), [
    bridgedToolName("off", "echo"),
    bridgedToolName("off", "fail"),
  ]);
});

test("a failing server is a warning the client sees, and the session still answers", async () => {
  const { workspace, servers } = open("nyte-mcp-warn-");
  const notices: SessionEvent[] = [];
  const sdk = await workspace.open({
    streamFn: (model) => respond(model, [{ type: "text", text: "fine" }]),
    model: testModel,
    plugins: [inlinePlugin(mcpPlugin({ servers, config: {} }), { version: mcpConfigVersion({}) })],
  });
  const { sessionId } = workspace;
  const controller = new AbortController();
  const { promise: attached, resolve: synced } = Promise.withResolvers<void>();
  const watching = (async () => {
    for await (const event of sdk.watch({ sessionId, live: true, signal: controller.signal })) {
      if (event.kind === "synced") synced();
      if (event.kind === "diagnostic") notices.push(event);
    }
  })().catch(() => undefined);
  await attached;
  // The manifest gains a server that cannot start: the reload warns, the session keeps working.
  const config = { broken: { command: process.execPath, args: ["-e", "process.exit(1)"] } };
  await sdk.setPlugins([
    inlinePlugin(mcpPlugin({ servers, config }), { version: mcpConfigVersion(config) }),
  ]);
  assert.deepEqual(await prompt(sdk, sessionId, "hello"), { kind: "idle" });
  controller.abort();
  await watching;
  assert.deepEqual(
    notices.map((event) => (event.kind === "diagnostic" ? [event.owner, event.message] : [])),
    [["mcp", "MCP server broken: MCP connection closed"]],
  );
  assert.match((await runCommand(sdk, sessionId, "mcp")) ?? "", /^broken: failed \(/);
});

function boundaryServer(options: unknown): McpServerConfig {
  return {
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./fixtures/mcp-boundary-server.ts", import.meta.url)),
      JSON.stringify(options),
    ],
  };
}

const emptyInput = { type: "object" };

test("MCP exposure validates and defaults to codemode, with exact overrides before ordered patterns", async () => {
  const { servers } = open("nyte-mcp-exposure-");
  const config = boundaryServer({
    tools: [
      { name: "echo", inputSchema: emptyInput },
      { name: "echo_private", inputSchema: emptyInput },
      { name: "fail", inputSchema: emptyInput },
      { name: "other", inputSchema: emptyInput },
    ],
  });
  assert.equal(Value.Check(McpServerConfig, { ...config, exposure: "model-only" }), false);
  assert.equal(
    Value.Check(McpServerConfig, { ...config, toolExposure: { echo: "invalid" } }),
    false,
  );
  assert.equal(Value.Check(McpServerConfig, { ...config, toolExposure: [] }), false);
  for (const exposure of ["direct", "codemode", "deferred", "hidden"]) {
    assert.equal(
      Value.Check(McpServerConfig, { ...config, exposure, toolExposure: { echo: exposure } }),
      true,
    );
  }
  const defaults = servers.acquire("default", config, "/tmp");
  const overridden = servers.acquire(
    "overridden",
    {
      ...config,
      description: "  Echo tools  ",
      toolExposure: { "echo*": "deferred", "*": "hidden", echo: "direct" },
    },
    "/tmp",
  );
  await Promise.all([defaults.ready(), overridden.ready()]);
  const defaultStatus = defaults.status();
  const overrideStatus = overridden.status();
  assert.equal(defaultStatus.kind, "connected");
  assert.equal(overrideStatus.kind, "connected");
  if (defaultStatus.kind !== "connected" || overrideStatus.kind !== "connected") return;
  assert.deepEqual(
    defaultStatus.tools.map((tool) => tool.exposure),
    ["codemode", "codemode", "codemode", "codemode"],
  );
  assert.deepEqual(
    overrideStatus.tools.map((tool) => tool.exposure),
    ["direct", "deferred", "hidden", "hidden"],
  );
  assert.deepEqual(overrideStatus.tools[0]?.namespace, {
    name: "mcp__overridden",
    description: "Echo tools",
  });
  assert.deepEqual(defaultStatus.tools[0]?.parameters, { type: "object", properties: {} });
  assert.equal(mcpStructuredContentSchema({ ...defaultStatus.tools[0]?.outputSchema }), true);
});

test("MCP names stay distinct after sanitizing or shortening and route calls to the original tool", async () => {
  const toolNames = ["a-b", "a_b", "long".repeat(30) + "a", "long".repeat(30) + "b"];
  const config = boundaryServer({
    tools: toolNames.map((name) => ({ name, inputSchema: emptyInput })),
  });
  const { servers } = open("nyte-mcp-names-");
  const handle = servers.acquire("names", config, "/tmp");
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const names = status.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, 4);
  for (const name of names) {
    assert.ok(name.length <= 64);
    assert.match(name, /^mcp__names__\w+_[a-f0-9]{8}$/);
  }
  assert.equal(bridgedToolName("server-name", "tool-name"), "mcp__server_name__tool_name");
  for (const [index, tool] of status.tools.entries()) {
    assert.deepEqual((await tool.execute(`c${String(index)}`, {})).content, [
      { type: "text", text: toolNames[index] },
    ]);
  }
  const reversed = servers.acquire(
    "names",
    boundaryServer({
      tools: toolNames.toReversed().map((name) => ({ name, inputSchema: emptyInput })),
    }),
    "/tmp",
  );
  await reversed.ready();
  const reversedStatus = reversed.status();
  assert.equal(reversedStatus.kind, "connected");
  if (reversedStatus.kind === "connected") {
    assert.deepEqual(
      reversedStatus.tools.map((tool) => tool.name),
      names.toReversed(),
    );
  }
});

test("MCP names do not collide across servers in the pool", async () => {
  const { servers } = open("nyte-mcp-server-names-");
  const first = servers.acquire("same-name", echoServer, "/tmp");
  await first.ready();
  const second = servers.acquire("same_name", echoServer, "/tmp");
  await second.ready();
  const firstStatus = first.status();
  const secondStatus = second.status();
  assert.equal(firstStatus.kind, "connected");
  assert.equal(secondStatus.kind, "connected");
  if (firstStatus.kind !== "connected" || secondStatus.kind !== "connected") return;
  assert.equal(
    new Set([...firstStatus.tools, ...secondStatus.tools].map((tool) => tool.name)).size,
    4,
  );
});

test("Pi converts images, embedded resources, audio and structured-only output while scripts retain the full result", async () => {
  const content = [
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    { type: "resource", resource: { uri: "file:///text", text: "resource text" } },
    {
      type: "resource",
      resource: { uri: "file:///image", blob: "aGVsbG8=", mimeType: "image/png" },
    },
    { type: "audio", data: "aGVsbG8=", mimeType: "audio/wav" },
    { type: "resource_link", uri: "file:///link", name: "document" },
  ];
  const { servers } = open("nyte-mcp-content-");
  const handle = servers.acquire(
    "content",
    boundaryServer({
      tools: [{ name: "content", inputSchema: emptyInput }],
      result: { content, structuredContent: { value: 42 }, _meta: { secret: true } },
    }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const tool = status.tools[0];
  assert.ok(tool);
  const result = await tool.execute("content", {});
  assert.deepEqual(result.content, [
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    { type: "text", text: "resource text" },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    { type: "text", text: "[audio audio/wav omitted]" },
    { type: "text", text: '[Resource file:///link "document"]' },
  ]);
  assert.deepEqual(result.structuredContent, { content, structuredContent: { value: 42 } });
  const structured = servers.acquire(
    "structured",
    boundaryServer({
      tools: [{ name: "structured", inputSchema: emptyInput }],
      result: { structuredContent: { value: 42 } },
    }),
    "/tmp",
  );
  await structured.ready();
  const structuredStatus = structured.status();
  assert.equal(structuredStatus.kind, "connected");
  if (structuredStatus.kind !== "connected") return;
  const structuredTool = structuredStatus.tools[0];
  assert.ok(structuredTool);
  const structuredResult = await structuredTool.execute("structured", {});
  assert.deepEqual(structuredResult.content, [{ type: "text", text: '{\n  "value": 42\n}' }]);
  assert.deepEqual(structuredResult.structuredContent, {
    content: [],
    structuredContent: { value: 42 },
  });
});

test("an MCP error without text still carries its full script result", async () => {
  const { servers } = open("nyte-mcp-empty-error-");
  const handle = servers.acquire(
    "error",
    boundaryServer({
      tools: [{ name: "fail", inputSchema: emptyInput }],
      result: { content: [], isError: true, _meta: { secret: true } },
    }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const tool = status.tools[0];
  assert.ok(tool);
  await assert.rejects(tool.execute("fail", {}), (cause: unknown) => {
    assert.ok(cause instanceof ToolError);
    assert.match(cause.message, /MCP tool error\/fail returned an error/);
    assert.deepEqual(cause.result.structuredContent, { content: [], isError: true });
    return true;
  });
});

for (const tool of [
  { name: "bad", inputSchema: emptyInput, description: 42 },
  { name: "bad", inputSchema: { type: "array" } },
  { name: "bad", inputSchema: { type: "object", properties: { value: null } } },
  { name: "bad", inputSchema: emptyInput, outputSchema: null },
  { name: "bad", inputSchema: emptyInput, annotations: { readOnlyHint: "yes" } },
]) {
  test(`malformed MCP catalog data fails the connection: ${JSON.stringify(tool)}`, async () => {
    const { servers } = open("nyte-mcp-bad-catalog-");
    const handle = servers.acquire("bad", boundaryServer({ tools: [tool] }), "/tmp");
    await handle.ready();
    const status = handle.status();
    assert.equal(status.kind, "failed");
    if (status.kind === "failed") assert.match(status.error, /Invalid MCP tools\/list entry/);
  });
}

for (const result of [
  { content: [{ type: "text", text: 42 }] },
  { content: [{ type: "image", data: "bytes" }] },
  { content: [{ type: "image", data: "not base64!", mimeType: "image/png" }] },
  { content: [{ type: "resource", resource: null }] },
  { content: [{ type: "unknown" }] },
  { content: [], isError: "yes" },
  { content: [], structuredContent: [] },
]) {
  test(`malformed MCP call data rejects before conversion: ${JSON.stringify(result)}`, async () => {
    const { servers } = open("nyte-mcp-bad-result-");
    const handle = servers.acquire(
      "bad",
      boundaryServer({ tools: [{ name: "bad", inputSchema: emptyInput }], result }),
      "/tmp",
    );
    await handle.ready();
    const status = handle.status();
    assert.equal(status.kind, "connected");
    if (status.kind !== "connected") return;
    const tool = status.tools[0];
    assert.ok(tool);
    await assert.rejects(tool.execute("bad", {}), /Invalid MCP tools\/call/);
    assert.equal(handle.status().kind, "connected");
  });
}

test("Pi follows catalog pages and refreshes tools after a server notification", async () => {
  const { servers } = open("nyte-mcp-catalog-refresh-");
  const handle = servers.acquire(
    "catalog",
    boundaryServer({
      tools: [
        { name: "first", inputSchema: emptyInput },
        { name: "second", inputSchema: emptyInput },
      ],
      paginated: true,
      nextTools: [{ name: "replacement", inputSchema: emptyInput }],
    }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  assert.deepEqual(
    status.tools.map((tool) => tool.name),
    ["mcp__catalog__first", "mcp__catalog__second"],
  );
  const tool = status.tools[0];
  assert.ok(tool);
  await tool.execute("refresh", {});
  await vi.waitFor(() => {
    const refreshed = handle.status();
    assert.equal(refreshed.kind, "connected");
    if (refreshed.kind === "connected")
      assert.deepEqual(
        refreshed.tools.map((entry) => entry.name),
        ["mcp__catalog__replacement"],
      );
  });
});

test("Pi forwards progress and sends cancellation to the server", async () => {
  const { servers } = open("nyte-mcp-cancel-");
  const handle = servers.acquire(
    "cancel",
    boundaryServer({
      tools: [{ name: "wait", inputSchema: emptyInput }],
      waitForCancellation: true,
    }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const tool = status.tools[0];
  assert.ok(tool);
  const controller = new AbortController();
  const progress: string[] = [];
  const { promise: started, resolve: received } = Promise.withResolvers<void>();
  const running = tool.execute("wait", {}, controller.signal, (result) => {
    progress.push(
      ...result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
    );
    received();
  });
  const rejected = assert.rejects(running, /abort/i);
  await started;
  controller.abort();
  await rejected;
  assert.deepEqual(progress, ["Working"]);
  await vi.waitFor(() => {
    const refreshed = handle.status();
    assert.equal(refreshed.kind, "connected");
    if (refreshed.kind === "connected")
      assert.deepEqual(
        refreshed.tools.map((entry) => entry.name),
        ["mcp__cancel__cancelled"],
      );
  });
});

test("the Pi HTTP transport sends configured headers and calls a real local MCP server", async () => {
  const { servers } = open("nyte-mcp-http-");
  const server = new McpServer({ name: "http", version: "0" });
  server.registerTool("ping", { inputSchema: {} }, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await server.connect(transport);
  const headers: (string | undefined)[] = [];
  const http = createServer((request, response) => {
    headers.push(request.headers.authorization);
    void transport.handleRequest(request, response);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const address = http.address();
    assert.ok(address !== null && typeof address !== "string");
    const handle = servers.acquire(
      "http",
      {
        url: `http://127.0.0.1:${String(address.port)}/mcp`,
        headers: { Authorization: "Bearer local-test" },
      },
      "/tmp",
    );
    await handle.ready();
    const status = handle.status();
    assert.equal(status.kind, "connected", JSON.stringify(status));
    if (status.kind !== "connected") return;
    const tool = status.tools[0];
    assert.ok(tool);
    assert.deepEqual((await tool.execute("http", {})).content, [{ type: "text", text: "pong" }]);
    assert.ok(headers.length > 2);
    assert.ok(headers.every((header) => header === "Bearer local-test"));
  } finally {
    await servers.close();
    await server.close();
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Pi truncates model text at UTF-8 boundaries and saves the uncut output privately", async () => {
  const { servers } = open("nyte-mcp-truncation-");
  const text = `START\n${"🐈".repeat(6000)}\nEND\n`;
  const content = [
    { type: "text", text },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
  ];
  const handle = servers.acquire(
    "large",
    boundaryServer({
      tools: [{ name: "large", inputSchema: emptyInput }],
      result: { content, structuredContent: { text } },
    }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const tool = status.tools[0];
  assert.ok(tool);
  const result = await tool.execute("large", {});
  const path = result.details.fullOutputPath;
  assert.ok(path);
  savedOutputs.push(path);
  const output = result.content[0];
  assert.ok(output?.type === "text");
  assert.match(output.text, /Warning: truncated output/);
  assert.match(output.text, /Total output lines: 3/);
  assert.match(output.text, /START\n/);
  assert.match(output.text, /chars truncated/);
  assert.match(output.text, /\nEND\n/);
  assert.ok(!output.text.includes("�"));
  assert.ok(output.text.includes(path));
  assert.deepEqual(result.content[1], { type: "image", data: "aGVsbG8=", mimeType: "image/png" });
  assert.deepEqual(result.structuredContent, { content, structuredContent: { text } });
  assert.equal(await readFile(path, "utf8"), text);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("Pi decodes text blobs and saves binary resources with their file extension", async () => {
  const { servers } = open("nyte-mcp-binary-");
  const bytes = Buffer.from([0, 1, 2, 255]);
  const content = [
    {
      type: "resource",
      resource: {
        uri: "file:///data.json",
        mimeType: "application/json",
        blob: Buffer.from('{"ok":true}').toString("base64"),
      },
    },
    {
      type: "resource",
      resource: {
        uri: "file:///archive.dat",
        mimeType: "application/octet-stream",
        blob: bytes.toString("base64"),
      },
    },
    {
      type: "resource_link",
      uri: "file:///link",
      name: "raw",
      title: "Document",
      description: "A reference",
      mimeType: "text/plain",
      size: 2048,
    },
  ];
  const handle = servers.acquire(
    "binary",
    boundaryServer({ tools: [{ name: "binary", inputSchema: emptyInput }], result: { content } }),
    "/tmp",
  );
  await handle.ready();
  const status = handle.status();
  assert.equal(status.kind, "connected");
  if (status.kind !== "connected") return;
  const tool = status.tools[0];
  assert.ok(tool);
  const result = await tool.execute("binary", {});
  const binary = result.content[1];
  assert.ok(binary?.type === "text");
  const path = /saved to (.+)\]$/.exec(binary.text)?.[1];
  assert.ok(path);
  savedOutputs.push(path);
  assert.match(path, /\.dat$/);
  assert.deepEqual(await readFile(path), bytes);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(result.content[0], { type: "text", text: '{"ok":true}' });
  assert.deepEqual(result.content[2], {
    type: "text",
    text: '[Resource file:///link "Document" (text/plain, 2.0KB): A reference]',
  });
  assert.deepEqual(result.structuredContent, { content });
});
