import { performance } from "node:perf_hooks";
import type { BenchDriver } from "./driver.ts";

/** One guarantee from the baseline: an invariant that must hold and metrics with budgets. */
export interface Scenario {
  readonly name: string;
  /** The baseline section and guarantee this checks, in one line. */
  readonly guarantee: string;
  run(driver: BenchDriver): Promise<ScenarioResult>;
}

export interface ScenarioResult {
  readonly name: string;
  readonly invariants: readonly { readonly name: string; readonly held: boolean; readonly detail?: string }[];
  readonly metrics: Readonly<Record<string, number>>;
}

export function invariant(name: string, held: boolean, detail?: string) {
  return detail === undefined ? { name, held } : { name, held, detail };
}

export async function timed<T>(work: () => Promise<T>): Promise<{ readonly value: T; readonly ms: number }> {
  const start = performance.now();
  const value = await work();

  return { value, ms: performance.now() - start };
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = samples.toSorted((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/** Collects every yield of a watch until `until` says stop, timing the gaps. */
export async function collect<T>(
  stream: AsyncIterable<T>,
  until: (value: T, index: number) => boolean,
): Promise<{ readonly views: readonly T[]; readonly gapsMs: readonly number[]; readonly ms: number }> {
  const views: T[] = [];
  const gapsMs: number[] = [];
  const start = performance.now();
  let last = start;

  for await (const value of stream) {
    const now = performance.now();
    gapsMs.push(now - last);
    last = now;
    views.push(value);

    if (until(value, views.length - 1)) break;
  }

  return { views, gapsMs, ms: performance.now() - start };
}

export function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
