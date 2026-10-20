import type { SessionId } from "@nyte-ai/sdk";
import type { ProviderUsage } from "@nyte-ai/sdk";
import type { UsageSnapshot } from "../bridge.ts";
import type { UsageReport, UsageTotals, UsageWindow } from "../nyte.ts";

export const USAGE_STALE_AFTER_MS = 60_000;

export const USAGE_RANGES = ["7d", "30d", "90d", "all"] as const;

export type UsageRange = (typeof USAGE_RANGES)[number];

export const USAGE_RANGE_LABELS: Readonly<Record<UsageRange, string>> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

const RANGE_LENGTHS: Readonly<Record<Exclude<UsageRange, "all">, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const WEEKLY_ABOVE_DAYS = 120;

type UsageGrain = "day" | "week";

export interface UsagePoint {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

const LOW_CACHE_HIT = 0.5;

export interface UsageCache {
  readonly hit: string;
  readonly saved: string | undefined;
  readonly tone: "plain" | "low" | "absent";
}

export interface UsageRow {
  readonly key: string;
  readonly label: string;
  readonly meta: string;
  readonly cache: UsageCache;
  readonly trend: readonly number[] | undefined;
  readonly value: { readonly text: string; readonly absent: boolean };
  readonly share: number;
}

export type UsageMeasure = "cost" | "tokens";

export interface UsageDerived {
  readonly grain: UsageGrain;
  readonly measure: UsageMeasure;
  readonly from: string;
  readonly to: string;
  readonly points: readonly UsagePoint[];
  readonly totals: UsageTotals;
  readonly previousCost: number | undefined;
  readonly models: readonly UsageRow[];
  readonly folders: readonly UsageRow[];
  readonly chats: readonly UsageRow[];
  readonly unreadFolders: readonly string[];
}

const EMPTY_TOTALS: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  tokens: 0,
  cost: 0,
  cacheSavings: 0,
};

function addTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning: left.reasoning + right.reasoning,
    tokens: left.tokens + right.tokens,
    cost: left.cost + right.cost,
    cacheSavings: left.cacheSavings + right.cacheSavings,
  };
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function formatUsd(dollars: number): string {
  if (dollars === 0) return "$0.00";

  if (dollars < 0.01) return "<$0.01";
  const fixed = dollars.toFixed(2);

  return `$${group(fixed.slice(0, -3))}${fixed.slice(-3)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));

  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}K`;

  if (tokens < 1_000_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 2 : 1)}M`;

  return `${(tokens / 1_000_000_000).toFixed(2)}B`;
}

export function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%";

  if (fraction < 0.01) return "<1%";

  return `${String(Math.round(fraction * 100))}%`;
}

function plural(count: number, noun: string): string {
  return `${group(String(Math.round(count)))} ${noun}${count === 1 ? "" : "s"}`;
}

function localDay(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${String(date.getFullYear())}-${month}-${day}`;
}

function dayStart(day: string): number {
  return new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  ).getTime();
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(dayStart(day));
  date.setDate(date.getDate() + delta);

  return localDay(date.getTime());
}

