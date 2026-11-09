import process from "node:process";
import { heapStats } from "bun:jsc";
import type { SessionView } from "@nyte-ai/sdk";
import { createTestRenderer } from "@opentui/core/testing";
import type { Renderable } from "@opentui/core";
import { render as mountSolid } from "@opentui/solid";
import { AppProvider } from "../src/app/context.tsx";
import type { App } from "../src/app/context.tsx";
import { createKit } from "../src/app/kit.ts";
import { createStore } from "../src/app/store.ts";
import { createTickers } from "../src/app/ticker.ts";
import { deriveScreen } from "../src/model/screen.ts";
import type { ScreenModel } from "../src/model/screen.ts";
import { DARK_THEME } from "../src/lib/theme.ts";
import { reduce } from "../src/model/reduce.ts";
import type { State } from "../src/model/state.ts";
import { registerSyntaxParsers } from "../src/services/syntax-parsers.ts";
import { Screen } from "../src/ui/screen.tsx";
import { buildView, FRESH } from "../test/fixture/view.ts";
import type { TurnBuilder } from "../test/fixture/view.ts";
import { ready } from "../test/model/support.ts";

const TURNS = Number(process.env["BENCH_TURNS"] ?? 120);

const STREAM_STEPS = Number(process.env["BENCH_STREAM"] ?? 240);

const SCROLLS = 40;

const NOW = 1_000_000;

const PARAGRAPH =
  "The renderer walks the tree once per frame, measuring text with **bold** and `inline code`, then lays out each block. ";

function answer(index: number): string {
  return [
    `### Step ${String(index)}`,
    PARAGRAPH.repeat(3),
    "- first item with a [link](https://example.com)",
    "- second item, a little longer than the first one",
    "- third item",
    "",
    "```ts",
    `export function step${String(index)}(input: number): number {`,
    "  const doubled = input * 2;",
    "  return doubled + 1;",
    "}",
    "```",
    "",
    "| column | value |",
    "| --- | --- |",
    `| turn | ${String(index)} |`,
    "",
    PARAGRAPH,
  ].join("\n");
}

function turn(index: number, live: string | null) {
  return (t: TurnBuilder): TurnBuilder => {
    const built = t
      .user(`Please do step ${String(index)} of the plan and show the code.`)
      .thinking(`Thinking about step ${String(index)}. ${PARAGRAPH}`)
      .tool("read", {
        args: { path: `src/file-${String(index)}.ts` },
        output: Array.from(
          { length: 30 },
          (_, line) => `${String(line + 1)}: const v = ${String(line)};`,
        ).join("\n"),
        class: { kind: "read", path: `src/file-${String(index)}.ts` },
      })
      .tool("bash", {
        args: { command: `bun test step-${String(index)}` },
        output: "ok 12 passed\n0 failed\n",
        class: { kind: "shell", command: `bun test step-${String(index)}` },
      });

    if (live === null) return built.text(answer(index)).ended("completed");

    return built.text(live, { live: true });
  };
}

function viewWith(liveText: string | null): SessionView {
  return buildView((v) => {
    let view = v;

    for (let index = 0; index < TURNS; index++)
      view = view.turn(`t${String(index)}`, turn(index, null));

    if (liveText === null) return view;

    return view.turn(`t${String(TURNS)}`, turn(TURNS, liveText)).live();
  });
}

