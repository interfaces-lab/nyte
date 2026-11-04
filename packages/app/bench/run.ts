import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { testRenderer } from "../test/renderer.ts";
import {
  DragCase,
  DragResult,
  MarkdownCase,
  MarkdownResult,
  StreamingCase,
  StreamingResult,
} from "./gates.ts";
import { median, spread } from "./stats.ts";

const TIMEOUT_MS = 240_000;

const MOTIONS = ["no-preference", "reduce"] as const;

const DRAG_SCENARIOS = [
  { name: "S1", panes: 2, filled: 1 },
  { name: "S2", panes: 2, filled: 2 },
  { name: "S4", panes: 4, filled: 4 },
] as const;

const STREAMING_SCENARIOS = [
  { name: "one Prose", streams: 1, covered: false },
  { name: "two Prose", streams: 2, covered: false },
  { name: "two Prose + one covered", streams: 2, covered: true },
] as const;

const electron = Value.Parse(
  Type.Object({ version: Type.String() }),
  JSON.parse(await readFile(new URL(import.meta.resolve("electron/package.json")), "utf8")),
);

console.info(`Electron ${electron.version}, ${cpus()[0]?.model ?? "unknown CPU"}`);

console.info(
  "G1 and G2 cells show the median of 5 runs after 1 warmup, with the min–max spread. G3 plays the document once per case.",
);

console.info(`\n## G1 markdown replay, 640px, 32-character steps\n\n${await markdownTable()}`);

console.info(`\n## G2 pane drag, 1280px row, simd.md per filled pane\n\n${await dragTable()}`);

console.info(
  "\nLayoutCount and RecalcStyleCount are not reported: the Electron main process holds the CDP session, and the page can't call Performance.getMetrics.",
);

console.info(
  `\n## G3 streaming simd.md, 32 characters every 40 ms, fades on\n\n${await streamingTable()}`,
);

async function markdownTable(): Promise<string> {
  const rows: string[][] = [];

  for (const motion of MOTIONS)
    for (const variant of ["prose", "streamdown"] as const) {
      const fixtures = await measureGate(
        new URL("./markdown.bench.tsx", import.meta.url),
        MarkdownCase,
        MarkdownResult,
        { variant },
        motion,
      );

      rows.push(
        ...fixtures.map((fixture) => [
          fixture.fixture,
          variant === "prose" ? "Prose" : "Streamdown bare",
          motion === "reduce" ? "reduce" : "fades on",
          String(fixture.updates),
          String(fixture.runs.length),
          cell(fixture.runs.map((measured) => measured.totalMs)),
          cell(fixture.runs.map((measured) => measured.scriptMs)),
          cell(fixture.runs.map((measured) => measured.layoutMs)),
          cell(
            fixture.runs.map((measured) => measured.p95Ms),
            2,
          ),
          cell(fixture.runs.map((measured) => measured.elements)),
        ]),
      );
    }

  return table(
    [
      "Fixture",
      "Renderer",
      "Motion",
      "Updates",
      "Runs",
      "Total ms",
      "Script ms",
      "Layout ms",
      "p95 per update ms",
      "Elements",
    ],
    rows,
  );
}

async function dragTable(): Promise<string> {
  const rows: string[][] = [];

  for (const scenario of DRAG_SCENARIOS) {
    const result = await measureGate(
      new URL("./drag.bench.tsx", import.meta.url),
      DragCase,
      DragResult,
      { panes: scenario.panes, filled: scenario.filled },
      "no-preference",
    );

    rows.push([
      scenario.name,
      String(scenario.panes),
      String(scenario.filled),
      String(result.runs.length),
      String(result.moves),
      cell(
        result.runs.map((measured) => measured.p50Ms),
        2,
      ),
      cell(
        result.runs.map((measured) => measured.p95Ms),
        2,
      ),
    ]);
  }

  return table(
    [
      "Scenario",
      "Panes",
      "Panes with simd.md",
      "Runs",
      "Moves per run",
      "Move p50 ms",
      "Move p95 ms",
    ],
    rows,
  );
}

async function streamingTable(): Promise<string> {
  const rows: string[][] = [];

  for (const scenario of STREAMING_SCENARIOS) {
    const result = await measureGate(
      new URL("./streaming.bench.tsx", import.meta.url),
      StreamingCase,
      StreamingResult,
      { streams: scenario.streams, covered: scenario.covered },
      "no-preference",
    );

    rows.push([
      scenario.name,
      "1",
      String(result.ticks),
      (result.playbackMs / 1000).toFixed(1),
      String(result.frames),
      result.p50Ms.toFixed(1),
      result.p95Ms.toFixed(1),
      result.p99Ms.toFixed(1),
      result.maxMs.toFixed(1),
      result.longTasks === null
        ? "unsupported"
        : `${String(result.longTasks.count)} / ${result.longTasks.totalMs.toFixed(0)} ms`,
    ]);
  }

  return table(
    [
      "Case",
      "Runs",
      "Ticks",
      "Playback s",
      "Frames",
      "rAF p50 ms",
      "rAF p95 ms",
      "rAF p99 ms",
      "rAF max ms",
      "Long tasks / total",
    ],
    rows,
  );
}

async function measureGate<C extends TSchema, R extends TSchema>(
  entry: URL,
  caseSchema: C,
  resultSchema: R,
  benchCase: Static<C>,
  motion: (typeof MOTIONS)[number],
): Promise<Static<R>> {
  const output = await testRenderer(
    entry,
    `window.nyte = { clientSurface: "desktop", host: { setThemePreference() {} } };
window.benchCase = ${JSON.stringify(Value.Parse(caseSchema, benchCase))};`,
    { motion, timeout: TIMEOUT_MS },
  );

  if (!output.startsWith("[") && !output.startsWith("{")) throw new Error(output);

  return Value.Parse(resultSchema, JSON.parse(output));
}

function cell(values: readonly number[], digits = 0): string {
  const range = spread(values);

  return `${median(values).toFixed(digits)} (${range.min.toFixed(digits)}–${range.max.toFixed(digits)})`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}
