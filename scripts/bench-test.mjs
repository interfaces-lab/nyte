import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

const DEFAULT_PACKAGES = ["host", "tui", "app", "desktop"];

const USAGE = `Usage: pnpm bench:test [package ...]

Runs each package's test script BENCH_WARMUPS times unmeasured (default 0), then
BENCH_RUNS times measured (default 1), each in a fresh temp HOME, and prints the
wall-clock seconds as METRIC lines: the median per package, then the best, the
worst and the failed runs. Packages default to ${DEFAULT_PACKAGES.join(", ")}.
A failed run's output is kept and its path printed.

Example: BENCH_WARMUPS=1 BENCH_RUNS=3 pnpm bench:test host tui`;

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const count = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number.`);

  return value;
};

const warmups = count("BENCH_WARMUPS", 0);
const runs = Math.max(1, count("BENCH_RUNS", 1));
const packages = args.length === 0 ? DEFAULT_PACKAGES : args;
const logs = mkdtempSync(join(tmpdir(), "nyte-bench-test-"));

const runOnce = (name, label) => {
  const home = mkdtempSync(join(tmpdir(), "nyte-bench-home-"));
  const log = join(logs, `${name}-${label}.log`);
  const started = performance.now();

  const result = spawnSync("pnpm", ["--dir", join("packages", name), "test"], {
    cwd: root,
    env: { ...process.env, HOME: home, FORCE_COLOR: "0" },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  const seconds = (performance.now() - started) / 1000;
  rmSync(home, { recursive: true, force: true });
  writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);

  return { seconds, failed: result.status !== 0, log };
};

const metric = (name, labels, value) =>
  process.stdout.write(
    `METRIC ${name}{${Object.entries(labels)
      .map(([key, label]) => `${key}="${label}"`)
      .join(",")}}=${value}\n`,
  );

const median = (values) => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const round = (seconds) => Math.round(seconds * 100) / 100;
let total = 0;
let failures = 0;

for (const name of packages) {
  const manifest = join(root, "packages", name, "package.json");
  const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};

  if (scripts.test === undefined) throw new Error(`packages/${name} has no test script.`);

  for (let warmup = 0; warmup < warmups; warmup += 1) runOnce(name, `warmup-${warmup + 1}`);
  const measured = Array.from({ length: runs }, (_, run) => runOnce(name, `run-${run + 1}`));
  const seconds = measured.map((run) => run.seconds);
  const failed = measured.filter((run) => run.failed);

  total += median(seconds);
  failures += failed.length;
  metric("test_suite_seconds", { package: name }, round(median(seconds)));
  metric("test_suite_best_seconds", { package: name }, round(Math.min(...seconds)));
  metric("test_suite_worst_seconds", { package: name }, round(Math.max(...seconds)));
  metric("test_suite_failed_runs", { package: name }, failed.length);

  for (const run of failed) process.stdout.write(`  failed run: ${run.log}\n`);
}

metric("test_suite_seconds", { package: "total" }, round(total));

if (failures === 0) rmSync(logs, { recursive: true, force: true });

process.exit(failures === 0 ? 0 : 1);
