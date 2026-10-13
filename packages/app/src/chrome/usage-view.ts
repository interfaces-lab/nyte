/**
 * Settings › Usage derives every list on the page from one flat report.
 *
 * The report is the whole history; the range is a window onto it. A host read
 * walks every stored commit no matter which window it is asked for, so reading
 * per range bought nothing and charged a full re-read for every press. One read
 * answers all four ranges, and a range press is arithmetic.
 *
 * Within a window every list is the same cells summed along a different axis,
 * so any two of them agree. Chats rank on their spend inside the window like
 * folders and models do, which is why the page needs no note explaining that
 * they do not.
 *
 * Everything leaves here formatted. One row shape carries every ranked list on
 * the page, so the renderer picks no numbers apart and the wording of a row is
 * something a test can read.
 *
 * The host folds days in its own time zone; the renderer shares the machine,
 * so `localDay` here is the same calendar as the one that wrote the report.
 */
import type { SessionId } from "@nyte-ai/sdk";
import type { ModelCatalogView } from "@nyte-ai/sdk";
import type { UsageSnapshot } from "../bridge.ts";
import type { UsageReport, UsageTotals, UsageWindow } from "../nyte.ts";

/**
 * Past this a report is old enough that the query fetches again when the page
 * is opened. The limit windows share it, so "current" means one thing here.
 */
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

/** Past this many days a per-day point is noise, so the series buckets by week. */
const WEEKLY_ABOVE_DAYS = 120;

type UsageGrain = "day" | "week";

/** One bar of the trend: when it is, and the window's measure in it. */
export interface UsagePoint {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * One ranked row, formatted. `value.absent` says why there is no amount rather
 * than printing `$0.00`, because a history nobody could read is not free usage.
 */
export interface UsageRow {
  readonly key: string;
  readonly label: string;
  readonly meta: string;
  readonly turns: string;
  readonly perTurn: string;
  /** The row's measure per bucket of the window, or undefined when its history has no days. */
  readonly trend: readonly number[] | undefined;
  readonly value: { readonly text: string; readonly absent: boolean };
  /** Of the window's cost, or of its tokens when nothing in it was priced. */
  readonly share: number;
}

/** Cost while anything in the window is priced; a free local model still has tokens. */
export type UsageMeasure = "cost" | "tokens";

export interface UsageDerived {
  readonly grain: UsageGrain;
  readonly measure: UsageMeasure;
  readonly from: string;
  readonly to: string;
  readonly points: readonly UsagePoint[];
  readonly totals: UsageTotals;
  /** The window of equal length before this one, when history reached that far. */
  readonly previousCost: number | undefined;
  readonly models: readonly UsageRow[];
  readonly folders: readonly UsageRow[];
  readonly chats: readonly UsageRow[];
  /** Folders whose read failed, so their spend is missing from every total. */
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
  turns: 0,
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
    turns: left.turns + right.turns,
  };
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** Dollars with cents, so a column of spend lines up on the decimal. */
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

function formatCount(value: number): string {
  return group(String(Math.round(value)));
}

export function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%";

  if (fraction < 0.01) return "<1%";

