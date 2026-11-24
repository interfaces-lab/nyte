import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { heapStats } from "bun:jsc";
import { startTui } from "../../test/harness/tui.ts";
import type { Tui } from "../../test/harness/tui.ts";
import { TYPED } from "./content.ts";
import {
  DIFF_END,
  HISTORY,
  openWorld,
  parseScenario,
  scriptDiff,
  scriptStream,
  SOAK_TURNS,
  soakReply,
  STREAM_END,
} from "./world.ts";
import type { Scenario, World } from "./world.ts";

const SIZE = { width: 100, height: 32 } as const;

const FRAME_MS = 16;

const IDLE_MS = 30_000;

const RESIZES = [
  [120, 40],
  [80, 24],
  [160, 50],
  [100, 32],
] as const;

const RESIZE_ROUNDS = 8;

const STREAM_LIMIT_MS = 30_000;

export interface FrameSample {
  readonly wall: number;
  readonly frame: number;
  readonly scene: number;
  readonly diffUs: number;
  readonly writeUs: number;
  readonly cells: number;
  readonly yogaSolves: number;
  readonly layoutRounds: number;
  readonly painted: number;
  readonly damageRows: number;
}

export interface InprocessResult {
  readonly scenario: Scenario;
  readonly frames: readonly FrameSample[];
  readonly latencies: readonly number[];
  readonly window: { readonly start: number; readonly end: number };
  readonly cpuMs: number;
  readonly heapMb: number;
  readonly rssMb: number;
  readonly checks: Readonly<Record<string, boolean>>;
}

const scenario = parseScenario(process.argv[2]);

const out = process.env["BENCH_OUT"];

const heapDir = process.env["BENCH_HEAP_DIR"];

await using world = await openWorld(HISTORY[scenario]);

const opened = performance.now();

await using tui = await startTui({
  fixture: world.fixture,
  size: SIZE,
  renderer: { gatherStats: true, nativeSceneVerify: false },
  ...(world.session === null ? {} : { target: { kind: "session", id: world.session } }),
});

const frames: FrameSample[] = [];

const latencies: number[] = [];

const checks: Record<string, boolean> = {};

async function frame(): Promise<number> {
  const start = performance.now();
  await tui.renderOnce();
  const wall = performance.now() - start;
  const stats = tui.renderer.getStats();
  const work = stats.frameWork;

  frames.push({
    wall,
    frame: stats.frameTimes.at(-1) ?? 0,
    scene: tui.renderer["_lastSceneTimeMs"],
    diffUs: stats.nativeRenderTime ?? 0,
    writeUs: stats.nativeStdoutWriteTime ?? 0,
    cells: stats.cellsUpdated,
    yogaSolves: work.yogaSolves,
    layoutRounds: work.layoutRounds,
    painted: work.membersPainted,
    damageRows: work.damageRows,
  });

  return wall;
}

async function settle(seeded: World, last: string | null): Promise<void> {
  await tui.ready();

  if (seeded.session !== null && last !== null) await tui.frame((shown) => shown.includes(last));
  await tui.highlighted();

  for (let index = 0; index < 5; index++) await tui.renderOnce();
}

async function paced(done: () => boolean, limitMs: number): Promise<void> {
  const deadline = performance.now() + limitMs;

  while (!done()) {
    if (performance.now() > deadline) {
      throw new Error(
        `Timed out in run ${tui.store.screen().run.kind}:\n${tui.captureCharFrame()}`,
      );
    }
    const started = performance.now();
    tui.clock.advance(FRAME_MS);
    await frame();
    await Bun.sleep(Math.max(0, FRAME_MS - (performance.now() - started)));
  }
}

const idle = (shown: Tui): boolean => shown.store.screen().run.kind === "idle";

async function sitIdle(): Promise<void> {
  let painted = 0;
  const count = (): void => {
    painted++;
  };

  tui.renderer.on("frame", count);

  for (let elapsed = 0; elapsed < IDLE_MS; elapsed += FRAME_MS) {
    tui.clock.advance(FRAME_MS);
    await Bun.sleep(0);
  }

  tui.renderer.off("frame", count);
  latencies.push(painted);
}

const RUNS: Readonly<Record<Scenario, () => Promise<void>>> = {
  async cold() {
    await tui.frame((shown) => shown.includes("❯"));
    latencies.push(performance.now() - opened);
    await tui.ready();
    latencies.push(performance.now() - opened);
  },
  async typing() {
    for (const char of TYPED) {
      const start = performance.now();
      tui.mockInput.pressKey(char);
      await frame();
      latencies.push(performance.now() - start);
    }

    checks["typed"] = tui.captureCharFrame().includes(TYPED.slice(0, 40));
  },
  async streaming() {
    scriptStream(world.fixture);
    const start = performance.now();
    await tui.send("Stream the plan.");
    await paced(() => tui.captureCharFrame().includes(STREAM_END) && idle(tui), STREAM_LIMIT_MS);
    latencies.push(performance.now() - start);
    checks["streamed"] = tui.captureCharFrame().includes(STREAM_END);
  },
  async diff() {
    scriptDiff(world.fixture);
    const start = performance.now();
    await tui.send("Show the diff.");
    await paced(() => tui.captureCharFrame().includes("value1497 = 2994"), STREAM_LIMIT_MS);
    latencies.push(performance.now() - start);
    await paced(() => tui.captureCharFrame().includes(DIFF_END) && idle(tui), STREAM_LIMIT_MS);
    latencies.push(performance.now() - start);
    checks["diff"] = tui.captureCharFrame().includes(DIFF_END);
  },
  async resize() {
    for (let round = 0; round < RESIZE_ROUNDS; round++) {
      for (const [width, height] of RESIZES) {
        const start = performance.now();
        tui.resize(width, height);
        await frame();
        latencies.push(performance.now() - start);
      }
    }

    checks["resized"] = tui.captureCharFrame().includes("Step 499");
  },
  idle: sitIdle,
  welcome: sitIdle,
  async soak() {
    for (let turn = 0; turn < SOAK_TURNS; turn++) {
      const next = soakReply(turn);
      world.fixture.reply(next.reply);
      await tui.send(`Soak turn ${String(turn)}.`);
      await paced(() => tui.captureCharFrame().includes(next.shown) && idle(tui), STREAM_LIMIT_MS);
      Bun.gc(true);
      latencies.push(heapStats().heapSize / 1024 / 1024);
    }
  },
};

if (scenario === "welcome") await settle(world, null);
else if (scenario !== "cold") await settle(world, `Step ${String(HISTORY[scenario] - 1)}`);

frames.length = 0;

const cpuBefore = process.cpuUsage();

const start = performance.timeOrigin + performance.now();

await RUNS[scenario]();

const end = performance.timeOrigin + performance.now();

const cpu = process.cpuUsage(cpuBefore);

Bun.gc(true);

if (heapDir !== undefined) {
  writeFileSync(
    join(heapDir, `${scenario}-${String(process.pid)}.heapsnapshot`),
    Bun.generateHeapSnapshot("v8"),
  );
}

const result: InprocessResult = {
  scenario,
  frames,
  latencies,
  window: { start, end },
  cpuMs: (cpu.user + cpu.system) / 1000,
  heapMb: heapStats().heapSize / 1024 / 1024,
  rssMb: process.memoryUsage().rss / 1024 / 1024,
  checks,
};

if (out === undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
else writeFileSync(out, JSON.stringify(result));
