import { afterEach, beforeAll, expect, test } from "bun:test";
import {
  fakeModels,
  formatWaterfall,
  RESTAURANT_PROMPT,
  restaurantHome,
  restaurantScript,
} from "@nyte-ai/host/bench";
import { clearSpans, enableTracing } from "@nyte-ai/sdk/client";
import { shownAt, startTui } from "../harness/tui.ts";
import {
  epochNow,
  lastTrace,
  machineLoad,
  openScenarioHost,
  overBudget,
  round,
  saveFrame,
  saveProof,
  spanEnd,
  spanHops,
  spanStart,
  traceWaterfall,
} from "./scenario.ts";
import type { Gap, Hop } from "./scenario.ts";

const SIZE = { width: 100, height: 40 } as const;

beforeAll(() => enableTracing());

afterEach(() => clearSpans());

test("scenario U from the keyboard: typed while the host opens, skill, places MCP, canvas, answer, one trace, and the same frames after a resume", async () => {
  await using home = await restaurantHome({ route: "direct" });

  const turns = restaurantScript({
    skill: home.skills["restaurant-picker"] ?? "",
    route: "direct",
  });

  const fake = fakeModels({ fallback: turns.answer });
  await using scenario = await openScenarioHost({ fake, home: home.home });

  await using tui = await startTui({
    host: scenario.host,
    size: SIZE,
    opened: false,
    typed: RESTAURANT_PROMPT,
    record: true,
  });

  await tui.frame((frame) => frame.includes(`❯ ${RESTAURANT_PROMPT}`));
  const typedAt = shownAt(tui, `❯ ${RESTAURANT_PROMPT}`) ?? Infinity;

  expect(tui.store.state().facts.phase.kind).toBe("starting");
  expect(typedAt).toBeLessThanOrEqual(50);
  await saveFrame(tui, "U-01-typed-while-host-opens");

  tui.openHost();
  await tui.ready();
  await saveFrame(tui, "U-02-ready");

  const pressed = epochNow();
  tui.mockInput.pressEnter();
  await tui.frame((frame) => frame.includes("Let me look nearby."));
  await saveFrame(tui, "U-03-streaming");
  await tui.frame((frame) => frame.includes("◆ Random pick nearby"));
  await saveFrame(tui, "U-04-canvas");
  await tui.frame((frame) => frame.includes("I picked Luigi's Trattoria"));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.renderOnce();
  await saveFrame(tui, "U-05-answer");

  expect(turns.pending()).toEqual([]);
  const session = tui.store.state().facts.session?.id;

  if (session === undefined) throw new Error("No session was followed.");
  const trace = lastTrace(tui.store);
  const waterfall = await traceWaterfall(trace, { places: home.traceFile });
  console.log(formatWaterfall(waterfall));

  expect(waterfall.rows.filter((row) => row.traced).map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "composer.submit",
      "host.admit",
      "turn.start",
      "model.stream",
      "mcp.call",
      "mcp.serve",
      "tool.run",
      "canvas.compile",
      "part.publish",
      "client.paint",
    ]),
  );

  const submitted = spanStart(trace, "composer.submit") ?? Infinity;
  const echoed = spanEnd(trace, "client.paint", { kind: "user" }) ?? Infinity;
  const published = spanEnd(trace, "part.publish", { parts: "canvas" }) ?? Infinity;
  const canvasPainted = spanEnd(trace, "client.paint", { kind: "canvas" }) ?? Infinity;

  const hops: readonly Hop[] = [
    {
      hop: "Enter → composer.submit (reduce, effect, plugins)",
      ms: round(submitted - pressed),
      budget: 50,
    },
    { hop: "Enter → the user message painted", ms: round(echoed - pressed), budget: 100 },
    {
      hop: "canvas part.publish → its row painted",
      ms: round(canvasPainted - published),
      budget: 50,
    },
    ...spanHops(waterfall, {
      "composer.submit": 50,
      "host.admit": 50,
      "canvas.compile": 50,
      "part.publish": 25,
      "client.paint": 50,
    }),
  ];

  const gaps: readonly Gap[] = [
    {
      step: "See the pick as a canvas card",
      shows: "◆ Random pick nearby · canvas · open this chat in Nyte desktop to view it",
      frame: "U-04-canvas",
      verdict: "design",
      why: "A canvas is a React module run in a browser frame; the TUI names it and points to desktop instead of drawing a cell approximation.",
    },
    {
      step: "Press Reroll on the canvas",
      shows: "Nothing to press: the canvas row is one line of text.",
      frame: "U-05-answer",
      verdict: "design",
      why: "Follows from the canvas row; rerolling from the TUI is a new message.",
    },
    {
      step: "Open the place's web link in the workbench browser",
      shows:
        "The answer's link: an OSC 8 hyperlink where the terminal takes them (kitty, ghostty), else its URL printed after the text (xterm). The canvas's own link is not shown.",
      frame: "link-kitty, link-xterm",
      verdict: "design",
      why: "The TUI has no browser; the answer's markdown link is the way out, and the terminal opens it.",
    },
  ];

  await saveProof("U-trace", {
    trace,
    machine: machineLoad(),
    pressed,
    typedAt,
    hops,
    waterfall,
  });
  await saveProof("U-gaps", gaps);

  expect(overBudget(hops)).toEqual([]);

  const before = tui.captureCharFrame();
  const beforeSpans = tui.captureSpans();
  await saveFrame(tui, "U-06-before-quit");
  await tui.send("/quit");
  expect(await tui.app.closing).toBe(0);
  await tui.dispose();

  await using resumed = await startTui({
    host: scenario.host,
    size: SIZE,
    target: { kind: "session", id: session },
    record: true,
  });

  await resumed.frame((frame) => frame.includes("I picked Luigi's Trattoria"));
  await resumed.state((store) => store.screen().run.kind === "idle");
  await resumed.renderOnce();
  await saveFrame(resumed, "U-07-resumed");

  expect(resumed.captureCharFrame()).toBe(before);
  expect(resumed.captureSpans()).toEqual(beforeSpans);
}, 60_000);
