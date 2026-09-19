/**
 * MCP through a real stdio server: the pool connects once for every session
 * that names the same config, the plugin puts the server's tools in front of
 * the model, and a server that cannot start is a warning, not a broken session.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test, vi } from "vitest";
import type { SessionEvent, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/plugin";
import {
  McpServers,
  bridgedToolName,
  mcpConfigVersion,
  mcpPlugin,
  mcpServerSettingId,
  type McpServerConfig,
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

test("closing the pool before a server starts never spawns it", async () => {
  const { servers } = open("nyte-mcp-orphan-");
  const pidFile = join(tmpdir(), `nyte-mcp-pid-${randomUUID()}`);
  const handle = servers.acquire(
    "echo",
    { ...echoServer, args: [...(echoServer.args ?? []), pidFile] },
    "/tmp",
  );
  // The close lands while the connect is still loading the SDK, before any client exists.
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
    offered.push(bridgedNames(context.tools ?? []));
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
    offered.push(bridgedNames(context.tools ?? []));
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
    [["mcp", "MCP server broken: connection closed"]],
  );
  assert.match((await runCommand(sdk, sessionId, "mcp")) ?? "", /^broken: failed \(/);
});
