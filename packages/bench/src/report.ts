import { readFile, writeFile } from "node:fs/promises";
import type { ScenarioResult } from "./scenario.ts";

type Budgets = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** A metric passes when it is on the right side of its budget: `*Min` must be ≥, everything else ≤. */
function withinBudget(name: string, value: number, budget: number): boolean {
  return name.endsWith("Min") ? value >= budget : value <= budget;
}

export async function report(results: readonly ScenarioResult[], budgetsPath: string, outPath: string): Promise<boolean> {
  const budgets: Budgets = JSON.parse(await readFile(budgetsPath, "utf8"));
  let ok = true;
  const lines: string[] = [];

  for (const result of results) {
    const scenarioBudgets = budgets[result.name] ?? {};
    for (const check of result.invariants) {
      ok &&= check.held;
      lines.push(`${check.held ? "ok  " : "FAIL"} ${result.name}: ${check.name}${check.detail === undefined ? "" : ` (${check.detail})`}`);
    }
    for (const [metric, value] of Object.entries(result.metrics)) {
      const budget = scenarioBudgets[metric];
      if (budget === undefined) {
        lines.push(`     ${result.name}.${metric} = ${value.toFixed(3)}`);
        continue;
      }
      const pass = withinBudget(metric, value, budget);
      ok &&= pass;
      lines.push(`${pass ? "ok  " : "SLOW"} ${result.name}.${metric} = ${value.toFixed(3)} (budget ${name_(metric)} ${budget})`);
    }
  }

  await writeFile(outPath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.stdout.write(`${lines.join("\n")}\n\n${ok ? "all guarantees held" : "guarantees broken"}; results in ${outPath}\n`);

  return ok;
}

function name_(metric: string): string {
  return metric.endsWith("Min") ? "≥" : "≤";
}
