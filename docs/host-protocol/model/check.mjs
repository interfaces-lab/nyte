#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TLA_TS = "tla-ts@0.0.6";
const PARAMETERS = ["SubscribeBeforeRead", "ApplyEarlyEvents", "ResumeSendsUnheld"];
const here = new URL(".", import.meta.url).pathname;

function check(label, parameters, expectCounterexample) {
  const settings = Object.entries(parameters)
    .map(([name, value]) => `${name}=${String(value).toUpperCase()}`)
    .join(", ");
  console.log(`\n${label}: ${settings}`);
  const work = mkdtempSync(join(tmpdir(), "nyte-attach-resume-"));
  try {
    copyFileSync(join(here, "AttachResume.tla"), join(work, "AttachResume.tla"));
    const config = [
      "INIT Init",
      "NEXT Next",
      "INVARIANT Synced",
      "CHECK_DEADLOCK FALSE",
      "CONSTANTS",
      "  Rows = {a, b}",
      "  MaxSeq = 4",
      ...Object.entries(parameters).map(
        ([name, value]) => `  ${name} = ${String(value).toUpperCase()}`,
      ),
      "",
    ].join("\n");
    writeFileSync(join(work, "AttachResume.cfg"), config);
    const result = spawnSync(
      "pnpm",
      ["dlx", TLA_TS, "AttachResume.cfg", "-workers", "auto", "-seed", "1"],
      {
        cwd: work,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    const violated = output.includes("Invariant Synced is violated");
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
      console.log("FAIL: the design violates Synced. Inspect the counterexample.");
      return 1;
    }
    console.log(states);
    console.log(
      `PASS: ${label} ${violated ? "produced the expected counterexample." : "satisfies the bounded design property."}`,
    );
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const started = performance.now();
const baseline = Object.fromEntries(PARAMETERS.map((name) => [name, true]));
const results = [check("baseline", baseline, false)];
for (const name of PARAMETERS)
  results.push(check(`${name} off`, { ...baseline, [name]: false }, true));
console.log(`\nElapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(Math.max(...results));
