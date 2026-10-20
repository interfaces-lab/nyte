import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { buildWaterfall, readSpanFile } from "@nyte-ai/bench";
import type { Waterfall } from "@nyte-ai/bench";
import { readSpans } from "@nyte-ai/sdk/client";
import type { SpanName } from "@nyte-ai/sdk";
import type { CapturedFrame, RGBA } from "@opentui/core";
import type { Store } from "../../src/app/store.ts";
import { followedSession } from "../../src/model/state.ts";
import type { Tui } from "../harness/tui.ts";

const PROOF_DIR = process.env["NYTE_TUI_PROOF_DIR"];

export function lastTrace(store: Store): string {
  const view = followedSession(store.state())?.view;
  const sent = view?.messages.findLast((message) => message.kind === "user");

  if (sent === undefined) throw new Error("No user message has landed.");

  return sent.id;
}

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export async function submit(tui: Tui, text: string): Promise<number> {
  await tui.mockInput.typeText(text);
  const pressed = epochNow();
  tui.mockInput.pressEnter();

  return pressed;
}

export async function traceWaterfall(
  trace: string,
  servers: Readonly<Record<string, string>>,
): Promise<Waterfall> {
  const children = await Promise.all(
    Object.entries(servers).map(async ([name, file]) => ({
      process: `mcp:${name}`,
      spans: await readSpanFile(file),
    })),
  );

  return buildWaterfall(trace, [{ process: "tui", spans: readSpans() }, ...children]);
}

export interface Hop {
  readonly hop: string;
  readonly ms: number;
  readonly budget: number;
}

export function spanHops(
  waterfall: Waterfall,
  budgets: Partial<Readonly<Record<SpanName, number>>>,
): readonly Hop[] {
  return Object.entries(budgets).flatMap(([name, budget]) => {
    const durations = waterfall.rows.flatMap((row) =>
      row.name === name && row.traced ? [row.duration] : [],
    );

    if (durations.length === 0 || budget === undefined) return [];

    return [{ hop: name, ms: round(Math.max(...durations)), budget }];
  });
}

export function spanEnd(
  trace: string,
  name: SpanName,
  detail?: Readonly<Record<string, string>>,
): number | null {
  const span = readSpans(trace).find(
    (candidate) =>
      candidate.name === name &&
      Object.entries(detail ?? {}).every(([key, value]) =>
        String(candidate.detail[key]).includes(value),
      ),
  );

  return span === undefined ? null : span.start + span.duration;
}

export function spanStart(trace: string, name: SpanName): number | null {
  return readSpans(trace).find((span) => span.name === name)?.start ?? null;
}

export function machineLoad() {
  return { load: round(loadavg()[0] ?? 0), cores: availableParallelism() };
}

export function overBudget(hops: readonly Hop[]): readonly Hop[] {
  const { load, cores } = machineLoad();

  return load >= cores ? [] : hops.filter((hop) => hop.ms > hop.budget);
}

export function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export function hex(color: RGBA): string {
  return `#${color
    .toInts()
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function savedFrame(frame: CapturedFrame) {
  return {
    cols: frame.cols,
    rows: frame.rows,
    cursor: frame.cursor,
    lines: frame.lines.map((line) =>
      line.spans.map((span) => ({
        text: span.text,
        fg: hex(span.fg),
        bg: hex(span.bg),
        attributes: span.attributes,
        width: span.width,
      })),
    ),
  };
}

export async function saveFrame(tui: Pick<Tui, "captureCharFrame" | "captureSpans">, name: string) {
  if (PROOF_DIR === undefined) return;
  await mkdir(PROOF_DIR, { recursive: true });
  await writeFile(join(PROOF_DIR, `${name}.txt`), tui.captureCharFrame());
  await writeFile(
    join(PROOF_DIR, `${name}.json`),
    `${JSON.stringify(savedFrame(tui.captureSpans()))}\n`,
  );
}

export async function saveProof(name: string, value: object): Promise<void> {
  if (PROOF_DIR === undefined) return;
  await mkdir(PROOF_DIR, { recursive: true });
  await writeFile(join(PROOF_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

export interface Gap {
  readonly step: string;
  readonly shows: string;
  readonly frame: string;
  readonly verdict: "design" | "gap";
  readonly why: string;
}

export function transcriptRows(frame: string): string {
  const lines = frame.split("\n");
  const border = lines.findIndex((line) => line.trimStart().startsWith("╭─"));

  return (border < 0 ? lines : lines.slice(0, border)).join("\n");
}

export const SAMPLE_ANSWER = [
  "## Plan",
  "",
  "Run **the failing test**, read `src/sum.js`, then see [the job](https://ci.fixture.test/run/1).",
  "",
  "- one step",
  "- another step",
  "",
  "> A quoted note.",
  "",
  "```ts",
  'export function sum(a: number, b: number): number {\n  return a + b; // "fixed"\n}',
  "```",
].join("\n");

export function framedCells(frame: CapturedFrame): readonly string[] {
  const last = frame.cols - 1;

  return frame.lines.map((line) => {
    let column = 0;

    return line.spans
      .flatMap((span) => {
        const start = column;
        column += span.width;

        if (start >= last) return [];
        const text = column > last ? span.text.slice(0, last - start) : span.text;

        return [`${text}${hex(span.fg)}${hex(span.bg)}${String(span.attributes)}`];
      })
      .join("|");
  });
}
