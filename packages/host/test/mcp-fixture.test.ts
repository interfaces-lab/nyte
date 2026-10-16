import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { isPart, memoryStore, tool } from "@nyte-ai/core";
import type { Host } from "@nyte-ai/core";
import type { McpView } from "@nyte-ai/schema";
import { afterEach, assert, expect, it } from "vitest";
import { createMcpHub, openHost } from "../src/index.ts";
import { chatOnly, fakeModels } from "../src/bench/fake-models.ts";
import type { FakeModels, Request } from "../src/bench/fake-models.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "places-mcp.mjs");

const SEARCH = "mcp__places__search_places";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function placesHome(
  env: Readonly<Record<string, string>>,
  exposure: "direct" | "codemode" = "direct",
): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-places-")));
  folders.push(made);
  await mkdir(join(made, ".nyte"));
  await writeFile(
    join(made, ".nyte", "mcp.json"),
    JSON.stringify({
      mcpServers: { places: { command: process.execPath, args: [FIXTURE], env, exposure } },
    }),
  );

  return made;
}

function openPlaces(folder: string, fake: FakeModels): Promise<Host> {
  return openHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home: folder,
    mcp: createMcpHub({ home: folder }),
  });
}

function requestTools(request: Request | undefined): readonly string[] {
  return (request?.context.messages ?? []).flatMap((message) =>
    message.role === "system" ? (message.toolsAdded ?? []).map((added) => added.name) : [],
  );
}

function searchOnce(fake: FakeModels): void {
  fake.reply(
    {
      content: [{ type: "toolCall", id: "s", name: SEARCH, arguments: { near: "here", limit: 1 } }],
    },
    { content: [{ type: "text", text: "Found one." }] },
  );
}

async function settledCall(host: Host, prompt: string) {
  const session = await host.sessions.create();
  await (await session.send(prompt)).settled();
  const call = (await session.view()).messages.find((message) => isPart(message, tool));

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");

  return { session, outcome: call.state.outcome };
}

async function nextView(
  views: AsyncIterator<McpView>,
  done: (view: McpView) => boolean,
): Promise<McpView> {
  for (;;) {
    const step = await views.next();

    assert(step.done !== true, "The MCP view ended.");

    if (done(step.value)) return step.value;
  }
}

it("carries a cold server's tools on the first request after launch", async () => {
  const fake = fakeModels();
  searchOnce(fake);
  await using host = await openPlaces(await placesHome({ PLACES_COLD_MS: "400" }), fake);

  const { outcome } = await settledCall(host, "Find a place nearby.");

  expect(requestTools(fake.requests[0])).toContain(SEARCH);
  expect(outcome).toMatchObject({
    kind: "ok",
    content: [{ text: expect.stringContaining("luigi") }],
  });
});

it("does not hold the first request for a server that crashed, and shows it failed", async () => {
  const fake = fakeModels();
  fake.reply({ content: [{ type: "text", text: "No places tool." }] });
  await using host = await openPlaces(await placesHome({ PLACES_CRASH: "list" }), fake);
  const session = await host.sessions.create();
  const started = performance.now();

  await (await session.send("Find a place nearby.")).settled();

  expect(performance.now() - started).toBeLessThan(4000);
  expect(requestTools(fake.requests[0])).not.toContain(SEARCH);

  const views = host
    .workspace((await session.info()).workspace)
    .mcp.watch()
    [Symbol.asyncIterator]();

  expect(await nextView(views, (view) => view.servers[0]?.state.kind === "failed")).toMatchObject({
    servers: [{ name: "places", state: { kind: "failed" } }],
  });
  await views.return?.();
});

it("fails the call, not the turn, when the server exits mid-call", async () => {
  const fake = fakeModels();
  searchOnce(fake);
  await using host = await openPlaces(await placesHome({ PLACES_CRASH: "call" }), fake);

  const { outcome } = await settledCall(host, "Find a place nearby.");

  expect(outcome).toMatchObject({ kind: "failed" });
  expect(fake.requests).toHaveLength(2);
});
