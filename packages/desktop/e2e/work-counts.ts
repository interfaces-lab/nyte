import type { Page } from "@playwright/test";

/** Counts from `countWork` and `useCommitCount` in the app, which record only while `NYTE_TRACE` is set. */
export type Counts = Readonly<Record<string, number>>;

/** A ceiling for each counter; a counter without one is reported, not gated. */
export type WorkBudget = Readonly<Record<string, number>>;

export interface WorkSummary {
  readonly samples: number;
  readonly median: Counts;
  readonly max: Counts;
}

const QUIET_FRAMES = 30;

declare global {
  interface Window {
    nyteWorkCounts?: Record<string, number>;
  }
}

/** Turns the app's work counters on: they record only while tracing is, which the renderer reads at load. */
export async function countWork(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem("NYTE_TRACE", "1"));
  await page.reload();
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });
}

/** Turns the counters off again, so later work in the same window runs without tracing. */
export async function stopCountingWork(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem("NYTE_TRACE"));
  await page.reload();
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });
}

export function readCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => ({ ...window.nyteWorkCounts }));
}

/** The work done between two readings. */
export function difference(before: Counts, after: Counts): Counts {
  return Object.fromEntries(
    Object.entries(after).map(([name, count]) => [name, count - (before[name] ?? 0)]),
  );
}

/** Counts `publish:view:<session>` as one `publish:view`, so samples over different chats compare. */
export function acrossSessions(counts: Counts): Counts {
  const merged = new Map<string, number>();

  for (const [name, count] of Object.entries(counts)) {
    const key = name.startsWith("publish:view:") ? "publish:view" : name;
    merged.set(key, (merged.get(key) ?? 0) + count);
  }

  return Object.fromEntries(merged);
}

/** Resolves once no counter has moved for 30 animation frames: the work an action started has finished. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((done) => {
        let last = JSON.stringify(window.nyteWorkCounts ?? {});
        let still = 0;

        const tick = (): void => {
          const now = JSON.stringify(window.nyteWorkCounts ?? {});
          still = now === last ? still + 1 : 0;
          last = now;

          if (still >= frames) done();
          else requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      }),
    QUIET_FRAMES,
  );
}

/** Nearest-rank percentile: always one of the samples. */
export function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((first, second) => first - second);

  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

export function summarize(samples: readonly Counts[]): WorkSummary {
  const names = [...new Set(samples.flatMap((sample) => Object.keys(sample)))].toSorted();

  const across = (fold: (values: readonly number[]) => number): Counts =>
    Object.fromEntries(
      names.map((name) => [name, fold(samples.map((sample) => sample[name] ?? 0))]),
    );

  return {
    samples: samples.length,
    median: across((values) => percentile(values, 0.5)),
    max: across((values) => Math.max(...values)),
  };
}

/** Each counter of `counts` over its ceiling in `budget`, as `<scenario> › <counter>: <count> > <ceiling>`. */
export function overBudget(scenario: string, counts: Counts, budget: WorkBudget): string[] {
  return Object.entries(budget).flatMap(([name, ceiling]) => {
    const count = counts[name] ?? 0;

    return count > ceiling ? [`${scenario} › ${name}: ${String(count)} > ${String(ceiling)}`] : [];
  });
}
