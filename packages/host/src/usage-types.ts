import type { SessionId, Usage } from "@nyte-ai/schema";

export interface UsageWindow {
  readonly sinceDay: string | null;
  readonly untilDay: string;
}

export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly tokens: number;
  readonly cost: number;
  readonly turns: number;
}

export type UsageSubject =
  | { readonly kind: "model"; readonly provider: string; readonly model: string }
  | { readonly kind: "tool" }
  | { readonly kind: "compaction" };

export interface UsageEntry {
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionId;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

export interface UsageSession {
  readonly sessionId: SessionId;
  readonly name?: string;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  readonly sessions: number;
  readonly message: string | null;
}

export interface UsageReport {
  readonly readAt: number;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  readonly previous?: { readonly cost: number; readonly tokens: number };
  readonly earliestDay?: string;
}

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly turns: number;
  readonly usage: Usage;
}

export interface UsageSummary {
  readonly models: readonly ModelUsage[];
  readonly compaction: Usage;
  readonly tools: Usage;
  readonly total: Usage;
}

export type LocalHistoryUsage =
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly summary: UsageSummary;
      readonly unpricedRecords: number;
      readonly malformedRecords: number;
      readonly unreadableFiles: number;
    };

export interface UsageSnapshot extends UsageReport {
  readonly nyteError: string | null;
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}
