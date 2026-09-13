/** Recorded token consumption and estimated cost, grouped by workspace and local tool. */
import type { AccountUsage, LocalHistoryUsage, LocalUsage } from "@nyte-ai/host/usage";
import type { Usage } from "@nyte-ai/schema";
import { formatTokens } from "./format.ts";
import type { WorkspaceUsage } from "./host.ts";

export interface UsageCardRow {
  readonly label: string;
  /** Compaction and tool buckets use neutral bars: spend without a model id. */
  readonly system: boolean;
  readonly share: number;
  readonly cost: string;
  readonly tokens: string;
}

export type WorkspaceUsageCard =
  | { readonly kind: "empty"; readonly title: string; readonly message: string }
  | {
      readonly kind: "usage";
      readonly title: string;
      readonly total: string;
      readonly rows: readonly [UsageCardRow, ...UsageCardRow[]];
      readonly breakdown: readonly [string, ...string[]];
      readonly thisChat?: string;
    };

export type LocalUsageCard =
  | { readonly kind: "message"; readonly message: string }
  | {
      readonly kind: "usage";
      readonly total: string;
      readonly rows: readonly UsageCardRow[];
      readonly breakdown: readonly string[];
      readonly notes: readonly string[];
    };

export interface UsageCard {
  readonly accounts: readonly AccountUsage[];
  readonly workspace: WorkspaceUsageCard;
  readonly claudeCode: LocalUsageCard;
  readonly codex: LocalUsageCard;
}

function formatCost(cost: number): string {
  if (cost === 0 || cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function hasUsage(usage: Usage): boolean {
  return usage.totalTokens > 0 || usage.cost.total > 0;
}

interface RawRow {
  readonly label: string;
  readonly system: boolean;
  readonly usage: Usage;
}

/** Bars answer "where did the money go"; with no cost they fall back to tokens. */
function shares(rows: readonly RawRow[]): number[] {
  const measure: (row: RawRow) => number = rows.some((row) => row.usage.cost.total > 0)
    ? (row) => row.usage.cost.total
    : (row) => row.usage.totalTokens;
  const top = Math.max(...rows.map(measure));
  if (top <= 0) return rows.map(() => 0);
  return rows.map((row) => measure(row) / top);
}

function formatRows(raw: readonly RawRow[], hasUnpriced = false): UsageCardRow[] {
  // History counts unpriced records globally, so a zero-cost model may not be free.
  const costs = raw.map((row) =>
    hasUnpriced && row.usage.cost.total === 0 ? "—" : formatCost(row.usage.cost.total),
  );
  const tokens = raw.map((row) => formatTokens(row.usage.totalTokens));
  const costWidth = Math.max(...costs.map((cost) => cost.length));
  const tokenWidth = Math.max(...tokens.map((value) => value.length));
  const rowShares = shares(raw);
  return raw.map((row, index) => ({
    label: row.label,
    system: row.system,
    share: rowShares[index] ?? 0,
    cost: (costs[index] ?? "").padStart(costWidth),
    tokens: (tokens[index] ?? "").padStart(tokenWidth),
  }));
}

function breakdownLines(total: Usage): readonly [string, ...string[]] {
  const primary = `input ${formatTokens(total.input)} · output ${formatTokens(total.output)}`;
  const cache: string[] = [];
  if (total.cacheRead > 0) cache.push(`cache read ${formatTokens(total.cacheRead)}`);
  if (total.cacheWrite > 0) cache.push(`cache write ${formatTokens(total.cacheWrite)}`);
  return cache.length === 0 ? [primary] : [primary, cache.join(" · ")];
}

function workspaceCard(report: WorkspaceUsage): WorkspaceUsageCard {
  const { chats, workspace, current } = report;
  const empty: WorkspaceUsageCard = {
    kind: "empty",
    title: "workspace",
    message: "No usage recorded",
  };
  if (chats === 0) return empty;

  const raw: RawRow[] = workspace.models.map((row) => ({
    label: workspace.models.some(
      (other) => other.model === row.model && other.provider !== row.provider,
    )
      ? `${row.provider}/${row.model}`
      : row.model,
    system: false,
    usage: row.usage,
  }));
  if (hasUsage(workspace.compaction)) {
    raw.push({ label: "compaction", system: true, usage: workspace.compaction });
  }
  if (hasUsage(workspace.tools)) raw.push({ label: "tools", system: true, usage: workspace.tools });
  const [first, ...rest] = formatRows(raw);
  if (first === undefined) return empty;

  const card: WorkspaceUsageCard = {
    kind: "usage",
    title: `workspace · ${count(chats, "chat")}`,
    total: formatCost(workspace.total.cost.total),
    rows: [first, ...rest],
    breakdown: breakdownLines(workspace.total),
  };
  if (chats > 1 && hasUsage(current.total)) {
    return {
      ...card,
      thisChat: `this chat · ${formatTokens(current.total.totalTokens)} tokens · ${formatCost(current.total.cost.total)}`,
    };
  }
  return card;
}

function localUsageCard(result: LocalHistoryUsage, name: string): LocalUsageCard {
  switch (result.kind) {
    case "missing":
      return { kind: "message", message: `No local ${name} history found` };
    case "failed":
      return { kind: "message", message: result.message };
    case "ready": {
      const partial =
        result.unpricedRecords > 0 || result.malformedRecords > 0 || result.unreadableFiles > 0;
      if (result.summary.models.length === 0 && !hasUsage(result.summary.total) && !partial) {
        return { kind: "message", message: `No ${name} usage recorded` };
      }
      const notes = ["API estimates are not subscription charges."];
      if (result.unpricedRecords > 0) {
        notes.push(
          `Cost unavailable for ${count(result.unpricedRecords, "record")}; excluded from the estimate.`,
        );
      }
      if (result.malformedRecords > 0) {
        notes.push(`Skipped ${count(result.malformedRecords, "malformed record")}.`);
      }
      if (result.unreadableFiles > 0) {
        notes.push(`Could not read ${count(result.unreadableFiles, "history file")}.`);
      }
      const estimate =
        partial && result.summary.total.cost.total === 0
          ? "API estimate unavailable"
          : `${partial ? "Known API estimate" : "API estimate"} ${formatCost(result.summary.total.cost.total)}`;
      return {
        kind: "usage",
        total: `${formatTokens(result.summary.total.totalTokens)} tokens · ${estimate}`,
        rows: formatRows(
          result.summary.models.map((row) => ({
            label: row.model,
            system: false,
            usage: row.usage,
          })),
          result.unpricedRecords > 0,
        ),
        breakdown: breakdownLines(result.summary.total),
        notes,
      };
    }
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/** Keep external tool consumption separate from Nyte workspace totals. */
export function usageCard(
  report: WorkspaceUsage,
  options: LocalUsage,
  accounts: readonly AccountUsage[],
): UsageCard {
  return {
    accounts,
    workspace: workspaceCard(report),
    claudeCode: localUsageCard(options.claudeCode, "Claude Code"),
    codex: localUsageCard(options.codex, "Codex"),
  };
}
