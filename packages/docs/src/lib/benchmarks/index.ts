import eve from "./eve-deepswe-lean.json";
import nyte from "./nyte-deepswe.json";
import overhead from "./nyte-overhead.json";
import suites from "./nyte-suites.json";
import promptSize from "./prompt-size.json";

/** One harness's DeepSWE result, in the shape eve publishes and Nyte Bench's `deepswe` run writes. */
export interface HarnessScore {
  readonly harness: string;
  readonly version: string | null;
  readonly resolved: number;
  readonly attempts: number;
  readonly resolveRate: { readonly estimate: number; readonly low: number; readonly high: number };
  readonly costPerResolvedUsd: number | null;
  readonly inputTokens: number;
  readonly cachedShare: number | null;
  readonly latencyP50Ms: number;
  readonly latencyP90Ms: number;
  readonly runUrl: string | null;
}

/** A set of harness results measured together, on one model and one set of tasks. */
export interface BenchmarkRun {
  readonly label: string;
  readonly tasks: string;
  readonly model: string;
  readonly measuredAt: string;
  readonly source: string;
  readonly ours: boolean;
  readonly harnesses: readonly HarnessScore[];
}

export const deepsweRuns: readonly BenchmarkRun[] = [
  {
    label: "Nyte Bench",
    tasks: `${nyte.tasks.length} DeepSWE ${nyte.dataset.version} tasks × ${nyte.attempts}`,
    model: `${nyte.model.id}, ${nyte.model.thinking} reasoning`,
    measuredAt: nyte.generatedAt,
    source: "https://github.com/interfaces-lab/nyte/tree/main/packages/nyte-bench",
    ours: true,
    harnesses: [nyte.harness],
  },
  {
    label: "eve-bench",
    tasks: `${eve.tasks} deepswe-lean tasks × ${eve.attempts}`,
    model: `${eve.model.id}, high reasoning`,
    measuredAt: eve.generatedAt,
    source: eve.source,
    ours: false,
    harnesses: eve.harnesses,
  },
];

export const nyteTasks = nyte.perTask;

/** Nyte's own time in a turn on a scripted model, from `pnpm --dir packages/nyte-bench overhead`. */
export const nyteOverhead = {
  ...overhead.scripted,
  machine: overhead.machine,
  measuredAt: overhead.generatedAt,
};

/** What a chat's first request carries before the user's words, per harness, in characters. */
export const promptSizes = {
  source: promptSize.source,
  harnesses: promptSize.harnesses.map((entry) => ({
    ...entry,
    total: entry.toolChars + entry.systemChars,
  })),
  /** Nyte's first request on a real model, in input tokens. */
  firstRequest: overhead.firstRequest.models,
};

const SUITE_ROWS = [
  { suite: "tool-calls", kind: "all", label: "Picks the right tool the first time" },
  { suite: "subagent-models", kind: "all", label: "Starts a subagent on the model you named" },
  { suite: "canvas", kind: "bad", label: "Draws a chart without being asked" },
  { suite: "canvas", kind: "guard", label: "Draws a working chart when asked" },
  { suite: "canvas", kind: "control", label: "Skips the chart when a sentence will do" },
] as const;

/** Nyte Bench pass counts per behaviour and model, from a run's `summary.json`. */
export const suiteScores = {
  measuredAt: suites.generatedAt,
  models: suites.models,
  rows: SUITE_ROWS.flatMap((row) => {
    const suite = suites.suites.find((entry) => entry.id === row.suite);

    if (suite === undefined) return [];

    return [
      {
        label: row.label,
        cells: suite.models.map((entry) => (row.kind === "all" ? entry : entry[row.kind])),
      },
    ];
  }),
};

export { capabilityGroups } from "./capabilities.ts";

export type { CapabilityCell, CapabilityGroup, CapabilityRow } from "./capabilities.ts";
