import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_PROTOCOL_VERSION, isJsonRpcRequest } from "@earendil-works/pi-mcp";
import type { McpTransport } from "@earendil-works/pi-mcp";
import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { isPart, tool } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import type { Host } from "@nyte-ai/core";
import type { McpView } from "@nyte-ai/schema";
import { afterEach, assert, expect, it, vi } from "vitest";
import { createMcpHub, openHost } from "../src/index.ts";
import type { McpConnector } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";

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
  const { session } = await host.sessions.start({ content: "Hi." });

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
  const { session } = await host.sessions.start({ content: "Hi." });

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
  const { session } = await host.sessions.start({ content: "Hi." });

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

  const { session } = await host.sessions.start({ content: "Hi." });
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

  const { session } = await host.sessions.start({ content: "Hi." });
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

it("stops a sign-in at once when its steps end, so the next one can start", async () => {
  const silent = createServer(() => undefined);
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const address = silent.address();
  assert(address !== null && typeof address === "object");
  const url = `http://127.0.0.1:${String(address.port)}/mcp`;
  const folder = await home({ slow: { url } });

  const hub = createMcpHub({ home: folder, connect: () => fakeServer() })({
    secrets: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
  });

  const workspace = { id: asId<"workspace">("w"), root: null, trusted: false };
  const first = hub.login(workspace, "slow").steps()[Symbol.asyncIterator]();
  const pending = first.next();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const started = Date.now();
  await first.return?.();

  expect(await pending).toEqual({ done: true, value: undefined });
  expect(Date.now() - started).toBeLessThan(500);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const second = hub.login(workspace, "slow").steps()[Symbol.asyncIterator]();
  const next = await Promise.race([
    second.next(),
    new Promise((resolve) => setTimeout(() => resolve("still running"), 300)),
  ]);

  expect(next).not.toMatchObject({ value: { reason: "A sign-in to slow is already running." } });
  await second.return?.();
  await hub.close();
  silent.closeAllConnections();
  silent.close();
});

it("keeps concurrent edits, writes a project override explicitly, refuses clashing names, and cancels a waiting watch", async () => {
  const folder = await home({ docs: { url: "https://docs.test/mcp" } });
  const project = join(folder, "project");
  await mkdir(join(project, ".nyte"), { recursive: true });
  await writeFile(
    join(project, ".nyte", "mcp.json"),
    JSON.stringify({ mcpServers: { docs: { enabled: false } } }),
  );

  const hub = createMcpHub({ home: folder, connect: () => fakeServer() })({
    secrets: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
  });

  const trusted = { id: asId<"workspace">("w"), root: project, trusted: true };
  const untrusted = { id: asId<"workspace">("u"), root: project, trusted: false };
  const config = { url: "https://more.test/mcp" };

  expect(
    await Promise.all(["a", "b", "c"].map((name) => hub.add(trusted, name, config, "user"))),
  ).toEqual([{ kind: "updated" }, { kind: "updated" }, { kind: "updated" }]);
  expect(
    Object.keys(JSON.parse(await readFile(join(folder, ".nyte", "mcp.json"), "utf8")).mcpServers),
  ).toEqual(["docs", "a", "b", "c"]);

  expect(await hub.add(trusted, "my-docs", config, "user")).toEqual({ kind: "updated" });
  expect(await hub.add(trusted, "my_docs", config, "user")).toEqual({
    kind: "invalid",
    message: "my_docs and my-docs name the same server.",
  });

  expect(await hub.setEnabled(trusted, "docs", true)).toEqual({ kind: "updated" });
  expect(JSON.parse(await readFile(join(project, ".nyte", "mcp.json"), "utf8"))).toEqual({
    mcpServers: { docs: { enabled: true } },
  });
  expect(await hub.remove(trusted, "docs", "user")).toEqual({ kind: "updated" });
  expect(await hub.remove(untrusted, "docs", "project")).toEqual({
    kind: "invalid",
    message: "Project servers need a trusted folder on this machine.",
  });

  const views = hub.watch(trusted)[Symbol.asyncIterator]();
  await views.next();
  const pending = views.next();
  const started = Date.now();
  await views.return?.();

  expect(await pending).toEqual({ done: true, value: undefined });
  expect(Date.now() - started).toBeLessThan(100);
  await hub.close();
});
