/**
 * The read model behind `/usage`: workspace totals, Claude Code local history,
 * and subscription headroom the host fetched. `usageCard` turns them into
 * strings, fills, and tones, so the panel only paints.
 */
import {
  fetchAnthropicAccountLimits,
  fetchOpenAICodexAccountLimits,
  hasApi,
  type AccountLimits,
  type Model,
  type Models,
} from "@nyte-ai/ai";
import type { ClaudeCodeUsage } from "@nyte-ai/host/usage";
import type { Usage } from "@nyte-ai/schema";
import { formatTokens } from "./format.ts";
import type { WorkspaceUsage } from "./host.ts";

// ---------------------------------------------------------------------------
// Ephemeral: subscription headroom
// ---------------------------------------------------------------------------

/** Providers with subscription windows. API-key providers have none. */
const HEADROOM_PROVIDERS: ReadonlyMap<string, string> = new Map([
  ["openai-codex", "OpenAI Codex"],
  ["anthropic", "Claude"],
]);

/** Whether `/usage` has subscription headroom to fetch for the active provider. */
export function hasHeadroom(provider: string): boolean {
  return HEADROOM_PROVIDERS.has(provider);
}

/** The active provider's limits, fetched now. Nothing when the provider has no windows. */
export async function fetchAccountLimits(
  models: Models,
  provider: string,
  signal?: AbortSignal,
): Promise<AccountLimits | undefined> {
  try {
    if (provider === "anthropic") {
      const model = models
        .getModels("anthropic")
        .find((candidate) => hasApi(candidate, "anthropic-messages"));
      if (model === undefined) return undefined;
      const auth = await models.getAuth(model, { signal });
      if (auth?.auth.apiKey === undefined || !auth.auth.apiKey.includes("sk-ant-oat")) {
        return undefined;
      }
      const requestModel: Model<"anthropic-messages"> =
        auth.auth.baseUrl === undefined ? model : { ...model, baseUrl: auth.auth.baseUrl };
      return await fetchAnthropicAccountLimits(requestModel, {
        apiKey: auth.auth.apiKey,
        headers: auth.auth.headers,
        signal,
        timeoutMs: 10_000,
      });
    }
    if (provider === "openai-codex") {
      const model = models
        .getModels("openai-codex")
        .find((candidate) => hasApi(candidate, "openai-codex-responses"));
      if (model === undefined) return undefined;
      const auth = await models.getAuth(model, { signal });
      if (auth?.auth.apiKey === undefined) return undefined;
      const requestModel: Model<"openai-codex-responses"> =
        auth.auth.baseUrl === undefined ? model : { ...model, baseUrl: auth.auth.baseUrl };
      return await fetchOpenAICodexAccountLimits(requestModel, {
        apiKey: auth.auth.apiKey,
        headers: auth.auth.headers,
        signal,
        timeoutMs: 10_000,
      });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

interface HeadroomWindow {
  readonly label: string;
  readonly remainingPercent: number;
  readonly resetsAt?: number;
}

function windowLabel(window: AccountLimits["windows"][number]): string {
  if (window.id === "five_hour") return "5h";
  if (window.id === "seven_day") return "weekly";
  if (window.id === "seven_day_sonnet") return "weekly Sonnet";
  if (window.id === "seven_day_opus") return "weekly Opus";
  if (window.windowMinutes !== undefined && window.windowMinutes % 60 === 0) {
    return `${String(window.windowMinutes / 60)}h`;
  }
  return window.id.replaceAll("_", " ");
}

function toWindow(window: AccountLimits["windows"][number]): HeadroomWindow {
  const base: HeadroomWindow = {
    label: windowLabel(window),
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent))),
  };
  return window.resetsAt === undefined ? base : { ...base, resetsAt: window.resetsAt };
}

// ---------------------------------------------------------------------------
// The card: strings, fills, tones
// ---------------------------------------------------------------------------

const STALE_AFTER_MS = 15 * 60_000;

export type Tone = "ok" | "warning" | "critical";

export interface HeadroomWindowRow {
  readonly label: string;
  readonly share: number;
  readonly tone: Tone;
  readonly remaining: string;
  readonly reset: string;
}

export type HeadroomCard =
  | { readonly kind: "none" }
  | { readonly kind: "checking"; readonly name: string }
  | { readonly kind: "unavailable"; readonly name: string }
  | {
      readonly kind: "known";
      readonly name: string;
      readonly meta: string;
      readonly stale: boolean;
      readonly windows: readonly [HeadroomWindowRow, ...HeadroomWindowRow[]];
    };

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

