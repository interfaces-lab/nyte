import { clearSpans, enableTracing } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { afterEach, beforeAll, expect, it } from "vitest";
import {
  afterTool,
  fakeModels,
  lastUserText,
  PLACES_TOOL,
  RESTAURANT_CANVAS,
  RESTAURANT_PROMPT,
  readSpanFile,
  restaurantHome,
  script,
} from "../../src/bench/index.ts";
import type { Request } from "../../src/bench/index.ts";
import {
  expectInOrder,
  expectSettledViews,
  folder,
  openScenario,
  removeFolders,
  savePerturbation,
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

const STEER = "Make it vegetarian.";

const ANSWER = "Verde is vegetarian and 1.6 km away.";

/** Matches a request whose last message is the steer and whose message before it is the places result. */
function afterSteer(request: Request): boolean {
  const messages = request.context.messages;

  return (
    messages.at(-1)?.role === "user" &&
    lastUserText(request) === STEER &&
    messages.at(-2)?.role === "toolResult"
  );
}

it("lands a steer sent during the places call after the call settles, in the same run", async () => {
  await using home = await restaurantHome({ env: { PLACES_DELAY_MS: "400" } });

  const turns = script([
    {
      name: "read the skill",
      reply: {
        content: [
          {
            type: "toolCall",
            id: "skill",
            name: "read",
            arguments: { path: home.skills["restaurant-picker"] },
          },
        ],
      },
    },
    {
      name: "search places",
      when: afterTool("read"),
      reply: {
        content: [
          { type: "toolCall", id: "search", name: PLACES_TOOL, arguments: { near: "here" } },
        ],
      },
    },
    {
      name: "render after the steer",
      when: afterSteer,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "canvas",
            name: "canvas_render",
            arguments: { title: "Vegetarian pick", source: RESTAURANT_CANVAS },
          },
        ],
      },
    },
    {
      name: "answer",
      when: afterTool("canvas_render"),
      reply: { content: [{ type: "text", text: ANSWER }] },
    },
  ]);

  const fake = fakeModels({ fallback: turns.answer });
  await using host = await openScenario({ fake, home: home.home, workspace: await folder() });
  const started = performance.now();
  const { trace, session, receipt } = await start(host, RESTAURANT_PROMPT);
  const watched = watchViews(session);

  await until(
    async () =>
      toolStates((await session.view()).messages).some(
        (state) => state.name === PLACES_TOOL && state.phase === "running",
      )
        ? true
        : undefined,
    10_000,
    "the places call to run",
  );

  const steerTrace = crypto.randomUUID();
  const steer = await session.send(STEER, { id: asId<"receipt">(steerTrace) });
  const end = await receipt.settled();
  const wall = performance.now() - started;

  expect(end.kind).toBe("completed");
  expect(await steer.settled()).toEqual(end);
  expect(turns.pending()).toEqual([]);

  const request = fake.requests.find(afterSteer);
  const result = request?.context.messages.at(-2);

  expect(result?.role === "toolResult" ? JSON.stringify(result.content) : "").toContain("verde");

  const final = await expectSettledViews(session, watched);

  expect(settledTool(final.messages, PLACES_TOOL).outcome.kind).toBe("ok");
  expect(settledTool(final.messages, "canvas_render").outcome.kind).toBe("ok");
  expect(
    final.messages
      .filter((message) => message.kind === "user")
      .map((message) => message.status.kind),
  ).toEqual(["landed", "landed"]);
  expect(final.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: ANSWER } });

  const child = await readSpanFile(home.traceFile);
  const traced = waterfall(trace, [{ process: "mcp:places", spans: child }]);
  const steered = waterfall(steerTrace);

  expectInOrder(traced.rows, ["host.admit", "tool.run", "mcp.call", "mcp.serve"]);
  expectInOrder(steered.rows, ["host.admit", "turn.start", "canvas.compile", "model.stream"]);
  expect(steered.rows.filter((row) => row.name === "mcp.call" && row.traced)).toEqual([]);

  await savePerturbation("steer-during-mcp", [traced, steered], {
    perturbation: "User steers during the MCP call (U, places delayed 400 ms)",
    expected:
      "The call is not interrupted; the steer lands at the boundary after the call, in the same run; one answer.",
    observed: `run ${end.kind}; places ${settledTool(final.messages, PLACES_TOOL).outcome.kind}; steer settled with the same run end; ${fake.requests.length} model requests; ${watched.views.length} watched views`,
    wallMs: Math.round(wall),
  });
});
