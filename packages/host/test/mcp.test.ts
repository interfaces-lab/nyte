import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_PROTOCOL_VERSION, isJsonRpcRequest } from "@earendil-works/pi-mcp";
import type { McpTransport } from "@earendil-works/pi-mcp";
import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { isPart, memoryStore, tool } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Host } from "@nyte-ai/core";
import type { McpView } from "@nyte-ai/schema";
import { afterEach, assert, expect, it, vi } from "vitest";
import { createMcpHub, openHost } from "../src/index.ts";
import type { McpConnector } from "../src/index.ts";
import { chatOnly, fakeModels } from "../src/bench/fake-models.ts";
import type { FakeModels } from "../src/bench/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function home(servers: object): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-mcp-")));
  folders.push(made);
  await mkdir(join(made, ".nyte"));
  await writeMcp(made, servers);

  return made;
}

function writeMcp(folder: string, servers: object): Promise<void> {
  return writeFile(join(folder, ".nyte", "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

function fakeServer(drop = false): McpTransport {
  const { client, server } = createInMemoryTransportPair();

  const answer = (method: string, params: unknown): unknown => {
    if (method === "initialize")
      return {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0" },
      };

    if (method === "tools/list")
      return {
        tools: [
          {
            name: "echo",
            description: "Repeat the text.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      };

    const text =
      typeof params === "object" && params !== null && "arguments" in params
        ? JSON.stringify(params.arguments)
        : "";

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

function open(folder: string, fake: FakeModels, connect: McpConnector): Promise<Host> {
  return openHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home: folder,
    mcp: createMcpHub({ home: folder, connect }),
  });
}

async function next(
  views: AsyncIterator<McpView>,
  done: (view: McpView) => boolean,
): Promise<McpView> {
  for (;;) {
    const step = await views.next();

    assert(step.done !== true, "The MCP view ended.");

    if (done(step.value)) return step.value;
  }
}

it("calls a tool of a server in ~/.nyte/mcp.json as mcp__<server>__<tool>", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [{ type: "toolCall", id: "m", name: "mcp__fake__echo", arguments: { text: "hi" } }],
    },
    { content: [{ type: "text", text: "Echoed." }] },
  );

  const folder = await home({ fake: { url: "https://fake.test/mcp", exposure: "direct" } });
  await using host = await open(folder, fake, () => fakeServer());
  const session = await host.sessions.create();

  const views = host
    .workspace((await session.info()).workspace)
    .mcp.watch()
    [Symbol.asyncIterator]();

  expect(await next(views, (view) => view.servers[0]?.state.kind === "connected")).toMatchObject({
    servers: [
      {
        name: "fake",
        scope: "user",
        transport: { kind: "http", url: "https://fake.test/mcp" },
        exposure: "model",
        state: { kind: "connected", tools: [{ name: "echo", exposure: "model" }] },
      },
    ],
    issues: [],
  });

  await (await session.send("Echo hi.")).settled();
  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({
    kind: "ok",
    content: [{ kind: "text", text: 'echo {"text":"hi"}' }],
  });
});

it("gives tools codemode exposure by default and applies an edit to mcp.json", async () => {
  const folder = await home({ fake: { url: "https://fake.test/mcp" } });
  await using host = await open(folder, fakeModels(), () => fakeServer());
  const session = await host.sessions.create();

  const views = host
    .workspace((await session.info()).workspace)
    .mcp.watch()
    [Symbol.asyncIterator]();

  await next(views, (view) => view.servers[0]?.state.kind === "connected");
  await vi.waitFor(async () =>
    expect(
      (await session.view()).catalog.tools.find((info) => info.name === "mcp__fake__echo"),
    ).toMatchObject({ exposure: "code", namespace: "mcp/fake" }),
  );

  await writeMcp(folder, {
    fake: { url: "https://fake.test/mcp", enabled: false },
    "bad name": {},
  });

  expect(await next(views, (view) => view.servers[0]?.state.kind === "disabled")).toMatchObject({
    servers: [{ name: "fake", state: { kind: "disabled" } }],
    issues: [{ severity: "error", path: ["mcpServers", "bad name"] }],
  });
  await expect
    .poll(async () => (await session.view()).catalog.tools.map((info) => info.name))
    .not.toContain("mcp__fake__echo");
});

it("keeps one set of connections per trust view of a workspace without flapping between them", async () => {
  let connects = 0;
  const folder = await home({ fake: { url: "https://fake.test/mcp" } });

  const hub = createMcpHub({
    home: folder,
    connect: () => {
      connects += 1;

      return fakeServer();
    },
  })({
    secrets: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
  });

  const id = asId<"workspace">("w");
  const untrusted = hub.watch({ id, root: null, trusted: false })[Symbol.asyncIterator]();
  const trusted = hub.watch({ id, root: null, trusted: true })[Symbol.asyncIterator]();
  await next(untrusted, (view) => view.servers[0]?.state.kind === "connected");
  await next(trusted, (view) => view.servers[0]?.state.kind === "connected");
  expect(hub.tools({ id, root: null, trusted: false }).map((info) => info.name)).toEqual([
    "mcp__fake__echo",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(connects).toBe(2);
  await untrusted.return?.();
  await trusted.return?.();
  await hub.close();
});

it("shows a dropped connection as failed and reconnects", async () => {
  let connects = 0;
  const folder = await home({ fake: { url: "https://fake.test/mcp" } });
  await using host = await open(folder, fakeModels(), () => fakeServer(++connects === 1));
  const session = await host.sessions.create();

  const views = host
    .workspace((await session.info()).workspace)
    .mcp.watch()
    [Symbol.asyncIterator]();

  expect(await next(views, (view) => view.servers[0]?.state.kind === "failed")).toMatchObject({
    servers: [{ state: { kind: "failed", message: "The connection to fake closed." } }],
  });
  await next(views, (view) => view.servers[0]?.state.kind === "connected");
  expect(connects).toBe(2);
});

it("adds, turns off, reconnects and removes a server through mcp.json, keeping the file's other keys", async () => {
  let connects = 0;
  const folder = await home({});
  const path = join(folder, ".nyte", "mcp.json");
  await writeFile(path, JSON.stringify({ note: "kept", mcpServers: {} }));

  await using host = await open(folder, fakeModels(), () => {
    connects += 1;

    return fakeServer();
  });

  const session = await host.sessions.create();
  const mcp = host.workspace((await session.info()).workspace).mcp;
  const views = mcp.watch()[Symbol.asyncIterator]();
  await next(views, (view) => view.servers.length === 0);

  expect(await mcp.add("docs", { url: "https://docs.test/mcp" }, "user")).toEqual({
    kind: "updated",
  });
  expect(await mcp.add("bad name", { url: "https://docs.test/mcp" }, "user")).toMatchObject({
    kind: "invalid",
  });
  expect(await mcp.add("docs", { url: "https://docs.test/mcp" }, "project")).toEqual({
    kind: "invalid",
    message: "Project servers need a trusted folder on this machine.",
  });
  await next(views, (view) => view.servers[0]?.state.kind === "connected");

  expect(await mcp.reconnect("docs")).toEqual({ kind: "updated" });
  await next(views, (view) => view.servers[0]?.state.kind === "connected");
  expect(connects).toBe(2);

  expect(await mcp.logout("docs")).toEqual({ kind: "updated" });
  await next(views, (view) => view.servers[0]?.state.kind === "connected");
  expect(connects).toBe(3);

  expect(await mcp.setEnabled("docs", false)).toEqual({ kind: "updated" });
  await next(views, (view) => view.servers[0]?.state.kind === "disabled");
  expect(await mcp.reconnect("docs")).toEqual({ kind: "invalid", message: "docs is turned off." });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    note: "kept",
    mcpServers: { docs: { url: "https://docs.test/mcp", enabled: false } },
  });

  expect(await mcp.remove("docs", "user")).toEqual({ kind: "updated" });
  expect(await mcp.remove("docs", "user")).toEqual({ kind: "missing" });
  expect(await mcp.setEnabled("docs", true)).toEqual({ kind: "missing" });
  await next(views, (view) => view.servers.length === 0);
});

it("waits for sign-in when the server needs OAuth, and refuses to sign in to a command", async () => {
  const folder = await home({
    docs: { url: "https://docs.test/mcp" },
    files: { command: "files-server" },
  });

  await using host = await open(folder, fakeModels(), (entry) => {
    if (entry.name !== "docs") return fakeServer();
    const transport = fakeServer();

    return {
      ...transport,
      start: () => Promise.reject(new McpOAuthAuthorizationRequiredError()),
      send: (message) => transport.send(message),
      close: () => transport.close(),
      onMessage: (listener) => transport.onMessage(listener),
      onError: (listener) => transport.onError(listener),
      onClose: (listener) => transport.onClose(listener),
    };
  });

  const session = await host.sessions.create();
  const mcp = host.workspace((await session.info()).workspace).mcp;
  const views = mcp.watch()[Symbol.asyncIterator]();

  expect(
    await next(views, (view) => view.servers.every((server) => server.state.kind !== "connecting")),
  ).toMatchObject({
    servers: [
      { name: "docs", state: { kind: "needs-sign-in" } },
      { name: "files", state: { kind: "connected" } },
    ],
  });

  const steps = [];

  for await (const step of mcp.login("files").steps()) steps.push(step);

  expect(steps).toEqual([
    { kind: "failed", reason: "files runs a command, so it has nothing to sign in to." },
  ]);
  expect(await mcp.logout("files")).toEqual({
    kind: "invalid",
    message: "files runs a command and has no sign-in.",
  });
});
