import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { SCENARIOS } from "./world.ts";
import type { Scenario } from "./world.ts";

type Row = Readonly<Record<string, unknown>>;

interface Metric {
  readonly name: string;
  readonly unit: string;
  readonly runs: readonly number[];
}

const PROBE = { at: 0, frame: 1, scene: 2, diffUs: 3, writeUs: 4, cells: 5 } as const;

function summarize(directory: string): Map<string, Metric> {
  const metrics = new Map<string, Metric>();

  const add = (name: string, unit: string, values: readonly number[]): void => {
    if (values.length > 0) metrics.set(name, { name, unit, runs: values });
  };

  for (const scenario of SCENARIOS) {
    for (const target of ["binary", "source", "inprocess", "opencode-binary", "opencode-source"]) {
      const rows = load(directory, target, scenario);

      if (rows.length === 0) continue;
      const key = `${scenario} · ${target}`;

      for (const [name, unit, read] of METRICS[scenario]) {
        const values = rows.map((row) => read(row, target)).filter((value) => value !== null);

        add(`${key} · ${name}`, unit, values);
      }
    }
  }

  return metrics;
}

type Reader = (row: Row, target: string) => number | null;

const latency =
  (q: number): Reader =>
  (row) =>
    quantile(numbers(row["latencies"]), q);

const probeFrame =
  (q: number): Reader =>
  (row, target) => {
    const times =
      target === "inprocess"
        ? objects(row["frames"]).map((frame) => num(frame["frame"]))
        : lists(row["probe"]).map((sample) => sample[PROBE.frame] ?? 0);

    return times.length === 0 ? null : quantile(times, q);
  };

const bytesPerFrame =
  (q: number): Reader =>
  (row) =>
    quantile(
      objects(row["frames"]).map((frame) => num(frame["bytes"])),
      q,
    );

const cpu: Reader = (row) => num(row["cpuMs"]);

const rssGrowth: Reader = (row) => {
  const rss = numbers(row["rssMb"]);

  return rss.length < 2 ? null : (rss.at(-1) ?? 0) - (rss.at(-2) ?? 0);
};

const totalBytes: Reader = (row) => (row["bytes"] === undefined ? null : num(row["bytes"]));

const pick =
  (index: number): Reader =>
  (row) =>
    numbers(row["latencies"])[index] ?? null;

const COMMON: readonly (readonly [string, string, Reader])[] = [
  ["frame p50", "ms", probeFrame(0.5)],
  ["frame p95", "ms", probeFrame(0.95)],
  ["bytes/frame p50", "B", bytesPerFrame(0.5)],
  ["bytes/frame p95", "B", bytesPerFrame(0.95)],
  ["bytes", "B", totalBytes],
  ["cpu", "ms", cpu],
  ["rss growth", "MB", rssGrowth],
];

const METRICS: Readonly<Record<Scenario, readonly (readonly [string, string, Reader])[]>> = {
  cold: [
    ["first frame", "ms", pick(0)],
    ["ready", "ms", pick(1)],
    ["rss at ready", "MB", (row) => numbers(row["rssMb"])[0] ?? null],
  ],
  typing: [
    ["key→paint p50", "ms", latency(0.5)],
    ["key→paint p95", "ms", latency(0.95)],
    ...COMMON,
  ],
  streaming: [["send→done", "ms", pick(0)], ...COMMON],
  diff: [["send→diff shown", "ms", pick(0)], ["send→done", "ms", pick(1)], ...COMMON],
  resize: [
    ["resize→paint p50", "ms", latency(0.5)],
    ["resize→paint p95", "ms", latency(0.95)],
    ...COMMON,
  ],
  idle: [["frames in 30 s", "", pick(0)], ...COMMON],
  welcome: [["frames in 30 s", "", pick(0)], ...COMMON],
  soak: [
    ["memory turn 5", "MB", pick(4)],
    ["memory turn 30", "MB", pick(29)],
    ["growth per 100 turns", "MB", (row) => soakSlope(numbers(row["latencies"]))],
    ...COMMON,
  ],
};

function soakSlope(memory: readonly number[]): number | null {
  const points = memory.slice(4).map((value, index) => [index, value] as const);

  if (points.length < 2) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const numerator = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);

  return (numerator / denominator) * 100;
}

function load(directory: string, target: string, scenario: Scenario): Row[] {
  if (!existsSync(directory)) return [];
  const prefix = `${target}-${scenario}-`;

  return readdirSync(directory)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .map((file) => parseRow(readFileSync(join(directory, file), "utf8")));
}

function parseRow(text: string): Row {
  const parsed: unknown = JSON.parse(text);

  if (typeof parsed !== "object" || parsed === null) throw new Error("A result is not an object.");

  return Object.fromEntries(Object.entries(parsed));
}

function print(metrics: Map<string, Metric>): void {
  process.stdout.write("| metric | p50 of runs | p95 of runs | spread (min–max) | runs |\n");
  process.stdout.write("| --- | ---: | ---: | ---: | ---: |\n");

  for (const metric of metrics.values()) {
    const unit = metric.unit === "" ? "" : ` ${metric.unit}`;
    process.stdout.write(
      `| ${metric.name} | ${fmt(quantile(metric.runs, 0.5))}${unit} | ${fmt(quantile(metric.runs, 0.95))}${unit} | ${fmt(Math.min(...metric.runs))}–${fmt(Math.max(...metric.runs))} | ${String(metric.runs.length)} |\n`,
    );
  }
}

function compare(before: Map<string, Metric>, after: Map<string, Metric>): void {
  process.stdout.write(
    "| metric | before p50 (spread) | after p50 (spread) | change | beyond noise |\n",
  );
  process.stdout.write("| --- | ---: | ---: | ---: | :---: |\n");

  for (const [name, old] of before) {
    const next = after.get(name);

    if (next === undefined) continue;
    const was = quantile(old.runs, 0.5);
    const now = quantile(next.runs, 0.5);
    const separated =
      Math.max(...next.runs) < Math.min(...old.runs) ||
      Math.min(...next.runs) > Math.max(...old.runs);
    const change = was === 0 ? "—" : `${fmt(((now - was) / was) * 100)}%`;

    process.stdout.write(
      `| ${name} | ${fmt(was)} (${fmt(Math.min(...old.runs))}–${fmt(Math.max(...old.runs))}) | ${fmt(now)} (${fmt(Math.min(...next.runs))}–${fmt(Math.max(...next.runs))}) | ${change} | ${separated ? "yes" : "no"} |\n`,
    );
  }
}

function quantile(values: readonly number[], q: number): number {
  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

function fmt(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);

  return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => num(item)) : [];
}

function lists(value: unknown): number[][] {
  return Array.isArray(value) ? value.map((item) => numbers(item)) : [];
}

function objects(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "object" && item !== null ? [Object.fromEntries(Object.entries(item))] : [],
      )
    : [];
}

const [first, second] = process.argv.slice(2);

if (first === undefined) throw new Error("Usage: report.ts <run dir> [<candidate dir>]");

const baseline = summarize(first);

if (second === undefined) print(baseline);
else compare(baseline, summarize(second));
