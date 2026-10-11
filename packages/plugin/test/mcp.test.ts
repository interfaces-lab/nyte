import { LATEST_PROTOCOL_VERSION, isJsonRpcRequest } from "@earendil-works/pi-mcp";
import type { McpTransport } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { isPart, tool } from "@nyte-ai/core";
import { assert, expect, it } from "vitest";
import { mcpPlugin } from "../src/mcp.ts";
import { fakeModels, open, until } from "./fake-models.ts";

/** Serves a fake MCP server with one `echo` tool on the server end of an in-memory pair, and returns the client end; `drop` closes the server end once its tools were listed. */
function fakeServer(drop = false): McpTransport {
  const { client, server } = createInMemoryTransportPair();

  const answer = (method: string, params: unknown): unknown => {
    if (method === "initialize")
      return { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } };

    if (method === "tools/list")
      return {
        tools: [
          {
            name: "echo",
            description: "Repeat the text.",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      };

    const text = typeof params === "object" && params !== null && "arguments" in params ? JSON.stringify(params.arguments) : "";

    return { content: [{ type: "text", text: `echo ${text}` }] };
  };

  server.onMessage((message) => {
    if (!isJsonRpcRequest(message)) return;
    void server
      .send({ jsonrpc: "2.0", id: message.id, result: answer(message.method, message.params) })
      .then(() => (drop && message.method === "tools/list" ? server.close() : undefined));
  });
  void server.start();

  return client;
}

it("lists a fake server's tools in the session as <server>_<tool> and calls one over the link", async () => {
  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "toolCall", id: "m", name: "fake_echo", arguments: { text: "hi" } }] },
    { content: [{ type: "text", text: "Echoed." }] },
  );

  await using host = await open(fake, [mcpPlugin(() => fakeServer())]);
  expect(await host.settings.apply("mcp.servers", { fake: { url: "memory://fake" } })).toMatchObject({ kind: "applied" });

  const session = await host.sessions.create();

  const listed = await until(async () =>
    (await session.view()).catalog.tools.find((info) => info.name === "fake_echo"),
  );

  expect(listed).toMatchObject({ owner: "mcp", description: "Repeat the text.", parameters: { required: ["text"] } });

  await (await session.send("Echo hi.")).settled();
  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({ kind: "ok", content: [{ kind: "text", text: 'echo {"text":"hi"}' }] });
});

it("reports a dropped link, lists no tools from it, and reconnects", async () => {
  let connects = 0;
  const fake = fakeModels();

  await using host = await open(fake, [mcpPlugin(() => fakeServer(++connects === 1))]);
  await host.settings.apply("mcp.servers", { fake: { url: "memory://fake" } });
  const session = await host.sessions.create();

  const dropped = await until(() =>
    host.kernel.host
      .current()
      .plugins.find((row) => row.id === "mcp")
      ?.issues.find((issue) => issue.message === "The link to fake closed."),
  );

  expect(dropped).toMatchObject({ severity: "warning", path: ["mcp.servers", "fake"] });
  expect(await until(async () => (connects === 2 ? (await session.view()).catalog.tools.find((info) => info.name === "fake_echo") : undefined))).toMatchObject({ namespace: "mcp/fake" });
});
