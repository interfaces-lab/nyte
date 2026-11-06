import { readFile } from "node:fs/promises";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const Row = Type.Object({
  model: Type.String(),
  case: Type.String(),
  pass: Type.Union([Type.Boolean(), Type.Null()]),
  cost: Type.Number(),
  trace: Type.Union([
    Type.Null(),
    Type.Object({ calls: Type.Array(Type.Object({ outcome: Type.String() })) }),
  ]),
});

type Row = Static<typeof Row>;

const [base, candidate] = process.argv.slice(2);

if (base === undefined || candidate === undefined) {
  process.stderr.write(
    "Usage: pnpm --dir packages/nyte-bench compare <baseline results.jsonl> <candidate results.jsonl>\n",
  );
  process.exit(1);
}

const before = await readRows(base);
const after = await readRows(candidate);
const models = [...new Set([...before, ...after].map((row) => row.model))];
const cases = [...new Set([...before, ...after].map((row) => row.case))];

const score = (rows: readonly Row[], model: string, id?: string) => {
  const graded = rows.filter(
    (row) => row.model === model && row.pass !== null && (id === undefined || row.case === id),
  );

  const calls = graded.flatMap((row) => row.trace?.calls ?? []);

  return {
    passed: `${graded.filter((row) => row.pass === true).length}/${graded.length}`,
    calls: `${calls.filter((call) => call.outcome === "ok").length}/${calls.length}`,
    cost: rows.filter((row) => row.model === model).reduce((sum, row) => sum + row.cost, 0),
  };
};

process.stdout.write(
  [
    "# Nyte Bench: baseline → candidate",
    "",
    "| Model | Samples passed | Calls ok | Cost |",
    "| --- | --- | --- | --- |",
    ...models.map((model) => {
      const was = score(before, model);
      const now = score(after, model);

      return `| ${model} | ${was.passed} → ${now.passed} | ${was.calls} → ${now.calls} | $${was.cost.toFixed(2)} → $${now.cost.toFixed(2)} |`;
    }),
    "",
    `| Case | ${models.map((model) => model.slice(model.indexOf("/") + 1)).join(" | ")} |`,
    `| --- | ${models.map(() => "---").join(" | ")} |`,
    ...cases.map(
      (id) =>
        `| ${id} | ${models.map((model) => `${score(before, model, id).passed} → ${score(after, model, id).passed}`).join(" | ")} |`,
    ),
    "",
  ].join("\n"),
);

async function readRows(path: string): Promise<readonly Row[]> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.trim() !== "");

  return lines.map((line, index) => {
    const parsed: unknown = JSON.parse(line);

    if (!Value.Check(Row, parsed)) throw new Error(`${path}:${index + 1} is not a Nyte Bench row.`);

    return parsed;
  });
}
