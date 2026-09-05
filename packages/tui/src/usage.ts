/**
 * The read model behind `/usage`: durable workspace totals, in-progress runs,
 * and subscription headroom the host fetched. `usageCard` turns the three into
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
import type { Usage } from "@nyte-ai/schema";
import { GLYPHS } from "./constants.ts";
import { formatDuration, formatTokens } from "./format.ts";
import type { WorkspaceUsage } from "./host.ts";
import { displayWidth, padDisplay, truncateDisplay } from "./width.ts";

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

export const USAGE_BAR_CELLS = 20;
const STALE_AFTER_MS = 15 * 60_000;
const MAX_RUN_ROWS = 5;
const LABEL_CELLS = 24;

export type Tone = "ok" | "warning" | "critical";

export interface RunCardRow {
  readonly live: boolean;
  readonly label: string;
  readonly detail: string;
  readonly usage: string;
}

export type RunsCard =
  | { readonly kind: "none" }
  | {
      readonly kind: "runs";
      readonly summary: string;
      readonly rows: readonly [RunCardRow, ...RunCardRow[]];
      readonly more?: string;
      readonly note: string;
    };

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
  /** Compaction and tool buckets, rendered dim: spend without a model id. */
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

export interface UsageCard {
  readonly runs: RunsCard;
  readonly headroom: HeadroomCard;
  readonly workspace: WorkspaceUsageCard;
}

export type HeadroomState =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "known"; readonly limits: AccountLimits }
  | { readonly kind: "unavailable" };

export interface UsageCardOptions {
  readonly activeProvider: string;
  readonly headroom: HeadroomState;
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

function runsCard(report: WorkspaceUsage, now: number): RunsCard {
  const [first, ...rest] = report.runs.slice(0, MAX_RUN_ROWS).map((run): RunCardRow => {
    const live = run.run.lease !== undefined;
    return {
      live,
      label: run.current ? "this chat" : run.label,
      detail: live
        ? `${run.run.phase.kind} · ${formatDuration(Math.max(0, now - run.run.startedAt))}`
        : "interrupted",
      usage: `${formatTokens(run.usage.totalTokens)} · ${formatCost(run.usage.cost.total)}`,
    };
  });
  if (first === undefined) return { kind: "none" };
  const live = report.runs.filter((run) => run.run.lease !== undefined).length;
  const interrupted = report.runs.length - live;
  const summary = [
    ...(live > 0 ? [`${String(live)} running`] : []),
    ...(interrupted > 0 ? [`${String(interrupted)} interrupted`] : []),
  ].join(" · ");
  const hidden = report.runs.length - MAX_RUN_ROWS;
  const card: RunsCard = {
    kind: "runs",
    summary,
    rows: [first, ...rest],
    note: "committed below · open requests excluded",
  };
  return hidden > 0 ? { ...card, more: `+${String(hidden)} more` } : card;
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
    label: truncateDisplay(row.model, LABEL_CELLS, GLYPHS.ellipsis),
    system: false,
    usage: row.usage,
  }));
  if (hasUsage(workspace.compaction)) {
    raw.push({ label: "compaction", system: true, usage: workspace.compaction });
  }
  if (hasUsage(workspace.tools)) raw.push({ label: "tools", system: true, usage: workspace.tools });
  const [first, ...rest] = raw;
  if (first === undefined) return empty;

  const costs = raw.map((row) => formatCost(row.usage.cost.total));
  const tokens = raw.map((row) => formatTokens(row.usage.totalTokens));
  const costWidth = Math.max(...costs.map((cost) => cost.length));
  const tokenWidth = Math.max(...tokens.map((value) => value.length));
  const rowShares = shares(raw);
  const toRow = (row: RawRow, index: number): UsageCardRow => ({
    label: row.label,
    system: row.system,
    share: rowShares[index] ?? 0,
    cost: (costs[index] ?? "").padStart(costWidth),
    tokens: (tokens[index] ?? "").padStart(tokenWidth),
  });

  const card: WorkspaceUsageCard = {
    kind: "usage",
    title: `workspace · ${count(chats, "chat")}`,
    total: formatCost(workspace.total.cost.total),
    rows: [toRow(first, 0), ...rest.map((row, index) => toRow(row, index + 1))],
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

/** Join in-progress runs, account headroom, and workspace totals into one card. */
export function usageCard(report: WorkspaceUsage, options: UsageCardOptions): UsageCard {
  const now = options.now ?? Date.now();
  return {
    runs: runsCard(report, now),
    headroom: headroomCard(options, now),
    workspace: workspaceCard(report),
  };
}

// ---------------------------------------------------------------------------
// The card as text, for the notice slot
// ---------------------------------------------------------------------------

const BAR_FILLED = "━";
/** An open run nobody is driving: hollow, next to the running bullet. */
const INTERRUPTED = "○";

function bar(share: number, cells: number): string {
  const fill = share <= 0 ? 0 : Math.max(1, Math.min(cells, Math.round(share * cells)));
  return `${BAR_FILLED.repeat(fill)}${GLYPHS.rule.repeat(cells - fill)}`;
}

/** One line per row, the way the notice slot draws them: no colors, no panel. */
export function usageLines(card: UsageCard): string[] {
  const lines: string[] = [];
  if (card.runs.kind === "none") lines.push("in progress · none");
  else {
    lines.push(`in progress · ${card.runs.summary}`);
    for (const run of card.runs.rows) {
      lines.push(
        `  ${run.live ? GLYPHS.bullet : INTERRUPTED} ${run.label}  ${run.detail}  ${run.usage}`,
      );
    }
    if (card.runs.more !== undefined) lines.push(`  ${card.runs.more}`);
    lines.push(`  ${card.runs.note}`);
  }
  const { headroom } = card;
  switch (headroom.kind) {
    case "none":
      lines.push("account headroom · not in use");
      break;
    case "checking":
      lines.push(`${headroom.name} · checking…`);
      break;
    case "unavailable":
      lines.push(`${headroom.name} · not available`);
      break;
    case "known":
      lines.push(`${headroom.name} · ${headroom.meta}${headroom.stale ? " (stale)" : ""}`);
      for (const window of headroom.windows) {
        lines.push(
          `  ${window.label} ${bar(window.share, USAGE_BAR_CELLS)}  ${window.remaining}  ${window.reset}`,
        );
      }
      break;
    default: {
      const _exhaustive: never = headroom;
      return _exhaustive;
    }
  }
  const { workspace } = card;
  if (workspace.kind === "empty") {
    lines.push(`${workspace.title} · ${workspace.message}`);
    return lines;
  }
  lines.push(`${workspace.title} · ${workspace.total}`);
  const labelCells = Math.max(...workspace.rows.map((row) => displayWidth(row.label)));
  for (const row of workspace.rows) {
    lines.push(
      `  ${padDisplay(row.label, labelCells)}  ${bar(row.share, USAGE_BAR_CELLS)}  ${row.cost}  ${row.tokens}`,
    );
  }
  lines.push(...workspace.breakdown.map((line) => `  ${line}`));
  if (workspace.thisChat !== undefined) lines.push(`  ${workspace.thisChat}`);
  lines.push("  estimates exclude subscription billing");
  return lines;
}
