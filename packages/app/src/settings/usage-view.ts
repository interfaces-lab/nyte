import type { ModelInfo, ProviderUsage } from "@nyte-ai/sdk";
import type { IconName } from "@nyte-ai/ui/icon";
import type { UsageSnapshot } from "../contract/bridge.ts";
import type { UsageTotals, UsageWindow } from "../contract/nyte.ts";
import { formatTokens, formatUsd, groupDigits } from "../lib/format.ts";

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

const LOW_CACHE_HIT = 0.5;

const PACE_SAMPLE_DAYS = 7;

const MIN_PACE_DAYS = 3;

export type UsageGrain = "day" | "week";

export type UsageMeasure = "cost" | "tokens";

/** Catalog list prices in dollars per 1M tokens. */
export type ListPrice = ModelInfo["cost"];

export interface CacheUse {
  readonly ratio: number | undefined;
  readonly cached: number;
  readonly uncached: number;
  readonly saved: number;
  readonly low: boolean;
}

export interface ModelUsage {
  readonly key: string;
  readonly model: string;
  readonly vendor: string;
  readonly via: string | undefined;
  readonly icon: IconName;
  readonly totals: UsageTotals;
  readonly amount: number;
  readonly share: number;
  readonly chats: number;
  readonly series: readonly number[];
  readonly perChat: { readonly cost: number; readonly tokens: number };
  readonly rate: number | undefined;
  readonly list: ListPrice | undefined;
  readonly cache: CacheUse;
}

export interface UsageSeries {
  readonly key: string;
  readonly label: string;
  /** Rank among the charted models; `undefined` for the rest folded into Other. */
  readonly rank: number | undefined;
}

export interface UsageBucket {
  readonly key: string;
  readonly label: string;
  readonly tick: string | undefined;
  readonly partial: boolean;
  readonly total: number;
  readonly values: readonly number[];
}

export interface PacePoint {
  readonly day: string;
  readonly value: number;
}

export interface UsagePace {
  readonly points: readonly PacePoint[];
  readonly forecast: PacePoint | undefined;
  readonly days: readonly string[];
}

export interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly meta: string;
  readonly icon: IconName | undefined;
  readonly share: number;
  readonly value: string;
  readonly absent: boolean;
}

