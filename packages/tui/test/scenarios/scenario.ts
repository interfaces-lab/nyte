import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { openHost, sqliteStore } from "@nyte-ai/host";
import type { Host } from "@nyte-ai/core";
import { buildWaterfall, readSpanFile } from "@nyte-ai/host/bench";
import type { FakeModels, Waterfall } from "@nyte-ai/host/bench";
import { readSpans } from "@nyte-ai/sdk/client";
import type { SpanName } from "@nyte-ai/sdk";
import type { CapturedFrame, RGBA } from "@opentui/core";
import type { Store } from "../../src/app/store.ts";
import { followedSession } from "../../src/model/state.ts";
import type { Tui } from "../harness/tui.ts";

/** Where scenario frames, waterfalls and gap tables are saved; nothing is written when unset. */
const PROOF_DIR = process.env["NYTE_TUI_PROOF_DIR"];

/** A bench host on a SQLite store in its own temp folder, removed with the host. */
export interface ScenarioHost extends AsyncDisposable {
  readonly host: Host;
  /** The SQLite file, so a second TUI can resume from the same store. */
  readonly path: string;
}

/**
 * Opens a host over `fake`'s models, the local `workspace` (default an empty folder) and the
 * scenario's `home`. It is open before the TUI launches, as the background service is; a test
 * holds the TUI's connection with `opened: false` to launch before it is reachable.
 */
export async function openScenarioHost(input: {
  readonly fake: FakeModels;
  readonly home: string;
  readonly workspace?: string;
}): Promise<ScenarioHost> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-tui-scenario-")));
  const path = join(folder, "nyte.db");
  const workspace = input.workspace ?? join(folder, "workspace");
  await mkdir(workspace, { recursive: true });

  const store = sqliteStore({ path });

  const host = await openHost({
    store,
    models: input.fake.models,
    workspace: { kind: "local", path: workspace },
    home: input.home,
  });

  return {
    host,
    path,
    async [Symbol.asyncDispose]() {
      await host.close();
      await store.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

/** The receipt id the TUI sent the last user message with, which is that submit's trace. */
export function lastTrace(store: Store): string {
  const view = followedSession(store.state())?.view;
  const sent = view?.messages.findLast((message) => message.kind === "user");

  if (sent === undefined) throw new Error("No user message has landed.");

  return sent.id;
}

/** Epoch milliseconds, the clock spans start on. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/** Types `text` into the composer and presses Enter; resolves the epoch time Enter was pressed. */
export async function submit(tui: Tui, text: string): Promise<number> {
  await tui.mockInput.typeText(text);
  const pressed = epochNow();
  tui.mockInput.pressEnter();

  return pressed;
}

/** One trace's spans from the TUI process and the scenario's fixture servers, in one order. */
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

/** A hop's measured time against its budget. */
export interface Hop {
  readonly hop: string;
  readonly ms: number;
  readonly budget: number;
}

/** The hops named in `budgets`, each the longest span of that name in `waterfall` (first span when `first`), rounded to 0.01 ms. */
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

/** The epoch end of the first `name` span of `trace` in this process whose detail values contain `detail`'s, or null. */
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

/** The epoch start of the first `name` span of `trace` in this process, or null. */
export function spanStart(trace: string, name: SpanName): number | null {
  return readSpans(trace).find((span) => span.name === name)?.start ?? null;
}

/** This machine's one-minute load average and core count, saved beside the hops they were measured under. */
export function machineLoad() {
  return { load: round(loadavg()[0] ?? 0), cores: availableParallelism() };
}

/**
 * The hops over their budget, or none while the machine is saturated (its one-minute load at or
 * above its core count), when wall-clock budgets measure other processes rather than this one.
 */
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

/** Saves the current frame as `<name>.txt` (characters) and `<name>.json` (`captureSpans`, colors as hex). */
export async function saveFrame(tui: Pick<Tui, "captureCharFrame" | "captureSpans">, name: string) {
  if (PROOF_DIR === undefined) return;
  await mkdir(PROOF_DIR, { recursive: true });
  await writeFile(join(PROOF_DIR, `${name}.txt`), tui.captureCharFrame());
  await writeFile(
    join(PROOF_DIR, `${name}.json`),
    `${JSON.stringify(savedFrame(tui.captureSpans()))}\n`,
  );
}

/** Saves `value` as `<name>.json` beside the frames. */
export async function saveProof(name: string, value: object): Promise<void> {
  if (PROOF_DIR === undefined) return;
  await mkdir(PROOF_DIR, { recursive: true });
  await writeFile(join(PROOF_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

/** A scenario step the desktop app takes that the TUI shows differently or not at all. */
export interface Gap {
  readonly step: string;
  /** What the TUI shows instead, as the frame shows it. */
  readonly shows: string;
  readonly frame: string;
  readonly verdict: "design" | "gap";
  readonly why: string;
}

/** The transcript rows of a frame: everything above the composer's top border. */
export function transcriptRows(frame: string): string {
  const lines = frame.split("\n");
  const border = lines.findIndex((line) => line.trimStart().startsWith("╭─"));

  return (border < 0 ? lines : lines.slice(0, border)).join("\n");
}

/** An answer that draws every markdown style the transcript has. */
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

/**
 * Each row of `frame` as cells (character, colors, attributes) without the scrollbar column.
 * OpenTUI 0.6.5 sizes the scrollbar thumb from the scroll range at the viewport's last change
 * (`SliderRenderable.viewPortSize` is clamped to `max - min` when set and not again when the
 * range moves), so a live and a resumed transcript of the same height draw different thumbs.
 */
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
