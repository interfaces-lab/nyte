#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TLA_TS = "tla-ts@0.0.6";
const SYNC_COMMIT = "8340c40561f0b02dca04da49b8fb40e7f93e5693";
const COVERED_FILES = [
  "packages/core/src/compose.ts",
  "packages/core/src/contract/presence.ts",
  "packages/core/src/engine/presence.ts",
  "packages/core/src/drive/execution.ts",
  "packages/core/src/watch/commit.ts",
  "packages/core/src/store/log.ts",
  "packages/core/src/store/refs.ts",
  "packages/host/src/store/sqlite.ts",
  "packages/host/src/local/process/machine.ts",
];
const here = new URL(".", import.meta.url).pathname;
const root = resolve(here, "../../..");

function reviewNotice() {
  const args = ["log", "--oneline", `${SYNC_COMMIT}..HEAD`, "--", ...COVERED_FILES];
  console.log("Coverage review notice, not a gate:");
  console.log(`git ${args.join(" ")}`);
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000 });
  if (result.status === 0)
    console.log(result.stdout || "No committed changes in the covered files.");
  else console.log(`History unavailable: ${result.stderr?.trim() ?? result.error?.message ?? ""}`);
  console.log(
    "Also review uncommitted changes. Neither this notice nor TLC reads TypeScript semantics.",
  );
}

function check(label, constants, invariants, violates) {
  const settings = Object.entries(constants).map(([name, value]) => `${name}=${value}`);
  console.log(`\n${label}: ${settings.join(", ")}; ${invariants.join(", ")}`);
  const work = mkdtempSync(join(tmpdir(), "nyte-takeover-fence-"));
  try {
    copyFileSync(join(here, "TakeoverFence.tla"), join(work, "TakeoverFence.tla"));
    writeFileSync(
      join(work, "TakeoverFence.cfg"),
      [
        "INIT Init",
        "NEXT Next",
        ...invariants.map((invariant) => `INVARIANT ${invariant}`),
        "CHECK_DEADLOCK FALSE",
        "CONSTANTS",
        ...Object.entries(constants).map(
          ([name, value]) => `  ${name} = ${String(value).toUpperCase()}`,
        ),
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      "pnpm",
      ["dlx", TLA_TS, "TakeoverFence.cfg", "-workers", "auto", "-seed", "1"],
      {
        cwd: work,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    const violated = invariants.find((invariant) =>
      output.includes(`Invariant ${invariant} is violated`),
    );
    const passed = output.includes("Model checking completed. No error has been found.");
    const states = output.match(/^\d+ states generated.*$/m)?.[0] ?? "";
    if (violated === undefined && !passed) {
      console.log(output);
      console.error(`ERROR: ${label} did not complete a valid check.`);
      return 2;
    }
    if (violates !== null && violated !== violates) {
      console.log(output);
      console.log(
        `FAIL: ${label} did not violate ${violates}; the model self-test no longer detects this design defect.`,
      );
      return 1;
    }
    if (violates === null && violated !== undefined) {
      console.log(output);
      console.log(`FAIL: ${label} violates ${violated}. Inspect the counterexample.`);
      return 1;
    }
    console.log(states);
    console.log(
      `PASS: ${label} ${violated === undefined ? "satisfies the bounded design properties." : `produced the expected ${violated} counterexample.`}`,
    );
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const BASELINE = { AppendProcessFence: true, DeleteProcessOnClaim: true, PidCheckSeesExit: true };

const BOTH = ["NoStalePublication", "NoLiveExitTakeover"];

const started = performance.now();
reviewNotice();
const results = [
  check("baseline", BASELINE, BOTH, null),
  check(
    "missing publication fence mutant",
    { ...BASELINE, AppendProcessFence: false },
    BOTH,
    "NoStalePublication",
  ),
  check(
    "missing process revocation mutant",
    { ...BASELINE, DeleteProcessOnClaim: false },
    BOTH,
    "NoStalePublication",
  ),
  check(
    "pid check that calls a running process gone mutant",
    { ...BASELINE, PidCheckSeesExit: false },
    BOTH,
    "NoLiveExitTakeover",
  ),
  check(
    "fence under that wrong verdict",
    { ...BASELINE, PidCheckSeesExit: false },
    ["NoStalePublication"],
    null,
  ),
];
console.log(`\nElapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(Math.max(...results));
