import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeAll, expect, test } from "bun:test";
import {
  CI_PROMPT,
  ciHome,
  ciRepo,
  ciScript,
  fakeModels,
  formatWaterfall,
} from "@nyte-ai/host/bench";
import { clearSpans, enableTracing } from "@nyte-ai/sdk/client";
import { shellPort } from "../../src/effects/local-ports.ts";
import { startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";
import {
  framedCells,
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
  submit,
  traceWaterfall,
  transcriptRows,
} from "./scenario.ts";
import type { Gap, Hop } from "./scenario.ts";

const run = promisify(execFile);

const SIZE = { width: 120, height: 48 } as const;

/**
 * Runs `command` as a private `!!` command. The transcript places it among turns by its start on
 * the TUI's clock, which the harness holds still, so the clock first moves to the host's wall time.
 */
async function runLocally(tui: Tui, command: string): Promise<void> {
  tui.clock.setTime(Date.now());
  await tui.send(`!!${command}`);
}

beforeAll(() => enableTracing());

afterEach(() => clearSpans());

test("scenario D from the keyboard: CI MCP log tail, canvas, test, fix, rerun, then !git diff and !git commit from the composer", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp" });
  const turns = ciScript({ skill: home.skills["ci-triage"] ?? "", route: "mcp" });
  const fake = fakeModels({ fallback: turns.answer });
  await using scenario = await openScenarioHost({ fake, home: home.home, workspace: repo.root });

  await using tui = await startTui({
    host: scenario.host,
    size: SIZE,
    local: { shell: shellPort(), cwd: repo.root },
  });

  await tui.ready();
  await saveFrame(tui, "D-01-ready");

  const pressed = await submit(tui, CI_PROMPT);
  await tui.frame((frame) => frame.includes("Let me look at the checks."));
  await saveFrame(tui, "D-02-streaming");
  await tui.frame((frame) => frame.includes("◆ CI failures"));
  await saveFrame(tui, "D-03-canvas");
  await tui.frame((frame) => frame.includes("Fixed src/sum.js:2"));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.frame((frame) => frame.includes("╰─ repo fix-sum* │"));
  await saveFrame(tui, "D-04-answer");

  expect(turns.pending()).toEqual([]);
  expect((await run("git", ["diff", "--name-only"], { cwd: repo.root })).stdout).toBe(
    "src/sum.js\n",
  );

  const trace = lastTrace(tui.store);
  const session = tui.store.state().facts.session?.id;

  if (session === undefined) throw new Error("No session was followed.");
  const waterfall = await traceWaterfall(trace, { ci: home.traceFile });
  console.log(formatWaterfall(waterfall));

  expect(waterfall.rows.filter((row) => row.traced).map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "composer.submit",
      "host.admit",
      "skill.load",
      "mcp.call",
      "mcp.serve",
      "canvas.compile",
      "pty.spawn",
      "pty.output",
      "part.publish",
      "client.paint",
    ]),
  );

  const logCall = waterfall.rows.find(
    (row) => row.name === "tool.run" && row.detail.tool === "mcp__ci__get_job_logs",
  );

  const echoed = spanEnd(trace, "client.paint", { kind: "user" }) ?? Infinity;
  const submitted = spanStart(trace, "composer.submit") ?? Infinity;

  const hops: readonly Hop[] = [
    {
      hop: "Enter → composer.submit (reduce, effect, plugins)",
      ms: round(submitted - pressed),
      budget: 50,
    },
    { hop: "Enter → the user message painted", ms: round(echoed - pressed), budget: 100 },
    ...spanHops(waterfall, {
      "composer.submit": 50,
      "host.admit": 50,
      "skill.load": 25,
      "canvas.compile": 50,
      "part.publish": 25,
      "client.paint": 50,
    }),
  ];

  const beforeSpans = tui.captureSpans();
  await tui.send("/quit");
  expect(await tui.app.closing).toBe(0);
  await tui.dispose();

  await using resumed = await startTui({
    host: scenario.host,
    size: SIZE,
    local: { shell: shellPort(), cwd: repo.root },
    target: { kind: "session", id: session },
  });

  await resumed.frame((frame) => frame.includes("Fixed src/sum.js:2"));
  await resumed.state((store) => store.screen().run.kind === "idle");
  await resumed.renderOnce();
  await saveFrame(resumed, "D-05-resumed");

  expect(framedCells(resumed.captureSpans())).toEqual(framedCells(beforeSpans));

  await runLocally(resumed, "git diff --stat");
  await resumed.frame((frame) => frame.includes("1 file changed, 1 insertion(+), 1 deletion(-)"));
  expect(resumed.captureCharFrame()).toContain("╰─ repo fix-sum* │");
  await saveFrame(resumed, "D-06-git-diff");
  await runLocally(resumed, 'git commit -qam "Fix sum" && git log --oneline | wc -l');
  await resumed.frame((frame) =>
    transcriptRows(frame)
      .split("\n")
      .some((line) => line.replaceAll(/[\s█▄▀]/gu, "") === "2"),
  );
  await resumed.frame((frame) => frame.includes("╰─ repo fix-sum │"));
  await saveFrame(resumed, "D-07-git-commit");

  expect((await run("git", ["status", "--porcelain"], { cwd: repo.root })).stdout).toBe("");
  expect((await run("git", ["log", "--format=%s", "-1"], { cwd: repo.root })).stdout).toBe(
    "Fix sum\n",
  );

  const gaps: readonly Gap[] = [
    {
      step: "Read the failures as a canvas (failing test, suspect line, log excerpt)",
      shows: "◆ CI failures · canvas · open this chat in Nyte desktop to view it",
      frame: "D-03-canvas",
      verdict: "design",
      why: "Canvases run in a browser frame; the TUI names the canvas and points to desktop.",
    },
    {
      step: "Open test/sum.test.js:6 or src/sum.js:2 in the file editor at the line",
      shows:
        "src/sum.js:2 as inline code in the answer; the tool rows show the read and edit paths. Nothing opens an editor at a line.",
      frame: "D-04-answer",
      verdict: "gap",
      why: "The TUI has $EDITOR for the draft only (files.editor), and file:line text is not a link a terminal can act on.",
    },
    {
      step: "Review the change in the Changes panel and commit it",
      shows:
        "`!git diff --stat` and `!git commit` run from the composer and print in the transcript.",
      frame: "D-06-git-diff",
      verdict: "design",
      why: "The TUI leaves review and commit to the user's shell through ! commands; there is no per-file staging view.",
    },
    {
      step: "Open the failing job in the workbench browser",
      shows: 'The answer\'s link text "the failing job" in the link color.',
      frame: "D-04-answer",
      verdict: "design",
      why: "The TUI has no browser; the terminal opens the answer's link.",
    },
  ];

  await saveProof("D-trace", {
    trace,
    machine: machineLoad(),
    pressed,
    hops,
    logToolRun: logCall?.duration ?? null,
    waterfall,
  });

  await saveProof("D-gaps", gaps);
  expect(overBudget(hops)).toEqual([]);
}, 90_000);
