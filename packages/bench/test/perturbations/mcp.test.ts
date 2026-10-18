import { clearSpans, enableTracing } from "@nyte-ai/core";
import type { Host, Session } from "@nyte-ai/core";
import type { McpView } from "@nyte-ai/schema";
import { afterEach, assert, beforeAll, expect, it } from "vitest";
import {
  afterTool,
  afterUser,
  fakeModels,
  lastToolText,
  PLACES_TOOL,
  readSpanFile,
  RESTAURANT_PROMPT,
  restaurantHome,
  script,
  simulate,
  titleReply,
} from "../../src/index.ts";
import type { ScenarioHome } from "../../src/index.ts";
import {
  expectSettledViews,
  folder,
  removeFolders,
  savePerturbation,
  setServerField,
  settledTool,
  start,
  toolStates,
  until,
  waterfall,
  watchViews,
} from "./support.ts";

beforeAll(() => enableTracing());

afterEach(async () => {
  clearSpans();
  await removeFolders();
});

const SORRY = "The places search is not working right now, so I could not pick a restaurant.";

function placesScript() {
  return script([
    {
      name: "search places",
      when: afterUser,
      reply: {
        content: [
          { type: "toolCall", id: "search", name: PLACES_TOOL, arguments: { near: "here" } },
        ],
      },
    },
    {
      name: "answer",
      when: afterTool(PLACES_TOOL),
      reply: { content: [{ type: "text", text: SORRY }] },
    },
  ]);
}

async function serverState(host: Host, session: Session, state: string): Promise<McpView> {
  const info = await session.info();

  for await (const view of host.workspace(info.workspace).mcp.watch())
    if (view.servers.some((server) => server.name === "places" && server.state.kind === state))
      return view;

  throw new Error(`places never reached ${state}.`);
}

async function runPlaces(home: ScenarioHome) {
  const turns = placesScript();
  const fake = fakeModels({ fallback: turns.answer });
  const simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: await folder(),
  });
  const { host } = simulation;
  const started = performance.now();
  const { trace, session, receipt } = await start(host, RESTAURANT_PROMPT);
  const watched = watchViews(session);
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);
  const final = await expectSettledViews(session, watched);

  expect(turns.pending()).toEqual([]);
  expect(end.kind).toBe("completed");
  expect(final.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: SORRY } });

  const places = settledTool(final.messages, PLACES_TOOL);
  const asked = fake.requests.filter((request) => titleReply(request) === null);
  const told = lastToolText(asked.at(-1) ?? asked[0]);

  const offered = (asked[0]?.context.messages ?? []).flatMap((message) =>
    message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
  );

  return { simulation, session, trace, places, told, offered, wall };
}

it("fails a places call past the server's timeout with copy naming the timeout, and keeps the server", async () => {
  await using home = await restaurantHome({ env: { PLACES_DELAY_MS: "1500" } });
  await setServerField(home.home, "timeout", 0.3);
  const run = await runPlaces(home);
  await using simulation = run.simulation;
  const { host } = simulation;

  assert(run.places.outcome.kind === "failed");
  expect(run.places.outcome.message).toMatch(/time/i);
  expect(run.told).toContain(run.places.outcome.message);
  expect(run.wall).toBeLessThan(1500);

  const view = await serverState(host, run.session, "connected");

  expect(view.servers.map((server) => server.state.kind)).toEqual(["connected"]);

  await savePerturbation("mcp-slow-timeout", [waterfall(run.trace)], {
    perturbation: "MCP slow: places answers after 1.5 s, its mcp.json timeout is 0.3 s",
    expected:
      "The call fails at the timeout with copy naming it; the model is told; the run completes; the server stays connected.",
    observed: `places ${run.places.outcome.kind}: "${run.places.outcome.message}"; server ${view.servers[0]?.state.kind}`,
    wallMs: run.wall,
  });
});

