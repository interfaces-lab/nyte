import { addUsage } from "@nyte-ai/core";
import type { Usage } from "@nyte-ai/schema";
import type { Usage as ModelUsageCounts } from "@nyte-ai/schema/model";
import type { ModelUsage, UsageSummary } from "./usage-types.ts";

export function emptyModelUsage(): ModelUsageCounts {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function recordedUsage(usage: ModelUsageCounts): Usage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning ?? null,
    total: usage.totalTokens,
    cost: { ...usage.cost },
  };
}

export function emptyUsageSummary(): UsageSummary {
  return {
    models: [],
    compaction: recordedUsage(emptyModelUsage()),
    tools: recordedUsage(emptyModelUsage()),
    total: recordedUsage(emptyModelUsage()),
    cacheSavings: 0,
  };
}

export function summarizeModels(rows: readonly ModelUsage[]): UsageSummary {
  const models = new Map<string, ModelUsage>();
  let total = recordedUsage(emptyModelUsage());
  let savings = 0;

  for (const row of rows) {
    savings += cacheSavings(row.usage);
    const key = JSON.stringify([row.provider, row.model]);
    const previous = models.get(key);
    models.set(
      key,
      previous === undefined
        ? row
        : { ...row, turns: previous.turns + row.turns, usage: addUsage(previous.usage, row.usage) },
    );
    total = addUsage(total, row.usage);
  }

  return {
    ...emptyUsageSummary(),
    models: [...models.values()].toSorted(
      (left, right) =>
        right.usage.cost.total - left.usage.cost.total ||
        right.usage.total - left.usage.total ||
        left.model.localeCompare(right.model) ||
        left.provider.localeCompare(right.provider),
    ),
    total,
    cacheSavings: savings,
  };
}

export function cacheSavings(usage: Usage): number {
  if (usage.input === 0) return 0;

  return usage.cacheRead * (usage.cost.input / usage.input) - usage.cost.cacheRead;
}

export function usageTokens(usage: Usage): number {
  return usage.total || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
