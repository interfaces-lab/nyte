import { arch, cpus, platform, release } from "node:os";
import { HELP, parseArgs } from "./cli.ts";
import { histories } from "./histories.ts";
import { projections } from "./projections.ts";
import { sqliteObjects, watchReplay } from "./storage.ts";

async function main() {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.kind === "help") {
    process.stdout.write(HELP);
    return;
  }
  const results = [];
  if (options.suite === "all" || options.suite === "projections")
    results.push(...(await projections(options.sizes, options)));
  if (options.suite === "all" || options.suite === "histories")
    results.push(...(await histories(options.count, options)));
  if (options.suite === "all" || options.suite === "sqlite")
    results.push(...(await sqliteObjects(options.count, options)));
  if (options.suite === "all" || options.suite === "watch")
    results.push(...(await watchReplay(options.events, options)));
  let cpu = "unavailable";
  let logicalCpus: number | null = null;
  try {
    const info = cpus();
    cpu = info[0]?.model ?? "unavailable";
    logicalCpus = info.length;
  } catch {
    /* Optional metadata. */
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "ok",
        options,
        runtime: {
          engine: process.versions.bun === undefined ? "node" : "bun",
          node: process.versions.node,
          bun: process.versions.bun ?? null,
          sqlite: process.versions.sqlite ?? null,
          os: platform(),
          release: release(),
          arch: arch(),
          cpu,
          logicalCpus,
        },
        methodology: {
          quantiles: "nearest rank",
          timing: "performance.now, awaited operation result",
          gc: "not requested",
          setupAndValidation: "outside timing",
          historyComparison:
            "none; mixed projection workloads differ from historical user-only baseline",
        },
        results,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (cause: unknown) {
  process.stderr.write(
    `Benchmark failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exitCode = 1;
}
