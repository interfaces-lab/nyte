export interface Repetitions {
  readonly samples: number;
  readonly warmups: number;
}

export interface Measurement {
  readonly ms: number;
  readonly heapUsedDeltaBytes: number;
}

/** Only the operation and its awaited result are inside the clock. */
export async function timed<Result>(operation: () => Result | Promise<Result>) {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await operation();
  const ms = performance.now() - start;
  const heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

  // Keep measurement arrays independent of the potentially large result.
  return { result, measurement: { ms, heapUsedDeltaBytes } };
}

export function summarize(measurements: readonly Measurement[]) {
  const durations = measurements.map((sample) => sample.ms).sort((a, b) => a - b);
  const heaps = measurements.map((sample) => sample.heapUsedDeltaBytes).sort((a, b) => a - b);

  return {
    samples: measurements.length,
    p50Ms: durations[Math.ceil(durations.length * 0.5) - 1],
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    sampleMs: measurements.map((sample) => sample.ms),
    heapUsedDeltaBytes: {
      p50: heaps[Math.ceil(heaps.length * 0.5) - 1],
      p95: heaps[Math.ceil(heaps.length * 0.95) - 1],
      interpretation: "noisy heap delta proxy; no GC; not allocations or retained memory",
    },
  };
}
