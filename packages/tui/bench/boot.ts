import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { openPty } from "../qa/pty.ts";
import { freshHome } from "../qa/service.ts";

const BINARY =
  process.env["NYTE_BINARY"] ?? fileURLToPath(new URL("../dist/nyte", import.meta.url));

const RUNS = Number(process.env["BENCH_BOOT_RUNS"] ?? 12);

const VERSION_RUNS = Number(process.env["BENCH_VERSION_RUNS"] ?? 20);

const SETTLE_MS = 1_500;

function rssKb(pid: number): number {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });

  return Number(result.stdout.trim()) || 0;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function bootOnce(home: Awaited<ReturnType<typeof freshHome>>) {
  await rm(join(home.nyteHome, "tui-first-frame.json"), { force: true });
  await using pty = await openPty({ binary: BINARY, cwd: home.cwd, env: home.env });
  const deadline = performance.now() + 15_000;

  while (!(pty.screen().text.includes("❯") && pty.screen().text.includes("enter send"))) {
    if (performance.now() > deadline) throw new Error(`No paint:\n${pty.screen().text}`);
    await Bun.sleep(1);
  }

  const paintMs = performance.now() - pty.spawnedAt;
  const paintRss = rssKb(pty.pid);

  while (!pty.screen().text.includes("ctrl+p model")) {
    if (performance.now() > deadline) throw new Error(`Never ready:\n${pty.screen().text}`);
    await Bun.sleep(1);
  }

  const readyMs = performance.now() - pty.spawnedAt;
  await Bun.sleep(SETTLE_MS);

  return { paintMs, readyMs, paintRss, settledRss: rssKb(pty.pid), screen: pty.screen().text };
}

const versionTimes: number[] = [];

for (let run = 0; run < VERSION_RUNS; run++) {
  const start = performance.now();

  const result = spawnSync(BINARY, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NYTE_SKIP_VERSION_CHECK: "1" },
  });

  if (result.status !== 0) throw new Error(`--version failed: ${result.stderr.toString()}`);
  versionTimes.push(performance.now() - start);
}

await using home = await freshHome();

const cold = await bootOnce(home);

const warm = [];

for (let run = 0; run < RUNS; run++) warm.push(await bootOnce(home));

if (process.env["BENCH_SHOW_SCREEN"] === "1")
  process.stderr.write(`${warm.at(-1)?.screen ?? ""}\n`);

const round = (value: number): number => Math.round(value * 10) / 10;

process.stdout.write(
  `${JSON.stringify({
    version_median_ms: round(median(versionTimes)),
    cold_paint_ms: round(cold.paintMs),
    cold_ready_ms: round(cold.readyMs),
    warm_paint_median_ms: round(median(warm.map((run) => run.paintMs))),
    warm_paint_min_ms: round(Math.min(...warm.map((run) => run.paintMs))),
    warm_ready_median_ms: round(median(warm.map((run) => run.readyMs))),
    paint_rss_mb: round(median(warm.map((run) => run.paintRss)) / 1024),
    settled_rss_mb: round(median(warm.map((run) => run.settledRss)) / 1024),
  })}\n`,
);
