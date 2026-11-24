/** One step of getting a desktop ready to test, in milliseconds. */
export interface Phase {
  readonly phase: string;
  readonly ms: number;
}

export type Phases = readonly Phase[];

/** Runs `work`, then records how long it took as `phase` in `phases`, even when it throws. */
export async function timed<T>(phases: Phase[], phase: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();

  try {
    return await work();
  } finally {
    phases.push({ phase, ms: Math.round(performance.now() - started) });
  }
}

/** `seeded home 312 ms · electron launch 1.21 s · … = 3.4 s`, for a line of test output. */
export function describePhases(phases: Phases): string {
  const total = phases.reduce((sum, phase) => sum + phase.ms, 0);

  return `${phases.map((phase) => `${phase.phase} ${duration(phase.ms)}`).join(" · ")} = ${duration(total)}`;
}

function duration(ms: number): string {
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
