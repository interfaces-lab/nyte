#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TLA_TS = "tla-ts@0.0.6";
const SYNC_COMMIT = "d142cf6dd8cbddcda21866cd2a795dd33abdb475";
const COVERED_FILES = [
  "packages/core/src/compose.ts",
  "packages/core/src/contract/presence.ts",
  "packages/core/src/engine/presence.ts",
  "packages/core/src/drive/execution.ts",
  "packages/core/src/fold/commit.ts",
  "packages/core/src/store/log.ts",
  "packages/core/src/store/refs.ts",
  "packages/host/src/sqlite.ts",
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

function check(label, appendFence, deleteProcess, expectCounterexample) {
  console.log(
    `\n${label}: AppendProcessFence=${appendFence}, DeleteProcessOnClaim=${deleteProcess}`,
  );
  const work = mkdtempSync(join(tmpdir(), "nyte-takeover-fence-"));
  try {
    copyFileSync(join(here, "TakeoverFence.tla"), join(work, "TakeoverFence.tla"));
    writeFileSync(
      join(work, "TakeoverFence.cfg"),
      [
        "INIT Init",
        "NEXT Next",
        "INVARIANT NoStalePublication",
        "CHECK_DEADLOCK FALSE",
        "CONSTANTS",
        `  AppendProcessFence = ${String(appendFence).toUpperCase()}`,
        `  DeleteProcessOnClaim = ${String(deleteProcess).toUpperCase()}`,
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
    const violated = output.includes("Invariant NoStalePublication is violated");
    const passed = output.includes("Model checking completed. No error has been found.");
    const states = output.match(/^\d+ states generated.*$/m)?.[0] ?? "";
    if (!violated && !passed) {
      console.log(output);
      console.error(`ERROR: ${label} did not complete a valid check.`);
      return 2;
    }
    if (expectCounterexample && !violated) {
      console.log(
        `FAIL: ${label} survived; the model self-test no longer detects this design defect.`,
      );
      return 1;
    }
    if (!expectCounterexample && violated) {
      console.log(output);
      console.log("FAIL: baseline design violates NoStalePublication. Inspect the counterexample.");
      return 1;
    }
    console.log(states);
    console.log(
      `PASS: ${label} ${violated ? "produced the expected model counterexample." : "satisfies the bounded design property."}`,
    );
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const started = performance.now();
reviewNotice();
const results = [
  check("baseline", true, true, false),
  check("missing publication fence mutant", false, true, true),
  check("missing process revocation mutant", true, false, true),
];
console.log(`\nElapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(Math.max(...results));
