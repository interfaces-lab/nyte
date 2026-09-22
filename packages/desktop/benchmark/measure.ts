import { setTimeout as delay } from "node:timers/promises";
import type { LaunchedDesktop } from "./desktop.ts";
import { startProcessMetricsSampling, type ProcessMetricsReport } from "./process-metrics.ts";

export interface MeasuredOperation<Result> {
  readonly result: Result;
  readonly durationMs: number;
  readonly processes: ProcessMetricsReport;
}

function positiveEnvironmentNumber(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined) return fallback;
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);

  return value;
}

function benchmarkSampleIntervalMs(): number {
  return positiveEnvironmentNumber("NYTE_DESKTOP_BENCHMARK_INTERVAL_MS", 1_000);
}

export async function measureOperation<Result>(
  desktop: LaunchedDesktop,
  operation: () => Promise<Result>,
): Promise<MeasuredOperation<Result>> {
  const sampling = await startProcessMetricsSampling(
    desktop.application,
    benchmarkSampleIntervalMs(),
  );

  const started = performance.now();

  try {
    const result = await operation();

    return {
      result,
      durationMs: performance.now() - started,
      processes: await sampling.stop(),
    };
  } catch (error) {
    await sampling.stop().catch(() => undefined);
    throw error;
  }
}

export async function measureSettledDesktop(
  desktop: LaunchedDesktop,
  durationMs = positiveEnvironmentNumber("NYTE_DESKTOP_BENCHMARK_SETTLE_MS", 3_000),
): Promise<ProcessMetricsReport> {
  const sampling = await startProcessMetricsSampling(
    desktop.application,
    benchmarkSampleIntervalMs(),
  );

  await delay(durationMs);

  return sampling.stop();
}