function dayLabel(day: string): string {
  return new Date(dayStart(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function spanLabel(from: string, to: string): string {
  return from === to ? dayLabel(to) : `${dayLabel(from)} – ${dayLabel(to)}`;
}

export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function costChange(
  current: number,
  previous: number | undefined,
  range: UsageRange,
): { readonly direction: "up" | "down" | "flat"; readonly label: string } | undefined {
  if (previous === undefined || range === "all") return undefined;
  const prior = `prior ${USAGE_RANGE_LABELS[range].toLocaleLowerCase()}`;

  if (previous === 0)
    return current === 0 ? undefined : { direction: "up", label: `None in the ${prior}` };
  const change = (current - previous) / previous;

  if (Math.abs(change) < 0.005) return { direction: "flat", label: `No change vs ${prior}` };

  return {
    direction: change > 0 ? "up" : "down",
    label: `${change > 0 ? "↑" : "↓"} ${formatPercent(Math.abs(change))} vs ${prior}`,
  };
}

interface CacheCounts {
  readonly prompt: number;
  readonly cacheRead: number;
  readonly savings: number;
  readonly cost: number;
}

const NO_CACHE: UsageCache = { hit: "—", saved: undefined, tone: "absent" };

function promptTokens(tokens: Pick<UsageTotals, "input" | "cacheRead" | "cacheWrite">): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

function describeCache(counts: CacheCounts): UsageCache {
  if (counts.prompt === 0) return NO_CACHE;
  const hit = counts.cacheRead / counts.prompt;

  return {
    hit: formatPercent(hit),
    saved: counts.savings > 0 ? `saved ${formatUsd(counts.savings)}` : undefined,
    tone: counts.cost > 0 && hit < LOW_CACHE_HIT ? "low" : "plain",
  };
}

export function describeTotals(totals: UsageTotals): string {
  const cache = describeCache({
    prompt: promptTokens(totals),
    cacheRead: totals.cacheRead,
    savings: totals.cacheSavings,
    cost: totals.cost,
  });

  if (cache.tone === "absent") return `${formatTokens(totals.tokens)} tokens`;

  return [`${cache.hit} cache hit`, cache.saved].filter((part) => part !== undefined).join(" · ");
}

export function usageWindow(range: UsageRange, now: number): UsageWindow {
  const untilDay = localDay(now);

  return {
    sinceDay: range === "all" ? null : shiftDay(untilDay, -(RANGE_LENGTHS[range] - 1)),
    untilDay,
  };
}

function daySpan(from: string, to: string): readonly string[] {
  const days: string[] = [];

  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);

  return days;
}

function bucketLabel(first: string, last: string, grain: UsageGrain): string {
  return grain === "day" ? dayLabel(first) : `${dayLabel(first)} – ${dayLabel(last)}`;
}

function daysBetween(from: string, to: string): number {
  let span = 1;

  for (let day = from; day < to; day = shiftDay(day, 1)) span += 1;

  return span;
}

function priorWindow(
  from: string,
  to: string,
  bounded: boolean,
): { readonly from: string; readonly to: string } | undefined {
  if (!bounded) return undefined;
  const priorTo = shiftDay(from, -1);

  return { from: shiftDay(priorTo, -(daysBetween(from, to) - 1)), to: priorTo };
}

function folderLabel(path: string | null): string {
  if (path === null) return "Home";
  const segments = path.split("/").filter((segment) => segment !== "");

  return segments.at(-1) ?? path;
}

function folderParent(path: string | null): string | undefined {
  if (path === null) return undefined;
  const segments = path.split("/").filter((segment) => segment !== "");

  return segments.at(-2);
}

function chatLabel(name: string | undefined): string {
  const trimmed = name?.trim();

  return trimmed === undefined || trimmed === "" ? "Untitled chat" : trimmed;
}

interface Spend {
  cost: number;
  tokens: number;
  cacheRead: number;
  prompt: number;
  savings: number;
  readonly costs: number[];
  readonly tokensBy: number[];
}

function emptySpend(buckets: number): Spend {
  return {
    cost: 0,
    tokens: 0,
    cacheRead: 0,
    prompt: 0,
    savings: 0,
    costs: Array.from({ length: buckets }, () => 0),
    tokensBy: Array.from({ length: buckets }, () => 0),
  };
}

function addSpend(spend: Spend, totals: UsageTotals, bucket: number): void {
  spend.cost += totals.cost;
  spend.tokens += totals.tokens;
  spend.cacheRead += totals.cacheRead;
  spend.prompt += promptTokens(totals);
  spend.savings += totals.cacheSavings;
  spend.costs[bucket] = (spend.costs[bucket] ?? 0) + totals.cost;
  spend.tokensBy[bucket] = (spend.tokensBy[bucket] ?? 0) + totals.tokens;
}

export function deriveUsage(report: UsageReport, window: UsageWindow): UsageDerived {
  const to = window.untilDay;
  const from = window.sinceDay ?? report.earliestDay ?? to;
  const prior = priorWindow(from, to, window.sinceDay !== null);
  const days = daySpan(from, to);
  const grain: UsageGrain = days.length > WEEKLY_ABOVE_DAYS ? "week" : "day";
  const bucketSize = grain === "day" ? 1 : 7;
  const bucketCount = Math.ceil(days.length / bucketSize);
  const bucketOf = new Map(days.map((day, index) => [day, Math.floor(index / bucketSize)]));

  const whole = emptySpend(bucketCount);
  const perModel = new Map<string, { provider: string; model: string; spend: Spend }>();
  const perFolder = new Map<string, { path: string | null; spend: Spend }>();
  const perChat = new Map<SessionId, Spend>();
  const overhead = emptySpend(bucketCount);
  let totals = EMPTY_TOTALS;

  let priorCost = 0;
  let sawPrior = false;

  for (const entry of report.entries) {
    if (prior !== undefined && entry.day >= prior.from && entry.day <= prior.to) {
      sawPrior = true;
      priorCost += entry.totals.cost;
    }

    const bucket = bucketOf.get(entry.day);

    if (bucket === undefined) continue;

    totals = addTotals(totals, entry.totals);
    addSpend(whole, entry.totals, bucket);

    const folderKey = entry.workspacePath ?? "";

    const folder = perFolder.get(folderKey) ?? {
      path: entry.workspacePath,
      spend: emptySpend(bucketCount),
    };

    addSpend(folder.spend, entry.totals, bucket);
    perFolder.set(folderKey, folder);

    const chat = perChat.get(entry.sessionId) ?? emptySpend(bucketCount);
    addSpend(chat, entry.totals, bucket);
    perChat.set(entry.sessionId, chat);

    if (entry.subject.kind === "model") {
      const key = JSON.stringify([entry.subject.provider, entry.subject.model]);

      const model = perModel.get(key) ?? {
        provider: entry.subject.provider,
        model: entry.subject.model,
        spend: emptySpend(bucketCount),
      };

      addSpend(model.spend, entry.totals, bucket);
      perModel.set(key, model);
      continue;
    }

    addSpend(overhead, entry.totals, bucket);
  }

  const measure: UsageMeasure = totals.cost > 0 ? "cost" : "tokens";
  const wholeAmount = measure === "cost" ? totals.cost : totals.tokens;

  const row = (key: string, label: string, meta: string, spend: Spend): UsageRow => ({
    key,
    label,
    meta,
    cache: describeCache(spend),
    trend: measure === "cost" && spend.cost > 0 ? spend.costs : spend.tokensBy,
    value:
      measure === "tokens"
        ? { text: `${formatTokens(spend.tokens)} tokens`, absent: false }
        : spend.cost === 0
          ? { text: "No price", absent: true }
          : { text: formatUsd(spend.cost), absent: false },
    share: wholeAmount === 0 ? 0 : (measure === "cost" ? spend.cost : spend.tokens) / wholeAmount,
  });

  const ranked = (rows: readonly UsageRow[]): readonly UsageRow[] =>
    rows.toSorted((left, right) => right.share - left.share);

  const points = Array.from({ length: bucketCount }, (_slot, index): UsagePoint => {
    const first = days[index * bucketSize] ?? from;
    const last = days[Math.min((index + 1) * bucketSize, days.length) - 1] ?? first;

    return {
      key: first,
      label: bucketLabel(first, last, grain),
      value: (measure === "cost" ? whole.costs[index] : whole.tokensBy[index]) ?? 0,
    };
  });

  const leafCounts = new Map<string, number>();

  for (const folder of perFolder.values()) {
    const leaf = folderLabel(folder.path);
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }

  const models = [...perModel].map(([key, model]) =>
    row(
      key,
      model.model,
      `${model.provider} · ${formatTokens(model.spend.tokens)} tokens`,
      model.spend,
    ),
  );

  if (overhead.cost > 0 || overhead.tokens > 0) {
    models.push(
      row(
        "overhead",
        "Compaction and tools",
        `No model of its own · ${formatTokens(overhead.tokens)} tokens`,
        overhead,
      ),
    );
  }

  return {
    grain,
    measure,
    from,
    to,
    points,
    totals,
    previousCost: sawPrior ? priorCost : undefined,
    models: ranked(models),
    folders: ranked(
      [...perFolder].map(([key, folder]) => {
        const leaf = folderLabel(folder.path);
        const parent = (leafCounts.get(leaf) ?? 0) > 1 ? folderParent(folder.path) : undefined;

        return row(
          key,
          parent === undefined ? leaf : `${leaf} in ${parent}`,
          `${formatTokens(folder.spend.tokens)} tokens`,
          folder.spend,
        );
      }),
    ),
    chats: ranked(
      report.sessions.flatMap((session) => {
        const spent = perChat.get(session.sessionId);

        return spent === undefined
          ? []
          : [
              row(
                session.sessionId,
                chatLabel(session.name),
                `${folderLabel(session.workspacePath)} · ${formatTokens(spent.tokens)} tokens`,
                spent,
              ),
            ];
      }),
    ),
    unreadFolders: report.sources
      .filter((source) => source.status === "failed")
      .map((source) => folderLabel(source.workspacePath)),
  };
}

export function describeEmptyRange(
  report: UsageSnapshot,
  unreadFolders: readonly string[],
  range: UsageRange,
) {
  if (report.nyteError !== null || unreadFolders.length > 0) {
    return {
      title: "Couldn't read all Nyte usage",
      body: report.nyteError ?? `Couldn't read ${unreadFolders.join(", ")}.`,
      offerAllTime: false,
    };
  }

  const earliest = report.earliestDay;

  if (earliest === undefined) {
    return {
      title: "No recorded Nyte usage",
      body: "Usage from Nyte chats will appear here.",
      offerAllTime: false,
    };
  }

  return {
    title:
      range === "all"
        ? "No usage in this range"
        : `Nothing in the last ${USAGE_RANGE_LABELS[range].toLocaleLowerCase()}`,
    body: `Earliest recorded usage: ${dayLabel(earliest)}.`,
    offerAllTime: range !== "all",
  };
}

const USAGE_TOOLS = ["nyte", "claudeCode", "codex"] as const;

type UsageTool = (typeof USAGE_TOOLS)[number];

type LocalTool = Exclude<UsageTool, "nyte">;

const USAGE_TOOL_LABELS: Readonly<Record<UsageTool, string>> = {
  nyte: "Nyte",
  claudeCode: "Claude Code",
  codex: "Codex",
};

const USAGE_TOOL_HOMES: Readonly<Record<LocalTool, string>> = {
  claudeCode: "CLAUDE_CONFIG_DIR or ~/.claude",
  codex: "CODEX_HOME or ~/.codex",
};

type LocalHistory = UsageSnapshot["claudeCode"];

function coverageGaps(usage: Extract<LocalHistory, { kind: "ready" }>): readonly string[] {
  return [
    usage.malformedRecords > 0 && plural(usage.malformedRecords, "malformed record"),
    usage.unreadableFiles > 0 && plural(usage.unreadableFiles, "unreadable file"),
    usage.unpricedRecords > 0 && plural(usage.unpricedRecords, "unpriced record"),
  ].filter((gap) => gap !== false);
}

type ToolSpend =
  | (CacheCounts & { readonly tokens: number; readonly partial: boolean })
  | { readonly absent: string; readonly meta: string };

function toolSpend(report: UsageSnapshot, tool: UsageTool): ToolSpend {
  if (tool === "nyte") {
    if (report.nyteError !== null) return { absent: "Couldn't read", meta: report.nyteError };

    const totals = report.entries.reduce(
      (sum, entry) => addTotals(sum, entry.totals),
      EMPTY_TOTALS,
    );

    return {
      cost: totals.cost,
      tokens: totals.tokens,
      prompt: promptTokens(totals),
      cacheRead: totals.cacheRead,
      savings: totals.cacheSavings,
      partial: report.sources.some((source) => source.status === "failed"),
    };
  }

  const history = report[tool];

  if (history.kind === "missing")
    return { absent: "Not found", meta: `No local history in ${USAGE_TOOL_HOMES[tool]}` };

  if (history.kind === "failed") return { absent: "Couldn't read", meta: history.message };

  const { total, cacheSavings } = history.summary;

  return {
    cost: total.cost.total,
    tokens: total.total,
    prompt: promptTokens(total),
    cacheRead: total.cacheRead,
    savings: cacheSavings,
    partial: coverageGaps(history).length > 0,
  };
}

export function deriveTools(report: UsageSnapshot): readonly UsageRow[] {
  const spends = USAGE_TOOLS.map((tool) => ({ tool, spend: toolSpend(report, tool) }));
  const counted = spends.flatMap(({ spend }) => ("absent" in spend ? [] : [spend]));
  const byCost = counted.some((spend) => spend.cost > 0);
  const whole = counted.reduce((sum, spend) => sum + (byCost ? spend.cost : spend.tokens), 0);

  return spends.map(({ tool, spend }): UsageRow => {
    const base = { key: tool, label: USAGE_TOOL_LABELS[tool], trend: undefined };

    if ("absent" in spend) {
      return {
        ...base,
        meta: spend.meta,
        cache: NO_CACHE,
        value: { text: spend.absent, absent: true },
        share: 0,
      };
    }

    return {
      ...base,
      meta: `${formatTokens(spend.tokens)} tokens${spend.partial ? " · partial history" : ""}`,
      cache: describeCache(spend),
      value: byCost
        ? spend.cost === 0
          ? { text: "No price", absent: true }
          : { text: formatUsd(spend.cost), absent: false }
        : { text: `${formatTokens(spend.tokens)} tokens`, absent: false },
      share: whole === 0 ? 0 : (byCost ? spend.cost : spend.tokens) / whole,
    };
  });
}

interface LimitMeter {
  readonly key: string;
  readonly label: string;
  readonly used: number;
  readonly reset: string;
}

interface AccountView {
  readonly title: string;
  readonly meters: readonly LimitMeter[];
  readonly message: string | undefined;
  readonly failed: boolean;
}

export function deriveAccount(account: ProviderUsage): AccountView | null {
  const title =
    account.account === null ? account.name : `${account.name} · ${account.account.label}`;

  if (account.state.kind === "unavailable")
    return account.state.reason === "failed"
      ? { title, meters: [], message: `${title} · ${account.state.message}`, failed: true }
      : null;

  const meters = account.state.limits
    .map((window) => ({
      key: window.label,
      label: window.label,
      used: window.limit === 0 ? 0 : Math.round((window.used / window.limit) * 100),
      reset:
        window.resetsAt === null
          ? "Reset time unknown"
          : `Resets ${new Date(window.resetsAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`,
    }))
    .toSorted((left, right) => right.used - left.used);

  return {
    title,
    meters,
    message: account.state.stale
      ? `${title} · Cached limits${account.state.error === null ? "" : ` · ${account.state.error}`}`
      : meters.length === 0
        ? `${account.name} reported no limit.`
        : undefined,
    failed: false,
  };
}
