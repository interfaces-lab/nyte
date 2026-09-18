/** Usage totals folded from immutable commits. */
import type { Usage } from "@nyte-ai/schema";
import type { Commit } from "@nyte-ai/protocol";

export type UsageSubject =
  | { readonly kind: "model"; readonly provider: string; readonly model: string }
  | { readonly kind: "tool" }
  | { readonly kind: "compaction" };

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  /** Assistant messages folded into this row. */
  readonly turns: number;
  readonly usage: Usage;
}

export interface UsageSummary {
  /** Highest cost first, then most tokens, then model id and provider. */
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

/** Use reported totals when present; cache and reasoning subcounts are not added twice. */
export function usageTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/** Classify recorded usage, including an explicitly reported zero. */
export function commitUsage(
  commit: Commit,
): { readonly subject: UsageSubject; readonly usage: Usage } | undefined {
  const body = commit.body;
  switch (body.kind) {
    case "message":
      switch (body.message.role) {
        case "assistant":
          return {
            subject: { kind: "model", provider: body.message.provider, model: body.message.model },
            usage: body.message.usage,
          };
        case "toolResult":
          return body.message.usage === undefined
            ? undefined
            : { subject: { kind: "tool" }, usage: body.message.usage };
        case "user":
          return undefined;
        default: {
          const _exhaustive: never = body.message;
          return _exhaustive;
        }
      }
    case "checkpoint":
    case "summary":
      return body.usage === undefined
        ? undefined
        : { subject: { kind: "compaction" }, usage: body.usage };
    case "completion":
    case "config":
    case "note":
      return undefined;
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

export function addUsage(left: Usage, right: Usage): Usage {
  let total: Usage = {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: usageTokens(left) + usageTokens(right),
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

function summarize(
  models: ReadonlyMap<string, ModelUsage>,
  compaction: Usage,
  tools: Usage,
): UsageSummary {
  const sorted = [...models.values()].toSorted(
    (left, right) =>
      right.usage.cost.total - left.usage.cost.total ||
      right.usage.totalTokens - left.usage.totalTokens ||
      left.model.localeCompare(right.model) ||
      left.provider.localeCompare(right.provider),
  );
  const total = [...sorted.map((row) => row.usage), compaction, tools].reduce(
    addUsage,
    emptyUsage(),
  );
  return { models: sorted, compaction, tools, total };
}

/** Fold every supplied commit, including commits on abandoned branches. */
export function projectUsage(commits: readonly Commit[]): UsageSummary {
  const models = new Map<string, ModelUsage>();
  let compaction = emptyUsage();
  let tools = emptyUsage();

  for (const commit of commits) {
    const spend = commitUsage(commit);
    if (spend === undefined) continue;
    const { subject, usage } = spend;
    switch (subject.kind) {
      case "model": {
        const key = JSON.stringify([subject.provider, subject.model]);
        const bucket = models.get(key);
        models.set(key, {
          provider: subject.provider,
          model: subject.model,
          turns: (bucket?.turns ?? 0) + 1,
          usage: addUsage(bucket?.usage ?? emptyUsage(), usage),
        });
        break;
      }
      case "tool":
        tools = addUsage(tools, usage);
        break;
      case "compaction":
        compaction = addUsage(compaction, usage);
        break;
      default: {
        const _exhaustive: never = subject;
        return _exhaustive;
      }
    }
  }

  return summarize(models, compaction, tools);
}

/** Combine per-session summaries into a workspace-wide summary. */
export function mergeUsageSummaries(left: UsageSummary, right: UsageSummary): UsageSummary {
  const models = new Map<string, ModelUsage>();
  for (const row of [...left.models, ...right.models]) {
    const key = JSON.stringify([row.provider, row.model]);
    const bucket = models.get(key);
    models.set(key, {
      provider: row.provider,
      model: row.model,
      turns: (bucket?.turns ?? 0) + row.turns,
      usage: addUsage(bucket?.usage ?? emptyUsage(), row.usage),
    });
  }
  return summarize(
    models,
    addUsage(left.compaction, right.compaction),
    addUsage(left.tools, right.tools),
  );
}