export type ClaudeCodeUsageCard =
  | { readonly kind: "message"; readonly message: string }
  | {
      readonly kind: "usage";
      readonly total: string;
      readonly rows: readonly UsageCardRow[];
      readonly breakdown: readonly string[];
      readonly notes: readonly string[];
    };

export interface UsageCard {
  readonly headroom: HeadroomCard;
  readonly workspace: WorkspaceUsageCard;
  readonly claudeCode: ClaudeCodeUsageCard;
}

export type HeadroomState =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "known"; readonly limits: AccountLimits }
  | { readonly kind: "unavailable" };

export interface UsageCardOptions {
  readonly activeProvider: string;
  readonly headroom: HeadroomState;
  readonly claudeCode: ClaudeCodeUsage | { readonly kind: "checking" };
  readonly now?: number;
}

function formatCost(cost: number): string {
  if (cost === 0 || cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function elapsedLabel(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return "now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  return `${String(Math.floor(minutes / 60))}h ago`;
}

function resetLabel(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) return "reset unknown";
  const minutes = Math.max(0, Math.ceil((timestamp - now) / 60_000));
  if (minutes < 60) return `resets in ${String(minutes)}m`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0
      ? `resets in ${String(hours)}h`
      : `resets in ${String(hours)}h ${String(rest)}m`;
  }
  return `resets ${new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function hasUsage(usage: Usage): boolean {
  return usage.totalTokens > 0 || usage.cost.total > 0;
}

function headroomWindowRow(window: HeadroomWindow, now: number): HeadroomWindowRow {
  const { remainingPercent } = window;
  return {
    label: window.label.padEnd(7),
    share: remainingPercent / 100,
    tone: remainingPercent <= 5 ? "critical" : remainingPercent <= 15 ? "warning" : "ok",
    remaining: `${String(remainingPercent)}%`.padStart(4),
    reset: resetLabel(window.resetsAt, now),
  };
}

function headroomCard(options: UsageCardOptions, now: number): HeadroomCard {
  const name = HEADROOM_PROVIDERS.get(options.activeProvider);
  if (name === undefined) return { kind: "none" };
  const { headroom } = options;
  switch (headroom.kind) {
    case "none":
      return { kind: "none" };
    case "checking":
      return { kind: "checking", name };
    case "unavailable":
      return { kind: "unavailable", name };
    case "known": {
      const [first, ...rest] = headroom.limits.windows.map(toWindow);
      if (first === undefined) return { kind: "unavailable", name };
      const stale = now - headroom.limits.observedAt > STALE_AFTER_MS;
      const plan =
        headroom.limits.plan === undefined
          ? undefined
          : headroom.limits.plan.charAt(0).toUpperCase() + headroom.limits.plan.slice(1);
      const observation = `fetched ${elapsedLabel(headroom.limits.observedAt, now)}`;
      return {
        kind: "known",
        name,
        meta: plan === undefined ? observation : `${plan} · ${observation}`,
        stale,
        windows: [
          headroomWindowRow(first, now),
          ...rest.map((window) => headroomWindowRow(window, now)),
        ],
      };
    }
    default: {
      const _exhaustive: never = headroom;
      return _exhaustive;
    }
  }
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

function claudeCodeCard(result: UsageCardOptions["claudeCode"]): ClaudeCodeUsageCard {
  switch (result.kind) {
    case "checking":
      return { kind: "message", message: "Reading local history…" };
    case "missing":
      return { kind: "message", message: "No local Claude Code history found" };
    case "failed":
      return { kind: "message", message: result.message };
    case "ready": {
      const partial =
        result.unpricedRecords > 0 || result.malformedRecords > 0 || result.unreadableFiles > 0;
      if (result.summary.models.length === 0 && !hasUsage(result.summary.total) && !partial) {
        return { kind: "message", message: "No Claude Code usage recorded" };
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

/** Join account headroom, workspace totals, and Claude Code local history into one card. */
export function usageCard(report: WorkspaceUsage, options: UsageCardOptions): UsageCard {
  const now = options.now ?? Date.now();
  return {
    headroom: headroomCard(options, now),
    workspace: workspaceCard(report),
    claudeCode: claudeCodeCard(options.claudeCode),
  };
}
