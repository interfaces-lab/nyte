import type { Call } from "./grade.ts";
import type { Row } from "./sample.ts";
import { SUITES } from "./suites.ts";

/** One line of progress for a finished sample. */
export function describeRow(row: Row): string {
  const mark = row.pass === null ? "!" : row.pass ? "✓" : "✗";
  const failed = row.checks.filter((check) => !check.pass).map((check) => check.name);

  const note =
    row.error === null
      ? failed.length === 0
        ? ""
        : ` — ${failed.join("; ")}`
      : ` — ${row.error.split("\n")[0] ?? ""}`;

  return `${mark} ${row.model} ${row.case} #${row.sample} (${(row.ms / 1000).toFixed(1)}s, $${row.cost.toFixed(4)}${row.timedOut ? ", timed out" : ""})${note}`;
}

/** The run's report as Markdown: the leaderboard, each suite's cases, every tool's success rate and the calls that failed. */
export function summarize(all: readonly Row[]): string {
  const models = [...new Set(all.map((row) => row.model))];
  const graded = all.filter((row) => row.pass !== null);

  const header = (first: readonly string[]) => [
    `| ${[...first, ...models.map(shortName)].join(" | ")} |`,
    `| ${[...first, ...models].map(() => "---").join(" | ")} |`,
  ];

  const leaderboard = models
    .map((model) => {
      const runs = graded.filter((row) => row.model === model);
      const passed = runs.filter((row) => row.pass === true).length;
      const calls = runs.flatMap((row) => row.trace?.calls ?? []);
      const cost = all.filter((row) => row.model === model).reduce((sum, row) => sum + row.cost, 0);

      return { model, passed, runs: runs.length, calls, cost };
    })
    .toSorted((left, right) => right.passed / (right.runs || 1) - left.passed / (left.runs || 1));

  const suites = SUITES.filter((suite) => all.some((row) => row.suite === suite.id)).flatMap(
    (suite) => [
      `## ${suite.title}`,
      "",
      ...header(["Case", "Kind"]),
      ...suite.cases
        .filter((entry) => all.some((row) => row.case === entry.id))
        .map((entry) => {
          const cells = models.map((model) => {
            const runs = graded.filter((row) => row.case === entry.id && row.model === model);

            return `${runs.filter((row) => row.pass === true).length}/${runs.length}`;
          });

          return `| ${entry.id} | ${entry.kind} | ${cells.join(" | ")} |`;
        }),
      "",
    ],
  );

  const callsBy = (model: string): readonly Call[] =>
    graded.filter((row) => row.model === model).flatMap((row) => row.trace?.calls ?? []);

  const tools = [
    ...new Set(graded.flatMap((row) => (row.trace?.calls ?? []).map((call) => call.tool))),
  ].toSorted();

  const failures = graded.flatMap((row) =>
    (row.trace?.calls ?? []).flatMap((call) =>
      call.outcome === "ok"
        ? []
        : [
            `- ${row.model} ${row.case} #${row.sample}, ${call.by}: \`${call.tool}\` ${call.outcome}${call.message === null ? "" : `: ${call.message.split("\n")[0] ?? ""}`}`,
          ],
    ),
  );

  const errors = all.flatMap((row) =>
    row.error === null
      ? []
      : [`- ${row.model} ${row.case} #${row.sample}: ${row.error.split("\n")[0] ?? ""}`],
  );

  return [
    "# Nyte Bench",
    "",
    "| Model | Samples passed | Calls ok | Cost |",
    "| --- | --- | --- | --- |",
    ...leaderboard.map(
      (entry) =>
        `| ${entry.model} | ${percent(entry.passed, entry.runs)} (${entry.passed}/${entry.runs}) | ${rate(entry.calls)} | $${entry.cost.toFixed(2)} |`,
    ),
    "",
    ...suites,
    "## Tool-call success rate",
    "",
    "Calls that ended ok over all calls, by the chat and its subagents. A codemode script's calls count as calls of their own too.",
    "",
    ...header(["Tool"]),
    ...tools.map((name) => {
      const cells = models.map((model) => {
        const made = callsBy(model).filter((call) => call.tool === name);

        return made.length === 0 ? "–" : rate(made);
      });

      return `| ${name} | ${cells.join(" | ")} |`;
    }),
    "",
    "## Calls that did not end ok",
    "",
    ...(failures.length === 0 ? ["None."] : failures),
    "",
    ...(errors.length === 0 ? [] : ["## Samples that errored", "", ...errors, ""]),
  ].join("\n");
}

function shortName(model: string): string {
  return model.slice(model.indexOf("/") + 1);
}

function rate(calls: readonly Call[]): string {
  const ok = calls.filter((call) => call.outcome === "ok").length;

  return `${percent(ok, calls.length)} (${ok}/${calls.length})`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
}