function share<T>(previous: readonly T[], next: readonly T[]): T[] {
  return next.map((item, index) => {
    const old = previous[index];

    return old !== undefined && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
}

function shareView(previous: SessionView, next: SessionView): SessionView {
  return {
    ...next,
    messages: share(previous.messages, next.messages),
    parts: share(previous.parts, next.parts),
    turns: share(previous.turns, next.turns),
  };
}

function countRenderables(node: Renderable): number {
  return 1 + node.getChildren().reduce((sum, child) => sum + countRenderables(child), 0);
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function p95(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function heapMb(): number {
  Bun.gc(true);

  return heapStats().heapSize / 1024 / 1024;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

registerSyntaxParsers();

const STREAM_CHUNK = "streamed words keep arriving here, ";

const streamTexts = Array.from({ length: STREAM_STEPS + 1 }, (_, step) =>
  STREAM_CHUNK.repeat(step + 1),
);

const settledView = viewWith(null);

let streamViews: SessionView[] = [];

let lastView = viewWith(streamTexts[0] ?? "");

for (const text of streamTexts) {
  lastView = shareView(lastView, viewWith(text));
  streamViews.push(lastView);
}

const baselineHeap = heapMb();

const rssBefore = process.memoryUsage().rss;

const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true });

const initial = ready(settledView);

const pureSession = initial.facts.chat?.kind === "session" ? initial.facts.chat.id : null;

if (pureSession === null) throw new Error("The bench session did not open.");

const store = createStore({
  initial,
  now: () => NOW,
  runner: () => ({
    run: () => undefined,
    boot: () => undefined,
    changed: () => undefined,
    exited: new Promise<{ readonly code: number }>(() => undefined),
    settled: async () => undefined,
    dispose: async () => undefined,
  }),
  report: (_origin, error) => {
    throw error;
  },
});

const mountStart = performance.now();

await mountSolid(() => {
  const tickers = createTickers(setup.renderer.clock);

  const kit = createKit({
    renderer: setup.renderer,
    theme: () => DARK_THEME,
    tickers,
    blob: async function* () {},
    drawPart: () => null,
    attach: { composer: () => () => undefined, scroll: () => () => undefined },
    report: (_origin, error) => {
      throw error;
    },
  });

  const app: App = { screen: store.screen, dispatch: store.dispatch, kit };

  return (
    <AppProvider app={app}>
      <Screen />
    </AppProvider>
  );
}, setup.renderer);

await setup.renderOnce();

const mountMs = performance.now() - mountStart;

const renderables = countRenderables(setup.renderer.root);

const settledHeap = heapMb() - baselineHeap;

const session = pureSession;

const reduceTimes: number[] = [];

const frameTimes: number[] = [];

for (const view of streamViews) {
  const start = performance.now();
  store.dispatch({ kind: "view", session, view, freshness: FRESH });
  const reduced = performance.now();
  await setup.renderOnce();
  frameTimes.push(performance.now() - start);
  reduceTimes.push(reduced - start);
}

const streamHeap = heapMb() - baselineHeap;

const scrollTimes: number[] = [];

for (let index = 0; index < SCROLLS; index++) {
  const start = performance.now();
  store.dispatch({ kind: "scroll", to: index < SCROLLS / 2 ? "page-up" : "page-down" });
  await setup.renderOnce();
  scrollTimes.push(performance.now() - start);
}

const pureTimes: number[] = [];
const deriveTimes: number[] = [];
let previousScreen: ScreenModel | null = null;
let pure: State = initial;

for (const view of streamViews) {
  const start = performance.now();
  pure = reduce(pure, { kind: "view", session: pureSession, view, freshness: FRESH }, NOW).state;
  pureTimes.push(performance.now() - start);
  const derived = performance.now();
  previousScreen = deriveScreen(pure, previousScreen);
  deriveTimes.push(performance.now() - derived);
}

const frame = setup.captureCharFrame();

const rssAfter = process.memoryUsage().rss;

streamViews = [];

process.stdout.write(
  `${JSON.stringify({
    turns: TURNS,
    mount_ms: round(mountMs),
    renderables,
    heap_settled_mb: round(settledHeap),
    heap_stream_mb: round(streamHeap),
    rss_delta_mb: round((rssAfter - rssBefore) / 1024 / 1024),
    stream_frame_median_ms: round(median(frameTimes)),
    stream_frame_p95_ms: round(p95(frameTimes)),
    stream_total_ms: round(frameTimes.reduce((sum, value) => sum + value, 0)),
    stream_reduce_median_ms: round(median(pureTimes)),
    stream_derive_median_ms: round(median(deriveTimes)),
    stream_dispatch_median_ms: round(median(reduceTimes)),
    scroll_frame_median_ms: round(median(scrollTimes)),
    frame_ok: frame.includes("streamed words"),
  })}\n`,
);

setup.renderer.destroy();

process.exit(0);