  return `${String(Math.round(fraction * 100))}%`;
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** `YYYY-MM-DD` for a local day, matching the calendar the host folded with. */
export function localDay(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** Local midnight, so the arithmetic below stays on calendar days across a DST shift. */
export function dayStart(day: string): number {
  return new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  ).getTime();
}

export function shiftDay(day: string, delta: number): string {
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

/** The window's days as a heading: one day, or the first and last. */
export function spanLabel(from: string, to: string): string {
  return from === to ? dayLabel(to) : `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** When a read happened, stated absolutely so the page needs no ticking clock. */
export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * How this window compares with the one before it. An empty previous window
 * has no rate of change to report, only the fact that everything here is new.
 */
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

/** The line under the total: what the window holds besides its cost. */
export function describeTotals(totals: UsageTotals): string {
  return `${plural(totals.turns, "turn")} · ${formatTokens(totals.tokens)} tokens`;
}

/** Cache reads as a share of all prompt tokens, including newly written entries. */
function cachedShare(spend: Spend): string {
  return spend.prompt === 0
    ? "not cached"
    : `${formatPercent(spend.cacheRead / spend.prompt)} cached`;
}

// ---------------------------------------------------------------------------
// the window
// ---------------------------------------------------------------------------

/** The window a range asks the host for. `all` cannot name its own start. */
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

/** Inclusive day count, which is also how far back the comparison reaches. */
function daysBetween(from: string, to: string): number {
  let span = 1;

  for (let day = from; day < to; day = shiftDay(day, 1)) span += 1;

  return span;
}

/**
 * The window of equal length before this one. `All time` has no length of its
 * own and so has nothing to compare against.
 */
function priorWindow(
  from: string,
  to: string,
  bounded: boolean,
): { readonly from: string; readonly to: string } | undefined {
  if (!bounded) return undefined;
  const priorTo = shiftDay(from, -1);

  return { from: shiftDay(priorTo, -(daysBetween(from, to) - 1)), to: priorTo };
}

/** The last path segment, which is what a person calls the folder. */
function folderLabel(path: string | null): string {
  if (path === null) return "Home";
  const segments = path.split("/").filter((segment) => segment !== "");

  return segments.at(-1) ?? path;
}

/** The segment above the leaf, which is what tells two `api` folders apart. */
function folderParent(path: string | null): string | undefined {
  if (path === null) return undefined;
  const segments = path.split("/").filter((segment) => segment !== "");

  return segments.at(-2);
}

function chatLabel(name: string | undefined): string {
  const trimmed = name?.trim();

  return trimmed === undefined || trimmed === "" ? "Untitled chat" : trimmed;
}

/** What one row spent in the window, in total and per bucket. */
interface Spend {
  cost: number;
  tokens: number;
  turns: number;
  cacheRead: number;
  prompt: number;
  readonly costs: number[];
  readonly tokensBy: number[];
}

function emptySpend(buckets: number): Spend {
  return {
    cost: 0,
    tokens: 0,
    turns: 0,
    cacheRead: 0,
    prompt: 0,
    costs: Array.from({ length: buckets }, () => 0),
    tokensBy: Array.from({ length: buckets }, () => 0),
  };
}

function addSpend(spend: Spend, totals: UsageTotals, bucket: number): void {
  spend.cost += totals.cost;
  spend.tokens += totals.tokens;
  spend.turns += totals.turns;
  spend.cacheRead += totals.cacheRead;
  spend.prompt += totals.input + totals.cacheRead + totals.cacheWrite;
  spend.costs[bucket] = (spend.costs[bucket] ?? 0) + totals.cost;
  spend.tokensBy[bucket] = (spend.tokensBy[bucket] ?? 0) + totals.tokens;
}

function perTurn(cost: number, turns: number): string {
  return cost > 0 && turns > 0 ? formatUsd(cost / turns) : "—";
}

/**
 * Group the cells of one window into every list the page draws.
 *
 * `window` is the range the reader picked; `report` is everything the host
 * read. A window that reaches back before the first recorded day still spans
 * the days it asked for: the range is a question about a period, and an idle
 * stretch inside it is an answer, not an absence to be cropped away.
 */
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

  // Rank by cost while anything is priced; a free local model still ranks by tokens.
  const measure: UsageMeasure = totals.cost > 0 ? "cost" : "tokens";
  const wholeAmount = measure === "cost" ? totals.cost : totals.tokens;

  const row = (key: string, label: string, meta: string, spend: Spend): UsageRow => ({
    key,
    label,
    meta,
    turns: formatCount(spend.turns),
    perTurn: perTurn(spend.cost, spend.turns),
    // An unpriced row still has a shape: its tokens. It is never a chart layer.
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

  // Two checkouts can end in the same directory name, so a repeated leaf earns
  // the segment above it. Unique names stay short.
  const leafCounts = new Map<string, number>();

  for (const folder of perFolder.values()) {
    const leaf = folderLabel(folder.path);
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }

  const models = [...perModel].map(([key, model]) =>
    row(
      key,
      model.model,
      `${model.provider} · ${formatTokens(model.spend.tokens)} tokens · ${cachedShare(model.spend)}`,
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
          `${formatTokens(folder.spend.tokens)} tokens · ${cachedShare(folder.spend)}`,
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

/** Why a window holds nothing, and whether all time would hold something. */
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

// ---------------------------------------------------------------------------
// the other tools
// ---------------------------------------------------------------------------

/**
 * The tools whose local history the page reads, in the order their rows sit.
 * Claude Code and Codex fold whole histories with no days, so the comparison
 * across tools is all-time and Nyte joins it with its all-time sum.
 */
const USAGE_TOOLS = ["nyte", "claudeCode", "codex"] as const;

type UsageTool = (typeof USAGE_TOOLS)[number];

type LocalTool = Exclude<UsageTool, "nyte">;

const USAGE_TOOL_LABELS: Readonly<Record<UsageTool, string>> = {
  nyte: "Nyte",
  claudeCode: "Claude Code",
  codex: "Codex",
};

/** Where each tool's history lives, for the row that found none. */
const USAGE_TOOL_HOMES: Readonly<Record<LocalTool, string>> = {
  claudeCode: "CLAUDE_CONFIG_DIR or ~/.claude",
  codex: "CODEX_HOME or ~/.codex",
};

type LocalHistory = UsageSnapshot["claudeCode"];

/** What a history left out. Unpriced records still count toward tokens. */
function coverageGaps(usage: Extract<LocalHistory, { kind: "ready" }>): readonly string[] {
  return [
    usage.malformedRecords > 0 && plural(usage.malformedRecords, "malformed record"),
    usage.unreadableFiles > 0 && plural(usage.unreadableFiles, "unreadable file"),
    usage.unpricedRecords > 0 && plural(usage.unpricedRecords, "unpriced record"),
  ].filter((gap) => gap !== false);
}

/** What one tool spent all time, or the sentence explaining why it is unknown. */
type ToolSpend =
  | {
      readonly cost: number;
      readonly tokens: number;
      readonly turns: number;
      readonly partial: boolean;
    }
  | { readonly absent: string; readonly meta: string };

function toolSpend(report: UsageSnapshot, tool: UsageTool): ToolSpend {
  if (tool === "nyte") {
    if (report.nyteError !== null) return { absent: "Couldn't read", meta: report.nyteError };

    return {
      ...report.entries.reduce(
        (sum, entry) => ({
          cost: sum.cost + entry.totals.cost,
          tokens: sum.tokens + entry.totals.tokens,
          turns: sum.turns + entry.totals.turns,
        }),
        { cost: 0, tokens: 0, turns: 0 },
      ),
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
    turns: history.summary.models.reduce((sum, model) => sum + model.turns, 0),
    partial: coverageGaps(history).length > 0,
  };
}

/** Every tool's all-time spend against the sum of them, so a share means one thing. */
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
        turns: "—",
        perTurn: "—",
        value: { text: spend.absent, absent: true },
        share: 0,
      };
    }

    return {
      ...base,
      meta: `${formatTokens(spend.tokens)} tokens${spend.partial ? " · partial history" : ""}`,
      turns: formatCount(spend.turns),
      perTurn: perTurn(spend.cost, spend.turns),
      value: byCost
        ? spend.cost === 0
          ? { text: "No price", absent: true }
          : { text: formatUsd(spend.cost), absent: false }
        : { text: `${formatTokens(spend.tokens)} tokens`, absent: false },
      share: whole === 0 ? 0 : (byCost ? spend.cost : spend.tokens) / whole,
    };
  });
}

// ---------------------------------------------------------------------------
// subscription windows
// ---------------------------------------------------------------------------

/** The windows one provider reported on its last response, as the catalog carries them. */
export interface AccountLimits {
  readonly provider: string;
  readonly name: string;
  readonly limits: ModelCatalogView["providers"][number]["limits"];
}

/** One window's meter: how much is gone, and when it comes back. */
export interface LimitMeter {
  readonly key: string;
  readonly label: string;
  /** Whole percent, which is the precision every provider reports in practice. */
  readonly used: number;
  readonly reset: string;
}

interface AccountView {
  readonly title: string;
  readonly meters: readonly LimitMeter[];
  /** Set instead of meters, saying why the provider gave none. */
  readonly message: string | undefined;
  readonly failed: boolean;
}

/** A provider's own windows, as it labels them, most used first. */
export function deriveAccount(account: AccountLimits): AccountView {
  const meters = account.limits
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

  return meters.length === 0
    ? { title: account.name, meters, message: `${account.name} reported no limit.`, failed: false }
    : { title: account.name, meters, message: undefined, failed: false };
}