export interface UsageDerived {
  readonly measure: UsageMeasure;
  readonly priced: boolean;
  readonly grain: UsageGrain;
  readonly from: string;
  readonly to: string;
  readonly totals: UsageTotals;
  readonly amount: number;
  readonly chats: number;
  readonly change: number | undefined;
  readonly models: readonly ModelUsage[];
  readonly series: readonly UsageSeries[];
  readonly buckets: readonly UsageBucket[];
  readonly average: number;
  readonly pace: UsagePace;
  readonly folders: readonly ShareRow[];
  readonly chatRows: readonly ShareRow[];
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

export function promptTokens(
  tokens: Pick<UsageTotals, "input" | "cacheRead" | "cacheWrite">,
): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

function plural(count: number, noun: string): string {
  return `${groupDigits(String(Math.round(count)))} ${noun}${count === 1 ? "" : "s"}`;
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

export function dayLabel(day: string): string {
  return new Date(dayStart(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function weekdayLabel(day: string): string {
  return new Date(dayStart(day)).toLocaleDateString(undefined, { weekday: "short" });
}

function monthLabel(day: string): string {
  return new Date(dayStart(day)).toLocaleDateString(undefined, { month: "short" });
}

function monthEnd(day: string): string {
  const date = new Date(dayStart(day));

  return localDay(new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime());
}

export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The span a window covers, for copy: "the last 30 days" or "all time". */
export function windowLabel(window: UsageWindow): string {
  return window.sinceDay === null
    ? "all time"
    : `the last ${plural(daysBetween(window.sinceDay, window.untilDay), "day")}`;
}

/** The window just before this one, for comparisons: "the prior 30 days". */
export function priorLabel(window: UsageWindow): string {
  return window.sinceDay === null
    ? "the prior period"
    : `the prior ${plural(daysBetween(window.sinceDay, window.untilDay), "day")}`;
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

function daysBetween(from: string, to: string): number {
  let span = 1;

  for (let day = from; day < to; day = shiftDay(day, 1)) span += 1;

  return span;
}

export function defaultGrain(window: UsageWindow, earliestDay: string | undefined): UsageGrain {
  const from = window.sinceDay ?? earliestDay ?? window.untilDay;

  return daysBetween(from, window.untilDay) > WEEKLY_ABOVE_DAYS ? "week" : "day";
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

export function deriveUsage({
  report,
  window,
  grain,
  measure: wanted,
  prices,
  charted,
}: {
  readonly report: UsageSnapshot;
  readonly window: UsageWindow;
  readonly grain: UsageGrain;
  readonly measure: UsageMeasure;
  readonly prices: ReadonlyMap<string, ListPrice>;
  readonly charted: number;
}): UsageDerived {
  const to = window.untilDay;
  const from = window.sinceDay ?? report.earliestDay ?? to;
  const days = daySpan(from, to);
  const offset = grain === "week" ? (new Date(dayStart(from)).getDay() + 6) % 7 : 0;

  const bucketOfIndex = (index: number): number =>
    grain === "day" ? index : Math.floor((index + offset) / 7);

  const bucketCount = bucketOfIndex(days.length - 1) + 1;
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const totals = report.entries.reduce((sum, entry) => addTotals(sum, entry.totals), EMPTY_TOTALS);
  const priced = totals.cost > 0;
  const measure: UsageMeasure = priced ? wanted : "tokens";
  const pick = (value: UsageTotals): number => (measure === "cost" ? value.cost : value.tokens);
  const amount = pick(totals);

  const perModel = new Map<
    string,
    { provider: string; model: string; totals: UsageTotals; chats: Set<string>; series: number[] }
  >();

  const whole = Array.from({ length: bucketCount }, () => 0);
  const daily = Array.from({ length: days.length }, () => 0);

  for (const entry of report.entries) {
    const index = dayIndex.get(entry.day);

    if (index === undefined) continue;
    const bucket = bucketOfIndex(index);
    const value = pick(entry.totals);
    whole[bucket] = (whole[bucket] ?? 0) + value;
    daily[index] = (daily[index] ?? 0) + value;

    if (entry.subject.kind !== "model") continue;
    const key = `${entry.subject.provider}/${entry.subject.model}`;

    const model = perModel.get(key) ?? {
      provider: entry.subject.provider,
      model: entry.subject.model,
      totals: EMPTY_TOTALS,
      chats: new Set<string>(),
      series: Array.from({ length: bucketCount }, () => 0),
    };

    model.totals = addTotals(model.totals, entry.totals);
    model.chats.add(entry.sessionId);
    model.series[bucket] = (model.series[bucket] ?? 0) + value;
    perModel.set(key, model);
  }

  const models = [...perModel]
    .map(([key, model]): ModelUsage => {
      const vendor = findVendor(model.model, model.provider);
      const provider = providerName(model.provider);
      const prompt = promptTokens(model.totals);
      const ratio = prompt === 0 ? undefined : model.totals.cacheRead / prompt;
      const chats = Math.max(model.chats.size, 1);

      return {
        key,
        model: model.model,
        vendor: vendor.name,
        via: vendor.name === provider ? undefined : provider,
        icon: vendor.icon,
        totals: model.totals,
        amount: pick(model.totals),
        share: amount === 0 ? 0 : pick(model.totals) / amount,
        chats: model.chats.size,
        series: model.series,
        perChat: { cost: model.totals.cost / chats, tokens: model.totals.tokens / chats },
        rate:
          model.totals.cost === 0 || model.totals.tokens === 0
            ? undefined
            : (model.totals.cost / model.totals.tokens) * 1_000_000,
        list: prices.get(key),
        cache: {
          ratio,
          cached: model.totals.cacheRead,
          uncached: prompt - model.totals.cacheRead,
          saved: model.totals.cacheSavings,
          low: ratio !== undefined && ratio < LOW_CACHE_HIT && model.totals.cost > 0,
        },
      };
    })
    .toSorted((left, right) => right.amount - left.amount);

  const top = models.slice(0, charted);

  const folded =
    models.length > top.length ||
    whole.some(
      (value, bucket) => value > top.reduce((sum, model) => sum + (model.series[bucket] ?? 0), 0),
    );

  const series: UsageSeries[] = [
    ...top.map((model, rank) => ({ key: model.key, label: model.model, rank })),
    ...(folded ? [{ key: "other", label: "Other", rank: undefined }] : []),
  ];

  const buckets = Array.from({ length: bucketCount }, (_slot, bucket): UsageBucket => {
    const inBucket = days.filter((_day, index) => bucketOfIndex(index) === bucket);
    const first = inBucket[0] ?? from;
    const last = inBucket.at(-1) ?? first;
    const values = top.map((model) => model.series[bucket] ?? 0);
    const total = whole[bucket] ?? 0;
    const rest = Math.max(total - values.reduce((sum, value) => sum + value, 0), 0);

    const previousFirst =
      bucket === 0 ? undefined : days.find((_day, index) => bucketOfIndex(index) === bucket - 1);

    return {
      key: first,
      label:
        grain === "day"
          ? `${weekdayLabel(first)}, ${dayLabel(first)}`
          : first === last
            ? dayLabel(first)
            : `${dayLabel(first)} – ${dayLabel(last)}`,
      tick: tickFor(first, previousFirst, grain, days.length),
      partial: last === to,
      total,
      values: folded ? [...values, rest] : values,
    };
  });

  const firstUsed = buckets.findIndex((bucket) => bucket.total > 0);

  const counted = buckets.filter(
    (bucket, index) => !bucket.partial && firstUsed !== -1 && index >= firstUsed,
  );

  const previous =
    report.previous === undefined
      ? undefined
      : measure === "cost"
        ? report.previous.cost
        : report.previous.tokens;

  return {
    measure,
    priced,
    grain,
    from,
    to,
    totals,
    amount,
    chats: new Set(report.entries.map((entry) => entry.sessionId)).size,
    change: previous === undefined || previous === 0 ? undefined : (amount - previous) / previous,
    models,
    series,
    buckets,
    average:
      counted.length === 0
        ? 0
        : counted.reduce((sum, bucket) => sum + bucket.total, 0) / counted.length,
    pace: derivePace(days, daily),
    ...deriveShares(report, measure, amount),
    unreadFolders: report.sources
      .filter((source) => source.status === "failed")
      .map((source) => folderLabel(source.workspacePath)),
  };
}

/** Calendar-aligned ticks: weekdays for a week, Mondays for a month, month starts beyond. */
function tickFor(
  first: string,
  previous: string | undefined,
  grain: UsageGrain,
  span: number,
): string | undefined {
  if (grain === "week") {
    return previous === undefined || previous.slice(0, 7) !== first.slice(0, 7)
      ? monthLabel(first)
      : undefined;
  }

  if (span <= 10) return weekdayLabel(first);

  if (span <= 45) return new Date(dayStart(first)).getDay() === 1 ? dayLabel(first) : undefined;

  return first.endsWith("-01") ? monthLabel(first) : undefined;
}

/**
 * The running total, and where it lands by the end of the month at the pace of the last full
 * week. Today is partial, so it never sets the pace, and days before the first use don't dilute it.
 */
function derivePace(days: readonly string[], daily: readonly number[]): UsagePace {
  let running = 0;

  const points = days.map((day, index) => {
    running += daily[index] ?? 0;

    return { day, value: running };
  });

  const today = days.at(-1);
  const firstUsed = daily.findIndex((value) => value > 0);
  const sample = daily.slice(Math.max(firstUsed, daily.length - 1 - PACE_SAMPLE_DAYS), -1);

  if (today === undefined || firstUsed === -1 || sample.length < MIN_PACE_DAYS) {
    return { points, forecast: undefined, days };
  }

  const end = monthEnd(today) === today ? shiftDay(today, PACE_SAMPLE_DAYS) : monthEnd(today);
  const ahead = daySpan(shiftDay(today, 1), end);
  const perDay = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  const todaySoFar = daily.at(-1) ?? 0;
  const value = running + Math.max(perDay - todaySoFar, 0) + perDay * ahead.length;

  return { points, forecast: { day: end, value }, days: [...days, ...ahead] };
}

function deriveShares(
  report: UsageSnapshot,
  measure: UsageMeasure,
  amount: number,
): Pick<UsageDerived, "folders" | "chatRows"> {
  const perFolder = new Map<
    string,
    { path: string | null; totals: UsageTotals; chats: Set<string> }
  >();

  const perChat = new Map<string, UsageTotals>();

  for (const entry of report.entries) {
    const key = entry.workspacePath ?? "";

    const folder = perFolder.get(key) ?? {
      path: entry.workspacePath,
      totals: EMPTY_TOTALS,
      chats: new Set<string>(),
    };

    folder.totals = addTotals(folder.totals, entry.totals);
    folder.chats.add(entry.sessionId);
    perFolder.set(key, folder);

    perChat.set(
      entry.sessionId,
      addTotals(perChat.get(entry.sessionId) ?? EMPTY_TOTALS, entry.totals),
    );
  }

  const leaves = new Map<string, number>();

  for (const folder of perFolder.values()) {
    const leaf = folderLabel(folder.path);
    leaves.set(leaf, (leaves.get(leaf) ?? 0) + 1);
  }

  const row = (
    key: string,
    label: string,
    meta: string,
    totals: UsageTotals,
    icon: IconName | undefined,
  ): ShareRow => ({
    key,
    label,
    meta,
    icon,
    share: amount === 0 ? 0 : (measure === "cost" ? totals.cost : totals.tokens) / amount,
    ...shareValue(totals, measure),
  });

  const ranked = (rows: readonly ShareRow[]) =>
    rows.toSorted((left, right) => right.share - left.share);

  return {
    folders: ranked(
      [...perFolder].map(([key, folder]) => {
        const leaf = folderLabel(folder.path);
        const parent = (leaves.get(leaf) ?? 0) > 1 ? folderParent(folder.path) : undefined;

        return row(
          key,
          parent === undefined ? leaf : `${leaf} in ${parent}`,
          `${plural(folder.chats.size, "chat")} · ${formatTokens(folder.totals.tokens)} tokens`,
          folder.totals,
          folder.path === null ? "laptop" : "folder",
        );
      }),
    ),
    chatRows: ranked(
      report.sessions.flatMap((session) => {
        const totals = perChat.get(session.sessionId);
        const name = session.name?.trim();

        return totals === undefined
          ? []
          : [
              row(
                session.sessionId,
                name === undefined || name === "" ? "Untitled chat" : name,
                `${folderLabel(session.workspacePath)} · ${formatTokens(totals.tokens)} tokens`,
                totals,
                undefined,
              ),
            ];
      }),
    ),
  };
}

function shareValue(
  totals: Pick<UsageTotals, "cost" | "tokens">,
  measure: UsageMeasure,
): Pick<ShareRow, "value" | "absent"> {
  if (measure === "tokens")
    return { value: `${formatTokens(totals.tokens)} tokens`, absent: false };

  return totals.cost === 0
    ? { value: "No price", absent: true }
    : { value: formatUsd(totals.cost), absent: false };
}

export function describeEmptyRange(
  report: UsageSnapshot,
  unreadFolders: readonly string[],
  window: UsageWindow,
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
      title: "No usage yet",
      body: "Start a chat in Nyte and its spend shows up here.",
      offerAllTime: false,
    };
  }

  return {
    title: `Nothing in ${windowLabel(window)}`,
    body: `Earliest recorded usage: ${dayLabel(earliest)}.`,
    offerAllTime: window.sinceDay !== null,
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

const USAGE_TOOL_ICONS: Readonly<Record<UsageTool, IconName>> = {
  nyte: "nyte",
  claudeCode: "provider-claude-code",
  codex: "provider-openai-codex",
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
  | { readonly cost: number; readonly tokens: number; readonly partial: boolean }
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
      partial: report.sources.some((source) => source.status === "failed"),
    };
  }

  const history = report[tool];

  if (history.kind === "missing")
    return { absent: "Not found", meta: `No local history in ${USAGE_TOOL_HOMES[tool]}` };

  if (history.kind === "failed") return { absent: "Couldn't read", meta: history.message };

  return {
    cost: history.summary.total.cost.total,
    tokens: history.summary.total.total,
    partial: coverageGaps(history).length > 0,
  };
}

/** Nyte beside the agents whose local history this Mac keeps, by the same measure. */
export function deriveTools(report: UsageSnapshot): readonly ShareRow[] {
  const spends = USAGE_TOOLS.map((tool) => ({ tool, spend: toolSpend(report, tool) }));
  const counted = spends.flatMap(({ spend }) => ("absent" in spend ? [] : [spend]));
  const measure: UsageMeasure = counted.some((spend) => spend.cost > 0) ? "cost" : "tokens";

  const pick = (spend: { readonly cost: number; readonly tokens: number }) =>
    measure === "cost" ? spend.cost : spend.tokens;

  const whole = counted.reduce((sum, spend) => sum + pick(spend), 0);

  return spends.map(({ tool, spend }): ShareRow => {
    const base = { key: tool, label: USAGE_TOOL_LABELS[tool], icon: USAGE_TOOL_ICONS[tool] };

    if ("absent" in spend) {
      return { ...base, meta: spend.meta, share: 0, value: spend.absent, absent: true };
    }

    return {
      ...base,
      meta: `${formatTokens(spend.tokens)} tokens${spend.partial ? " · partial history" : ""}`,
      share: whole === 0 ? 0 : pick(spend) / whole,
      ...(spend.tokens === 0 ? { value: "No usage", absent: true } : shareValue(spend, measure)),
    };
  });
}

/** The lab of a model, read from its id, so a model served through a gateway keeps its own mark. */
const VENDORS: readonly {
  readonly prefix: RegExp;
  readonly name: string;
  readonly icon: IconName;
}[] = [
  { prefix: /^claude/u, name: "Anthropic", icon: "model-anthropic" },
  { prefix: /^(gpt|o\d|codex)/u, name: "OpenAI", icon: "model-openai" },
  { prefix: /^gemini/u, name: "Google", icon: "model-gemini" },
  { prefix: /^kimi/u, name: "Moonshot", icon: "model-kimi" },
  { prefix: /^glm/u, name: "Zhipu", icon: "model-zai" },
  { prefix: /^deepseek/u, name: "DeepSeek", icon: "model-deepseek" },
  { prefix: /^minimax/u, name: "MiniMax", icon: "model-minimax" },
  { prefix: /^qwen/u, name: "Alibaba", icon: "model-qwen" },
  { prefix: /^(devstral|mistral|codestral)/u, name: "Mistral", icon: "model-mistral" },
  { prefix: /^grok/u, name: "xAI", icon: "grok" },
];

const PROVIDER_NAMES = new Map([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["openai-codex", "ChatGPT"],
  ["opencode", "OpenCode"],
  ["opencode-go", "OpenCode"],
  ["openrouter", "OpenRouter"],
  ["github-copilot", "Copilot"],
  ["vercel-ai-gateway", "Vercel"],
]);

function providerName(provider: string): string {
  return PROVIDER_NAMES.get(provider) ?? provider;
}

function findVendor(
  model: string,
  provider: string,
): { readonly name: string; readonly icon: IconName } {
  const id = model.split("/").at(-1) ?? model;

  return (
    VENDORS.find((vendor) => vendor.prefix.test(id)) ?? {
      name: providerName(provider),
      icon: "model-generic",
    }
  );
}

export interface LimitMeter {
  readonly key: string;
  readonly label: string;
  readonly used: number;
  readonly resetsIn: string;
  readonly resetsAt: string;
}

export interface AccountLimits {
  readonly key: string;
  readonly provider: string;
  readonly name: string;
  readonly account: string | undefined;
  readonly meters: readonly LimitMeter[];
  readonly message: string | undefined;
  readonly failed: boolean;
}

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

function formatResetsIn(at: number, now: number): string {
  const left = at - now;

  if (left < MINUTE_MS) return "now";
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS);

  if (days > 0) return hours === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours)}h`;

  if (hours > 0)
    return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;

  return `${String(minutes)}m`;
}

export function deriveAccount(usage: ProviderUsage, now: number): AccountLimits | null {
  const base = {
    key: usage.provider,
    provider: usage.provider,
    name: usage.name,
    account: usage.account?.label,
  };

  if (usage.state.kind === "unavailable")
    return usage.state.reason === "failed"
      ? { ...base, meters: [], message: usage.state.message, failed: true }
      : null;

  const meters = usage.state.limits.map((window) => ({
    key: window.label,
    label: window.label,
    used: window.limit === 0 ? 0 : Math.round((window.used / window.limit) * 100),
    resetsIn: window.resetsAt === null ? "" : formatResetsIn(window.resetsAt, now),
    resetsAt:
      window.resetsAt === null
        ? "Reset time unknown"
        : `Resets ${new Date(window.resetsAt).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}`,
  }));

  return {
    ...base,
    meters,
    message: usage.state.stale
      ? `Showing cached limits${usage.state.error === null ? "." : `: ${usage.state.error}`}`
      : meters.length === 0
        ? "No limits reported."
        : undefined,
    failed: false,
  };
}
