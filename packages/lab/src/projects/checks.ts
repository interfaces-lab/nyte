import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { EvidenceType } from "./evidence.ts";
import type { CheckResult, Trace } from "./evidence.ts";
import { NEVER_LOSE_WORK, ONE_OWNER, SCHEMA } from "./sql.ts";
import { TARGETS } from "./targets.ts";
import { deriveView } from "./view.ts";
import { scenarios } from "./world.ts";
import type { Scenario, Step } from "./world.ts";

const RESEARCH = process.argv[3] ?? join(import.meta.dirname, "../../research_notes/projects");

const DIRECTORY = process.argv[2] ?? join(RESEARCH, "export");

const evidence: unknown = JSON.parse(readFileSync(join(DIRECTORY, "evidence.json"), "utf8"));

if (!Value.Check(EvidenceType, evidence))
  throw new Error(
    `${join(DIRECTORY, "evidence.json")} is not an export this lab reads; run export.ts again`,
  );

const all = scenarios(evidence);

function scenario(id: Scenario["id"]): Scenario {
  const found = all.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`No ${id} scenario`);

  return found;
}

function step(from: Scenario, id: string): Step {
  const found = from.steps.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`No ${id} step in ${from.id}`);

  return found;
}

const db = new DatabaseSync(":memory:");

db.exec(SCHEMA);

const insertCall = db.prepare("insert into calls values (?, ?, ?, ?, ?, ?, ?)");

const insertLease = db.prepare("insert into leases values (?, ?, ?, ?, ?, ?)");

const insertKept = db.prepare("insert into kept values (?, ?, ?)");

const insertDispatch = db.prepare("insert into dispatches values (?, ?, ?, ?, ?)");

for (const current of all)
  for (const entry of current.steps) {
    for (const call of entry.world.calls)
      insertCall.run(
        current.id,
        entry.id,
        call.session,
        call.checkout,
        call.at,
        call.changed ? 1 : 0,
        call.snapshot,
      );

    for (const lease of entry.world.leases)
      insertLease.run(
        current.id,
        entry.id,
        lease.checkout,
        lease.session,
        lease.since,
        lease.until,
      );

    for (const tree of entry.world.kept) insertKept.run(current.id, entry.id, tree);
  }

for (const current of all) {
  const last = current.steps.at(-1);

  for (const dispatch of last?.world.dispatches ?? [])
    insertDispatch.run(
      current.id,
      last?.id ?? "",
      dispatch.key,
      dispatch.owner,
      dispatch.decision.kind,
    );
}

const Violation = Type.Object({
  scenario: Type.String(),
  step: Type.String(),
  session: Type.String(),
});

const violations = db
  .prepare(NEVER_LOSE_WORK)
  .all()
  .filter((row) => Value.Check(Violation, row));

const owners = db.prepare(ONE_OWNER).all();

const control = new DatabaseSync(":memory:");

control.exec(SCHEMA);

control
  .prepare("insert into dispatches values (?, ?, ?, ?, ?)")
  .run("control", "cursor", "pr#19:check-failed:a11ef16:CI/verify", "babysitter-19", "wake");

control
  .prepare("insert into dispatches values (?, ?, ?, ?, ?)")
  .run("control", "cursor", "pr#19:check-failed:a11ef16:CI/verify", "coordinator", "wake");

const controlCaught = control.prepare(ONE_OWNER).all().length === 1;

const stack = scenario("stack");

const tick1 = step(stack, "tick-1").plan;

const tick2 = step(stack, "tick-2").plan;

const routed = tick1?.dispatches.filter((dispatch) => dispatch.decision.kind === "route") ?? [];

const perPull =
  tick1?.dispatches.filter(
    (dispatch) =>
      dispatch.event.pull !== null &&
      (dispatch.decision.kind === "wake" || dispatch.decision.kind === "remedy"),
  ) ?? [];

const keeperFixes =
  tick1?.dispatches.filter(
    (dispatch) =>
      dispatch.event.pull === null &&
      (dispatch.decision.kind === "remedy" || dispatch.decision.kind === "wake"),
  ) ?? [];

const restored = evidence.incident.restored;

const queries = restored.find((file) => file.path.endsWith("app/src/queries.ts"));

const identical = restored.filter((file) => file.differingLines === 0);

const cap = 2;

const fixes = evidence.ciFixes.map((fix) => fix.atSolUsd).toSorted((left, right) => left - right);

const median =
  fixes.length === 0
    ? 0
    : ((fixes[Math.floor((fixes.length - 1) / 2)] ?? 0) +
        (fixes[Math.ceil((fixes.length - 1) / 2)] ?? 0)) /
      2;

