#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TLA_TS = "tla-ts@0.0.6";
const here = new URL(".", import.meta.url).pathname;

function check(module, label, constants, invariants, violates) {
  const settings = Object.entries(constants).map(([name, value]) => `${name}=${value}`);
  console.log(`\n${module}, ${label}: ${settings.join(", ")}; ${invariants.join(", ")}`);
  const work = mkdtempSync(join(tmpdir(), `nyte-${module}-`));

  try {
    copyFileSync(join(here, `${module}.tla`), join(work, `${module}.tla`));
    writeFileSync(
      join(work, `${module}.cfg`),
      [
        "INIT Init",
        "NEXT Next",
        ...invariants.map((invariant) => `INVARIANT ${invariant}`),
        "CHECK_DEADLOCK FALSE",
        "CONSTANTS",
        ...Object.entries(constants).map(
          ([name, value]) =>
            `  ${name} = ${typeof value === "boolean" ? String(value).toUpperCase() : value}`,
        ),
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      "pnpm",
      ["dlx", TLA_TS, `${module}.cfg`, "-workers", "auto", "-seed", "1"],
      {
        cwd: work,
        encoding: "utf8",
        timeout: 180_000,
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

    if (violated !== violates) {
      console.log(output);
      console.log(
        `FAIL: expected ${violates ?? "no violation"}, got ${violated ?? "no violation"}.`,
      );

      return 1;
    }

    console.log(states);
    console.log(
      `PASS: ${violated === undefined ? "the bounded properties hold." : `produced the expected ${violated} counterexample.`}`,
    );

    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const ROWS = { HideDrafted: true, KeepDraftWhileStarting: true };
const ROW_INVARIANTS = ["TypeOK", "NoDoubleRow", "NoVanishedChat"];
const BATCH = { ByMicrotask: true, ClearBeforePresent: true, MaxChanges: 4 };

const results = [
  check("DraftRows", "the design", ROWS, ROW_INVARIANTS, undefined),
  check(
    "DraftRows",
    "host row shown beside the draft",
    { ...ROWS, HideDrafted: false },
    ROW_INVARIANTS,
    "NoDoubleRow",
  ),
  check(
    "DraftRows",
    "draft row dropped while starting",
    { ...ROWS, KeepDraftWhileStarting: false },
    ROW_INVARIANTS,
    "NoVanishedChat",
  ),
  check("PresentBatch", "the design", BATCH, ["PaintsPresented"], undefined),
  check(
    "PresentBatch",
    "present deferred to the next frame",
    { ...BATCH, ByMicrotask: false },
    ["PaintsPresented"],
    "PaintsPresented",
  ),
  check(
    "PresentBatch",
    "queue cleared after present",
    { ...BATCH, ClearBeforePresent: false },
    ["PaintsPresented"],
    "PaintsPresented",
  ),
];

process.exit(Math.max(...results));
