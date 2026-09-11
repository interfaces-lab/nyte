import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import { emptyUsageSummary, mergeUsageSummaries } from "@nyte-ai/core/views";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import type { ChartPalette } from "./usage-charts.tsx";
import { UsageToolsSection } from "./usage-tools.tsx";
import { deriveTools } from "./usage-view.ts";

// The skeleton reaches the preload bridge through the chart module; the tests
// here render settled markup only.
vi.hoisted(() => {
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => undefined } },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
  });
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", {
    head: { appendChild: () => undefined },
    createElement: () => ({ styleSheet: {} }),
    documentElement: { dataset: {}, style: { setProperty: () => undefined } },
  });
});
afterAll(() => vi.unstubAllGlobals());

const palette: ChartPalette = {
  axis: "#888",
  grid: "#888",
  crosshair: "#888",
  track: "#888",
  accent: "#1084fe",
  tokens: { input: "#1", output: "#2", cacheRead: "#3", cacheWrite: "#4" },
  series: ["#a", "#b", "#c", "#d", "#e", "#f"],
  heat: [],
};

function history(cost: number, tokens: number): UsageSnapshot["claudeCode"] {
  return {
    kind: "ready",
    summary: mergeUsageSummaries(emptyUsageSummary(), {
      ...emptyUsageSummary(),
      models: [
        {
          provider: "anthropic",
          model: "fixture",
          turns: 1,
          usage: {
            ...emptyUsageSummary().total,
            input: tokens,
            totalTokens: tokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
          },
        },
      ],
    }),
    unpricedRecords: 0,
    malformedRecords: 0,
    unreadableFiles: 0,
  };
}

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    readAt: 1,
    sinceDay: "2026-01-01",
    untilDay: "2026-01-31",
    entries: [
      {
        day: "2026-01-02",
        workspacePath: null,
        sessionId: sessionId("one"),
        subject: { kind: "model", provider: "openai", model: "gpt" },
        totals: {
          input: 100,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          tokens: 100,
          cost: 1,
          turns: 1,
        },
      },
    ],
    sessions: [],
    sources: [{ workspacePath: null, status: "ok", sessions: 1, message: null }],
    previous: undefined,
    earliestDay: "2026-01-02",
    nyteError: null,
    claudeCode: history(3, 300),
    codex: { kind: "missing" },
    ...overrides,
  };
}

test("the total is the sum of every tool that answered and each share is of that total", () => {
  const tools = deriveTools(snapshot());
  assert.equal(tools.cost, 4);
  assert.equal(tools.tokens, 400);
  assert.equal(tools.counted, 2);
  assert.deepEqual(
    tools.tools.map((spend) => [spend.tool, spend.kind === "ready" ? spend.share : spend.kind]),
    [
      ["nyte", 0.25],
      ["claudeCode", 0.75],
      ["codex", "missing"],
    ],
  );
});

test("a tool that could not be read keeps its row and stays out of the total", () => {
  const tools = deriveTools(
    snapshot({ nyteError: "Registry unavailable", codex: history(6, 600) }),
  );
  assert.equal(tools.cost, 9);
  assert.equal(tools.counted, 2);
  assert.deepEqual(tools.tools[0], {
    tool: "nyte",
    kind: "failed",
    message: "Registry unavailable",
  });
});

test("shares fall back to tokens when nothing anywhere was priced", () => {
  const tools = deriveTools(snapshot({ claudeCode: history(0, 300), entries: [] }));
  assert.equal(tools.cost, 0);
  const shares = tools.tools.map((spend) => (spend.kind === "ready" ? spend.share : undefined));
  assert.deepEqual(shares, [0, 1, undefined]);
});

test("the section leads with the total and names which tools it counts", () => {
  const html = renderToStaticMarkup(<UsageToolsSection report={snapshot()} palette={palette} />);
  assert.match(html, /All tools/);
  assert.match(html, /\$4\.00/);
  assert.match(html, /400 tokens across Nyte and Claude Code/);
  assert.match(html, /others not counted/);
  assert.match(html, /Share of spend by tool: Nyte 25%, Claude Code 75%/);
  assert.match(html, /No local history in CODEX_HOME or ~\/\.codex/);
  assert.match(html, /Not found/);
  assert.doesNotMatch(html, /<button|<a\s/);
});

test("a failed tool is announced and no tool reads as free", () => {
  const html = renderToStaticMarkup(
    <UsageToolsSection
      report={snapshot({ codex: { kind: "failed", message: "Rollouts unreadable" } })}
      palette={palette}
    />,
  );
  assert.match(html, /role="alert"[^>]*>Rollouts unreadable/);
  assert.match(html, /Couldn&#x27;t read/);
  assert.equal(html.match(/\$0\.00/g), null);
});

test("nothing readable is not presented as zero spend", () => {
  const html = renderToStaticMarkup(
    <UsageToolsSection
      report={snapshot({
        nyteError: "Registry unavailable",
        claudeCode: { kind: "missing" },
        codex: { kind: "missing" },
      })}
      palette={palette}
    />,
  );
  assert.match(html, /No history read/);
  assert.doesNotMatch(html, /\$0\.00/);
});
