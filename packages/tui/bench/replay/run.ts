import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { parseScenario, SCENARIOS } from "./world.ts";
import type { Scenario } from "./world.ts";

const MODES = ["inprocess", "inprocess-prof", "binary", "source", "source-prof"] as const;

type Mode = (typeof MODES)[number];

const tui = fileURLToPath(new URL("../../", import.meta.url));

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    scenarios: { type: "string", default: SCENARIOS.join(",") },
    modes: { type: "string", default: "inprocess,inprocess-prof,binary,source,source-prof" },
    out: { type: "string", default: "/tmp/nyte-tui-replay/run" },
    binary: { type: "string", default: join(tui, "dist/nyte") },
  },
});

const runs = Number(values.runs);

const scenarios = values.scenarios.split(",").map((name) => parseScenario(name));

const modes = values.modes.split(",").map((name) => {
  const found = MODES.find((mode) => mode === name);

  if (found === undefined) throw new Error(`Name modes from: ${MODES.join(", ")}.`);

  return found;
});

const PROFILED: readonly Mode[] = ["inprocess-prof", "source-prof"];

const INTERVAL_US = "250";

mkdirSync(values.out, { recursive: true });

spawnSync(values.binary, ["--version"], { stdio: "ignore" });

for (const scenario of scenarios) {
  for (const mode of modes) {
    const count = PROFILED.includes(mode) ? 1 : runs;

    for (let run = 1; run <= count; run++) {
      const name = `${mode}-${scenario}-${String(run)}`;
      const started = performance.now();
      const failed = runOnce(mode, scenario, name);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);

      process.stderr.write(`${name} ${failed === null ? "ok" : "FAILED"} ${seconds}s\n`);

      if (failed !== null) process.stderr.write(`${failed}\n`);
    }
  }
}

function runOnce(mode: Mode, scenario: Scenario, name: string): string | null {
  const out = join(values.out, `${name}.json`);
  const profiles = join(values.out, `${name}.prof`);
  const profiled = PROFILED.includes(mode);

  if (profiled) mkdirSync(profiles, { recursive: true });

  const inprocess = [
    ...(profiled
      ? ["--cpu-prof", `--cpu-prof-dir=${profiles}`, `--cpu-prof-interval=${INTERVAL_US}`]
      : []),
    "--preload",
    "@opentui/solid/preload",
    "bench/replay/inprocess.tsx",
    scenario,
  ];

  const args =
    mode === "inprocess" || mode === "inprocess-prof"
      ? inprocess
      : ["bench/replay/pty-nyte.ts", mode === "binary" ? "binary" : "source", scenario];

  const result = spawnSync(process.execPath, args, {
    cwd: tui,
    encoding: "utf8",
    timeout: 300_000,
    env: {
      ...process.env,
      BENCH_OUT: out,
      NYTE_BINARY: values.binary,
      ...(mode === "source-prof" ? { BENCH_CPU_PROF_DIR: profiles } : {}),
    },
  });

  if (profiled) keepOneProfile(profiles, join(values.out, `${name}.cpuprofile`));

  return result.status === 0 ? null : result.stderr.slice(-3_000);
}

function keepOneProfile(directory: string, to: string): void {
  const first = readdirSync(directory).find((file) => file.endsWith(".cpuprofile"));

  if (first !== undefined) renameSync(join(directory, first), to);
  rmSync(directory, { recursive: true, force: true });
}