const under = fixes.filter((cost) => cost <= cap).length;

const onSol = evidence.ciFixes.filter((fix) => fix.model.startsWith("openai-codex/"));

const sessions = new Set(evidence.sessions.map((session) => session.id));

const numbers = new Set(evidence.pullRequests.map((pull) => pull.number));

const paths = new Set(evidence.worktrees.map((tree) => tree.path));

const traced = (trace: Trace): boolean =>
  trace.kind === "session"
    ? sessions.has(trace.id)
    : trace.kind === "pull-request"
      ? numbers.has(trace.number)
      : paths.has(trace.path);

const rows = all.flatMap((current) =>
  current.steps.flatMap((entry) =>
    deriveView(entry.world, evidence.checkout.folder).map((row) => ({
      scenario: current.id,
      step: entry.id,
      row,
    })),
  ),
);

const untraced = rows.filter(
  (entry) => entry.row.trace.length === 0 || !entry.row.trace.every(traced),
);

const missingTargets = evidence.baselines.filter((baseline) => TARGETS[baseline.id] === undefined);

function readDocument(name: string): string {
  const path = join(RESEARCH, name);

  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const verdicts = readDocument("verdicts.md");

const questionRows = verdicts.split("\n").filter((line) => /^\| \d+ \|/.test(line));

const ideaRows =
  verdicts
    .split("## Ideas in the original brief")[1]
    ?.split("\n")
    .filter(
      (line) => line.startsWith("| ") && !line.startsWith("| Idea") && !line.startsWith("|---"),
    ) ?? [];

const VERDICT = /\| (adopted|changed|rejected|deferred|rejected \(for now\)) \|/;

const unjudged = [...questionRows, ...ideaRows].filter((line) => !VERDICT.test(line));

const comparison = readDocument("comparison.md");

const tableRows = comparison
  .split("\n")
  .filter(
    (line) =>
      line.startsWith("| ") &&
      !line.startsWith("| Product") &&
      !line.startsWith("| #") &&
      !/^\|[-\s|]+\|$/.test(line),
  );

const failureSection = comparison.split("## User-reported failures")[1]?.split("\n## ")[0] ?? "";

const PRODUCTS = [
  "Cursor",
  "T3 Code",
  "Linear",
  "Copilot",
  "Codex",
  "Claude Code",
  "Devin",
  "Factory",
  "CodeRabbit",
  "Graphite",
  "Rakazo",
  "Grok Bot",
  "Dots",
  "Muse",
  "OpenClaw",
  "Hermes",
  "Instinct",
];

const productsWithoutFailure = PRODUCTS.filter(
  (product) => !failureSection.includes(`| ${product}`),
);

const FAILURE_VERDICT = /\*\*(impossible by design|handled|out of scope)\*\*/;

const failureRows = failureSection.split("\n").filter((line) => /^\| \d+ \|/.test(line));

const failuresUnjudged = failureRows.filter((line) => !FAILURE_VERDICT.test(line));

const unsourced = tableRows.filter((line) => {
  const cells = line.split("|").map((cell) => cell.trim());

  return (
    cells.length > 5 &&
    !line.startsWith("| Nyte") &&
    /^\| [A-Z]/.test(line) &&
    !/^\| \d+ \|/.test(line) &&
    (cells[4] ?? "") === ""
  );
});

const results: readonly CheckResult[] = [
  {
    id: "verdicts",
    title: "Every question and every idea in the brief has a verdict",
    pass: questionRows.length === 19 && ideaRows.length > 0 && unjudged.length === 0,
    detail: `${String(questionRows.length)} of 19 questions and ${String(ideaRows.length)} ideas in verdicts.md; ${String(unjudged.length)} without a verdict.`,
    sql: null,
  },
  {
    id: "comparison",
    title: "Every comparison cell has a source; every product has a judged failure",
    pass:
      comparison !== "" &&
      unsourced.length === 0 &&
      productsWithoutFailure.length === 0 &&
      failuresUnjudged.length === 0,
    detail:
      comparison === ""
        ? "comparison.md is not written yet."
        : `${String(tableRows.length)} rows; ${String(unsourced.length)} unsourced; products without a failure: ${productsWithoutFailure.join(", ") || "none"}; ${String(failureRows.length)} failures, ${String(failuresUnjudged.length)} without a verdict.`,
    sql: null,
  },
  {
    id: "traces",
    title: "Every row on the page traces to a session, pull request or worktree in the export",
    pass: untraced.length === 0,
    detail: `${String(rows.length)} rows across ${String(all.reduce((sum, current) => sum + current.steps.length, 0))} steps; ${String(untraced.length)} without a trace${untraced[0] === undefined ? "" : `, first ${untraced[0].scenario}/${untraced[0].step}/${untraced[0].row.id}`}.`,
    sql: null,
  },
  {
    id: "targets",
    title: "Every baseline has a target for one week in the lane",
    pass: missingTargets.length === 0,
    detail: `${String(evidence.baselines.length)} baselines from the store, GitHub and disk; ${String(missingTargets.length)} without a target.`,
    sql: null,
  },
  {
    id: "restore",
    title: "The restore dry run rebuilds the five wiped files and matches the hand rebuild",
    pass:
      restored.length === 5 &&
      identical.length === 4 &&
      queries?.differingLines === 18 &&
      queries.laterEdit !== null,
    detail: `${String(identical.length)} of ${String(restored.length)} files from ${evidence.incident.before} equal today's tree; queries.ts differs by ${String(queries?.differingLines ?? 0)} lines, which ${queries?.laterEdit === null || queries?.laterEdit === undefined ? "nothing explains" : `are chat ${queries.laterEdit.session.slice(0, 8)}'s edit at ${new Date(queries.laterEdit.at).toISOString().slice(11, 19)} UTC (−${String(queries.laterEdit.removed)} +${String(queries.laterEdit.added)}), applied to the rebuilt file to give today's exactly`}. Files are in ${evidence.incident.restoreDirectory}.`,
    sql: null,
  },
  {
    id: "replay",
    title:
      "Replayed on the red stack: one fix on main, no per-PR copies, no model run while nothing changes",
    pass:
      tick1 !== null &&
      tick2 !== null &&
      keeperFixes.length === 1 &&
      perPull.length === 0 &&
      tick1.runs === 0 &&
      tick2.dispatches.length === 0 &&
      tick2.runs === 0,
    detail: `First tick: ${String(tick1?.dispatches.length ?? 0)} dispatches. ${String(routed.length)} failures route to main's keeper under ${String(tick1?.baseFixes.length ?? 0)} causes (${tick1?.baseFixes.join("; ") ?? "?"}); the keeper acts once per cause: ${String(keeperFixes.length)} fix (${keeperFixes.map((dispatch) => (dispatch.decision.kind === "remedy" ? dispatch.decision.command : dispatch.decision.kind)).join(", ")}) and ${String(tick1?.asks ?? 0)} question. Per-PR fixes: ${String(perPull.length)}. Model runs: ${String(tick1?.runs ?? 0)}. Unchanged second tick: ${String(tick2?.dispatches.length ?? 0)} dispatches, ${String(tick2?.runs ?? 0)} model runs.`,
    sql: null,
  },
  {
    id: "one-owner",
    title: "One owner per trigger event (SQL over the designed dispatch records)",
    pass: owners.length === 0 && controlCaught,
    detail: `${String(owners.length)} events with more or fewer than one dispatch or owner across ${String(all.length)} scenarios; the control with two owners for one event is ${controlCaught ? "caught" : "missed"}.`,
    sql: ONE_OWNER,
  },
  {
    id: "never-lose-work",
    title: "Never lose work (SQL over calls, writer leases and kept snapshots)",
    pass:
      violations.some((row) => row.scenario === "incident" && row.step === "wipe") &&
      !violations.some(
        (row) =>
          row.scenario === "incident" && (row.step === "in-a-lane" || row.step === "restore"),
      ),
    detail: `Violations: ${violations.map((row) => `${row.scenario}/${row.step} ${row.session.slice(0, 8)}`).join(", ") || "none"}. The wipe in the shared checkout breaks the rule; the same call in the chat's own worktree does not.`,
    sql: NEVER_LOSE_WORK,
  },
  {
    id: "cost",
    title: `A babysat PR on the worker model stays under the $${cap.toFixed(2)} cap set in advance`,
    pass: median <= cap && onSol.every((fix) => fix.recordedUsd <= cap),
    detail: `One fix run, from ${String(fixes.length)} past CI-fixing chats re-priced at Sol's list prices: median $${median.toFixed(2)}, ${String(under)} of ${String(fixes.length)} at or under the cap; the ${String(onSol.length)} that ran on Sol cost ${onSol.map((fix) => `$${fix.recordedUsd.toFixed(2)}`).join(" and ")}. A PR that needs more stops and asks. The red stack needs none: every failure is main's, and main's fix is a command.`,
    sql: null,
  },
];

writeFileSync(join(DIRECTORY, "checks.json"), `${JSON.stringify(results, null, 2)}\n`);

for (const result of results)
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.title}\n      ${result.detail}`);
