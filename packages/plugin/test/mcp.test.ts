/**
 * MCP through a real stdio server: the pool connects once for every session
 * that names the same config, the plugin puts the server's tools in front of
 * the model, and a server that cannot start is a warning, not a broken session.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";
import type { SessionEvent, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import {
  McpServers,
  bridgedToolName,
  mcpConfigVersion,
  mcpPlugin,
  type McpServerConfig,
} from "../src/mcp.ts";
import {
  TestWorkspace,
  prompt,
  respond,
  runCommand,
  testModel,
  toolCall,
  toolParts,
} from "./host.ts";

const echoServer: McpServerConfig = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/mcp-echo-server.ts", import.meta.url))],
};

const workspaces: TestWorkspace[] = [];
const pools: McpServers[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
  for (const pool of pools.splice(0)) await pool.close();
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
  const result = await echo.execute("call-1", { text: "hi" });
  assert.deepEqual(result.content, [{ type: "text", text: "echo: hi" }]);
  const fail = status.tools[1];
  assert.ok(fail);
  await assert.rejects(fail.execute("call-2", {}), /no/);
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

test("the plugin offers the server's tools to the model and runs a call through it", async () => {
  const { workspace, servers } = open("nyte-mcp-plugin-");
  const offered: string[][] = [];
  const streamFn: StreamFn = (model, context) => {
    offered.push((context.tools ?? []).map((tool) => tool.name));
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
    parts.map((part) => [part.toolName, part.result?.output, part.result?.isError]),
    [[bridgedToolName("echo", "echo"), "echo: there", false]],
  );
  assert.equal(await runCommand(sdk, sessionId, "mcp"), "echo: 2 tools");
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
    [["mcp", "MCP server broken: connection closed"]],
  );
  assert.match((await runCommand(sdk, sessionId, "mcp")) ?? "", /^broken: failed \(/);
});
