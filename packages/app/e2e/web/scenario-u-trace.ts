import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { buildWaterfall, formatWaterfall } from "@nyte-ai/bench";
import type { SpanSource, Waterfall, WaterfallRow } from "@nyte-ai/bench";
import { SPAN_NAMES } from "@nyte-ai/sdk";
import type { Span } from "@nyte-ai/sdk";

export type Surface = "desktop" | "web";

interface Hop {
  readonly site: string;
  readonly budget: Readonly<Record<Surface, number>>;
}

export const HOPS: ReadonlyMap<string, Hop> = new Map([
  ["composer.submit", hop("app/src/conversation/composer-send.ts:startComposerChat", 55, 50)],
  ["sdk.send", hop("sdk/src/client.ts:sessions.start", 55, 50)],
  ["host.admit", hop("core/src/api/session.ts:start", 40, 45)],
  ["turn.start", hop("core/src/agent/turn.ts:prepareRequest", 795, 540)],
  ["model.stream", hop("core/src/agent/turn.ts:stream", 200, 160)],
  ["mcp.connect", hop("host/src/mcp/hub.ts:connectTraced", 825, 555)],
  ["mcp.call:search_places", hop("host/src/mcp/tools.ts:execute", 80, 70)],
  ["mcp.serve", hop("bench/src/scenarios/mcp-server.mjs:serve", 70, 65)],
  ["tool.run:read", hop("core/src/agent/turn.ts:execute", 25, 25)],
  ["tool.run:mcp__places__search_places", hop("core/src/agent/turn.ts:execute", 110, 70)],
  ["tool.run:canvas_render", hop("core/src/agent/turn.ts:execute", 30, 35)],
  ["tool.run:bash", hop("core/src/agent/turn.ts:execute", 4210, 4020)],
  ["canvas.compile", hop("plugin/src/canvas/canvas.ts:canvas_render.execute", 25, 25)],
  ["canvas.paint", hop("app/src/conversation/canvas-frame.tsx:CanvasFrame", 455, 170)],
  ["pty.spawn", hop("host/src/local/jobs.ts:localExec", 25, 25)],
  ["pty.output", hop("host/src/local/jobs.ts:localExec (output.push)", 3835, 3855)],
  ["part.publish", hop("core/src/fold/watch.ts:publishSet", 25, 25)],
  ["client.paint", hop("app/src/paint-spans.ts:tracePaints", 315, 45)],
]);

function hop(site: string, desktop: number, web: number): Hop {
  return { site, budget: { desktop, web } };
}

const USER_PACED = new Set(["tool.run:question"]);

export async function tabTo(target: Locator, backward = false, limit = 60): Promise<void> {
  const page = target.page();

  for (let presses = 0; presses < limit; presses += 1) {
    const focused = await target
      .evaluate((element) => element.contains(element.ownerDocument.activeElement))
      .catch(() => false);

    if (focused) return;
    await page.keyboard.press(backward ? "Shift+Tab" : "Tab");
  }

  throw new Error(`Tab never reached ${String(target)}.`);
}

export async function readRendererSpans(page: Page): Promise<readonly Span[]> {
  const entries = await page.evaluate(() =>
    performance.getEntriesByType("measure").map((entry) => ({
      name: entry.name,
      start: performance.timeOrigin + entry.startTime,
      duration: entry.duration,
      detail: JSON.stringify("detail" in entry ? entry.detail : null),
    })),
  );

  return entries.flatMap((entry): Span[] => {
    const name = SPAN_NAMES.find((candidate) => candidate === entry.name);

    if (name === undefined) return [];
    const parsed: unknown = JSON.parse(entry.detail);

    const fields = new Map<string, unknown>(
      parsed !== null && typeof parsed === "object" ? Object.entries(parsed) : [],
    );

    const detail: Record<string, string | number | boolean | null> = {};

    for (const [key, value] of fields)
      if (
        key !== "trace" &&
        (value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean")
      )
        detail[key] = value;
    const trace = fields.get("trace");

    return [
      {
        name,
        trace: typeof trace === "string" ? trace : null,
        start: entry.start,
        duration: entry.duration,
        detail,
      },
    ];
  });
}

export function submitTrace(spans: readonly Span[]): string {
  const trace = spans.findLast((span) => span.name === "composer.submit")?.trace;

  if (trace === null || trace === undefined)
    throw new Error("No composer.submit span was recorded.");

  return trace;
}

function hopKey(row: WaterfallRow): string {
  const served = row.detail.tool ?? row.detail.kind ?? row.detail.parts ?? null;
  const narrow = served === null ? row.name : `${row.name}:${String(served)}`;

  return HOPS.has(narrow) || USER_PACED.has(narrow) ? narrow : row.name;
}

export function hopDurations(waterfall: Waterfall): Readonly<Record<string, number>> {
  const longest: Record<string, number> = {};

  for (const row of waterfall.rows) {
    const key = hopKey(row);

    if (!USER_PACED.has(key) && (row.traced || row.name === "mcp.connect"))
      longest[key] = Math.max(longest[key] ?? 0, row.duration);
  }

  return longest;
}

export function expectWithinBudgets(waterfall: Waterfall, surface: Surface): void {
  const measured = hopDurations(waterfall);

  const over = [...HOPS].flatMap(([key, { budget }]) => {
    const duration = measured[key];

    if (duration === undefined) return [`${key} missing`];

    return duration > budget[surface]
      ? [`${key} ${duration.toFixed(1)} > ${budget[surface]} ms`]
      : [];
  });

  expect(over, `scenario U hops over their ${surface} budget`).toEqual([]);
}

export interface ScenarioRun {
  readonly surface: Surface;
  readonly wallMs: number;
  readonly hops: Readonly<Record<string, number>>;
  readonly waterfall: Waterfall;
  readonly facts: Readonly<Record<string, unknown>>;
}

export async function recordRun(input: {
  readonly surface: Surface;
  readonly trace: string;
  readonly sources: readonly SpanSource[];
  readonly wallMs: number;
  readonly facts: Readonly<Record<string, unknown>>;
}): Promise<ScenarioRun> {
  const waterfall = buildWaterfall(input.trace, input.sources);

  const run: ScenarioRun = {
    surface: input.surface,
    wallMs: input.wallMs,
    hops: hopDurations(waterfall),
    waterfall,
    facts: input.facts,
  };

  const folder = process.env.NYTE_SCENARIO_U_OUT;

  if (folder !== undefined && folder !== "") {
    await mkdir(folder, { recursive: true });
    const name = `${input.surface}-${String(Date.now())}`;
    await writeFile(join(folder, `${name}.json`), `${JSON.stringify(run, null, 2)}\n`);
    await writeFile(join(folder, `${name}.txt`), `${formatWaterfall(waterfall)}\n`);
  }

  return run;
}

export function settledFrames(snapshot: string, last: RegExp): string {
  const lines = snapshot.split("\n");
  const end = lines.findIndex((line) => last.test(line));

  if (end < 0) throw new Error(`No transcript line matches ${String(last)}.`);

  return lines.slice(0, end + 1).join("\n");
}
