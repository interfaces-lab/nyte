/**
 * Runs every scenario against the driver the host package exports and writes
 * results/<timestamp>.json. Exit code 1 when any invariant or budget fails.
 *
 *   pnpm --dir packages/bench bench
 *   pnpm --dir packages/bench bench -- stop-fence edit-mid-stream
 */
import { fileURLToPath } from "node:url";
import { createBenchDriver } from "@nyte-ai/host/bench";
import { sdk } from "@nyte-ai/sdk";
import { report } from "./report.ts";
import type { Scenario } from "./scenario.ts";
import { durableToolReplay } from "./scenarios/durable-tool-replay.ts";
import { editMidStream } from "./scenarios/edit-mid-stream.ts";
import { foldTokenThroughput } from "./scenarios/fold-token-throughput.ts";
import { gitPatchesBatching } from "./scenarios/git-patches-batching.ts";
import { initialLoad } from "./scenarios/initial-load.ts";
import { reconnectResume } from "./scenarios/reconnect-resume.ts";
import { sessionsDirectory } from "./scenarios/sessions-directory.ts";
import { stopFence } from "./scenarios/stop-fence.ts";
import { storeCas } from "./scenarios/store-cas.ts";
import { watchCoalescing } from "./scenarios/watch-coalescing.ts";
import { watchReopen } from "./scenarios/watch-reopen.ts";

const scenarios: readonly Scenario[] = [
  storeCas,
  foldTokenThroughput,
  watchCoalescing,
  initialLoad,
  stopFence,
  editMidStream,
  durableToolReplay,
  reconnectResume,
  gitPatchesBatching,
  sessionsDirectory,
  watchReopen,
];

const benchDriver = createBenchDriver({ connect: sdk.connect });
const selected = new Set(process.argv.slice(2));
const toRun =
  selected.size === 0 ? scenarios : scenarios.filter((scenario) => selected.has(scenario.name));
const results = [];

for (const scenario of toRun) {
  process.stdout.write(`▸ ${scenario.name}: ${scenario.guarantee}\n`);
  results.push(await scenario.run(benchDriver));
}

const root = fileURLToPath(new URL("..", import.meta.url));
const ok = await report(
  results,
  `${root}budgets.json`,
  `${root}results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
process.exitCode = ok ? 0 : 1;
