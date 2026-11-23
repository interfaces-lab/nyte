import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";

export const LOG_PATH = ".auto/log.jsonl";

export const STATUSES = ["keep", "discard", "crash", "checks_failed"] as const;

export const DIRECTIONS = ["lower", "higher"] as const;

const configType = Type.Object({
  type: Type.Literal("config"),
  name: Type.String(),
  metric: Type.String(),
  unit: Type.String(),
  direction: Type.Enum(DIRECTIONS),
  branch: Type.String(),
  commit: Type.String(),
});

const runType = Type.Object({
  type: Type.Literal("run"),
  run: Type.Integer({ minimum: 1 }),
  status: Type.Enum(STATUSES),
  metric: Type.Union([Type.Number(), Type.Null()]),
  description: Type.String(),
  commit: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
});

const entry = standard(Type.Union([configType, runType]));

export const standingState = standard(
  Type.Object({
    config: configType,
    runs: Type.Array(runType),
    next: Type.Integer({ minimum: 1 }),
    baseline: Type.Union([Type.Number(), Type.Null()]),
    best: Type.Union([Type.Number(), Type.Null()]),
    confidence: Type.Union([Type.Number(), Type.Null()]),
  }),
);

export type LogEntry = Infer<typeof entry>;

export type Standing = Infer<typeof standingState>;

export function parseLog(contents: string): readonly LogEntry[] {
  return contents.split("\n").flatMap((line) => readEntry(line) ?? []);
}

export function standing(entries: readonly LogEntry[]): Standing | null {
  const start = entries.findLastIndex((item) => item.type === "config");
  const config = entries[start];

  if (config?.type !== "config") return null;

  const runs = entries.slice(start + 1).filter((item) => item.type === "run");

  const measured = runs.flatMap((run) => (run.metric === null ? [] : [run.metric]));

  const kept = runs.flatMap((run) =>
    run.status === "keep" && run.metric !== null ? [run.metric] : [],
  );

  const baseline = measured[0] ?? null;

  const best =
    kept.length === 0 ? null : config.direction === "lower" ? Math.min(...kept) : Math.max(...kept);

  return {
    config,
    runs,
    next: entries.filter((item) => item.type === "run").length + 1,
    baseline,
    best,
    confidence:
      baseline === null || best === null ? null : noiseMultiple(measured, best - baseline),
  };
}

export function describeStanding(current: Standing): string {
  const unit = current.config.unit === "" ? "" : ` ${current.config.unit}`;
  const runs = `${current.runs.length} run${current.runs.length === 1 ? "" : "s"} in "${current.config.name}"`;

  if (current.baseline === null || current.best === null) return `${runs}; no kept result yet.`;

  const change =
    current.baseline === 0
      ? null
      : ((current.best - current.baseline) / Math.abs(current.baseline)) * 100;

  const better =
    current.config.direction === "lower"
      ? current.best <= current.baseline
      : current.best >= current.baseline;

  const versus =
    change === null
      ? `baseline ${current.baseline}${unit}`
      : `${Math.abs(change).toFixed(1)}% ${better ? "better" : "worse"} than the ${current.baseline}${unit} baseline`;

  const noise =
    current.confidence === null
      ? ""
      : ` Confidence ${current.confidence.toFixed(1)}x the noise${current.confidence < 1 ? ", so re-run before trusting it" : ""}.`;

  return `${runs}. Best ${current.config.metric} ${current.best}${unit}, ${versus}.${noise}`;
}

function noiseMultiple(metrics: readonly number[], improvement: number): number | null {
  if (metrics.length < 3) return null;

  const center = median(metrics);
  const spread = median(metrics.map((metric) => Math.abs(metric - center)));

  return spread === 0 ? null : Math.abs(improvement) / spread;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function readEntry(line: string): LogEntry | null {
  if (line.trim() === "") return null;

  try {
    const checked = entry["~standard"].validate(JSON.parse(line));

    return checked instanceof Promise || checked.issues !== undefined ? null : checked.value;
  } catch {
    return null;
  }
}
