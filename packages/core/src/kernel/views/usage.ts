/** Usage totals folded from immutable commits. */
import type { Usage } from "@nyte-ai/schema";
import type { Commit } from "../model.ts";

export interface ModelUsage {
  readonly model: string;
  /** Assistant messages folded into this row. */
  readonly turns: number;
  readonly usage: Usage;
}

export interface UsageSummary {
  /** Highest cost first, then most tokens, then model id. */
  readonly models: readonly ModelUsage[];
  /** Checkpoint and branch-summary spend, which has no model id. */
  readonly compaction: Usage;
  /** Usage reported by tool executions. */
  readonly tools: Usage;
  readonly total: Usage;
}

/**
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/utils/usage.ts
 * Synced with pi d4edf066f.
 */
function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addUsage(left: Usage, right: Usage): Usage {
  let total: Usage = {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
  if (left.cacheWrite1h !== undefined || right.cacheWrite1h !== undefined) {
    total = { ...total, cacheWrite1h: (left.cacheWrite1h ?? 0) + (right.cacheWrite1h ?? 0) };
  }
  if (left.reasoning !== undefined || right.reasoning !== undefined) {
    total = { ...total, reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0) };
  }
  return total;
}

export function emptyUsageSummary(): UsageSummary {
  return { models: [], compaction: emptyUsage(), tools: emptyUsage(), total: emptyUsage() };
}

function sortModels(models: ReadonlyMap<string, { turns: number; usage: Usage }>): ModelUsage[] {
  return [...models]
    .map(([model, { turns, usage }]) => ({ model, turns, usage }))
    .toSorted(
      (left, right) =>
        right.usage.cost.total - left.usage.cost.total ||
        right.usage.totalTokens - left.usage.totalTokens ||
        left.model.localeCompare(right.model),
    );
}

function summarize(
  models: ReadonlyMap<string, { turns: number; usage: Usage }>,
  compaction: Usage,
  tools: Usage,
): UsageSummary {
  const sorted = sortModels(models);
  const total = [...sorted.map((row) => row.usage), compaction, tools].reduce(
    addUsage,
    emptyUsage(),
  );
  return { models: sorted, compaction, tools, total };
}

/** Fold every supplied commit, including commits on abandoned branches. */
export function projectUsage(commits: readonly Commit[]): UsageSummary {
  const models = new Map<string, { turns: number; usage: Usage }>();
  let compaction = emptyUsage();
  let tools = emptyUsage();

  for (const commit of commits) {
    const body = commit.body;
    switch (body.kind) {
      case "message":
        switch (body.message.role) {
          case "assistant": {
            const bucket = models.get(body.message.model) ?? { turns: 0, usage: emptyUsage() };
            models.set(body.message.model, {
              turns: bucket.turns + 1,
              usage: addUsage(bucket.usage, body.message.usage),
            });
            break;
          }
          case "toolResult":
            if (body.message.usage !== undefined) {
              tools = addUsage(tools, body.message.usage);
            }
            break;
          case "user":
            break;
          default: {
            const _exhaustive: never = body.message;
            return _exhaustive;
          }
        }
        break;
      case "checkpoint":
      case "summary":
        if (body.usage !== undefined) compaction = addUsage(compaction, body.usage);
        break;
      case "config":
      case "note":
        break;
      default: {
        const _exhaustive: never = body;
        return _exhaustive;
      }
    }
  }

  return summarize(models, compaction, tools);
}

/** Combine per-session summaries into a workspace-wide summary. */
export function mergeUsageSummaries(left: UsageSummary, right: UsageSummary): UsageSummary {
  const models = new Map<string, { turns: number; usage: Usage }>();
  for (const row of [...left.models, ...right.models]) {
    const bucket = models.get(row.model) ?? { turns: 0, usage: emptyUsage() };
    models.set(row.model, {
      turns: bucket.turns + row.turns,
      usage: addUsage(bucket.usage, row.usage),
    });
  }
  return summarize(
    models,
    addUsage(left.compaction, right.compaction),
    addUsage(left.tools, right.tools),
  );
}