it("stops a slow places call when the user stops the run, leaving nothing working", async () => {
  await using home = await restaurantHome({
    env: { PLACES_DELAY_MS: "5000", PLACES_PROGRESS: "1" },
  });

  const turns = placesScript();
  const fake = fakeModels({ fallback: turns.answer });
  await using simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: await folder(),
  });
  const { host } = simulation;
  const started = performance.now();
  const { trace, session, receipt } = await start(host, RESTAURANT_PROMPT);
  const watched = watchViews(session);

  const progress = await until(
    async () =>
      toolStates((await session.view()).messages).find(
        (state) => state.phase === "running" && state.progress !== null,
      ),
    10_000,
    "progress from the places call",
  );

  expect(progress).toMatchObject({ progress: { text: "Page 1", fraction: 1 / 3 } });
  await session.stop();
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);
  const final = await expectSettledViews(session, watched);

  expect(end.kind).toBe("stopped");
  expect(settledTool(final.messages, PLACES_TOOL).outcome.kind).toBe("stopped");
  expect(wall).toBeLessThan(5000);

  await savePerturbation("mcp-slow-stop", [waterfall(trace)], {
    perturbation: "MCP slow: places takes 5 s with progress, the user stops the run",
    expected:
      "The running part shows the server's progress; stop ends the call and the run at once; nothing is left working.",
    observed: `progress "${progress.phase === "running" ? progress.progress?.text : ""}"; run ${end.kind}; places ${settledTool(final.messages, PLACES_TOOL).outcome.kind}`,
    wallMs: wall,
  });
});

it("fails a places call whose server crashes, then reconnects the server", async () => {
  await using home = await restaurantHome({ env: { PLACES_CRASH: "call" } });
  const run = await runPlaces(home);
  await using simulation = run.simulation;
  const { host } = simulation;

  assert(run.places.outcome.kind === "failed");
  expect(run.places.outcome.message).toMatch(/places|connection|closed/i);
  expect(run.told).toContain(run.places.outcome.message);

  const failed = await serverState(host, run.session, "failed");
  const reconnected = await serverState(host, run.session, "connected");

  expect(await readSpanFile(home.traceFile)).toEqual([]);

  await savePerturbation("mcp-crash-call", [waterfall(run.trace)], {
    perturbation: "MCP crashing: places exits on tools/call",
    expected:
      "The call fails with copy naming the closed connection; the run completes; the server shows failed, then reconnects.",
    observed: `places ${run.places.outcome.kind}: "${run.places.outcome.message}"; server ${failed.servers[0]?.state.kind} then ${reconnected.servers[0]?.state.kind}`,
    wallMs: run.wall,
  });
});

it("tells the model a crashed-at-list server's tool is unavailable and shows the server failed", async () => {
  await using home = await restaurantHome({ env: { PLACES_CRASH: "list" } });
  const run = await runPlaces(home);
  await using simulation = run.simulation;
  const { host } = simulation;

  assert(run.places.outcome.kind === "failed");
  expect(run.places.outcome.message).toContain(PLACES_TOOL);
  expect(run.offered).toContain("read");
  expect(run.offered).not.toContain(PLACES_TOOL);

  const failed = await serverState(host, run.session, "failed");
  const server = failed.servers[0];

  assert(server?.state.kind === "failed");
  expect(server.state.message).toContain("places");

  await savePerturbation("mcp-crash-list", [waterfall(run.trace)], {
    perturbation: "MCP crashing: places exits on tools/list",
    expected:
      "The tool is not offered; a call to it fails naming it; the server shows failed with a message; the run completes.",
    observed: `places ${run.places.outcome.kind}: "${run.places.outcome.message}"; server failed: "${server.state.message}"`,
    wallMs: run.wall,
  });
});

it("leaves out a tool with an invalid input schema, with an issue naming it", async () => {
  await using home = await restaurantHome({ env: { PLACES_INVALID_SCHEMA: "1" } });
  const run = await runPlaces(home);
  await using simulation = run.simulation;
  const { host } = simulation;

  assert(run.places.outcome.kind === "failed");
  expect(run.places.outcome.message).toContain(PLACES_TOOL);
  expect(run.offered).toContain("read");
  expect(run.offered).not.toContain(PLACES_TOOL);

  const view = await serverState(host, run.session, "connected");

  expect(view.issues.map((issue) => issue.message)).toEqual([
    expect.stringContaining("search_places with an input schema that is not valid JSON Schema"),
  ]);

  await savePerturbation("mcp-invalid-schema", [waterfall(run.trace)], {
    perturbation:
      "MCP invalid schema: places lists search_places with a schema that is not JSON Schema",
    expected:
      "The tool is not offered (every request would fail); an mcp issue names it; a call fails naming it; the run completes.",
    observed: `places ${run.places.outcome.kind}: "${run.places.outcome.message}"; issue: "${view.issues[0]?.message}"`,
    wallMs: run.wall,
  });
});
