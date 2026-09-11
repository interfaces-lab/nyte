/**
 * Settings › Usage derives every card from one flat report.
 *
 * The report is the whole history; the range is a window onto it. A host read
 * walks every stored commit no matter which window it is asked for, so reading
 * per range bought nothing and charged a full re-read for every press. One read
 * answers all four ranges, and a range press is arithmetic.
 *
 * Within a window each card is the same cells summed along a different axis, so
 * any two cards agree. Chats rank on their spend inside the window like folders
 * and models do, which is why the page needs no note explaining that they do
 * not.
 *
 * The host folds days in its own time zone; the renderer shares the machine,
 * so `localDay` here is the same calendar as the one that wrote the report.
 */
import type { SessionId } from "@nyte-ai/core";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import type { UsageReport, UsageTotals, UsageWindow } from "../nyte.ts";

/**
 * Past this a report is old enough that the page offers to re-read it, and old
 * enough for the query to fetch again. One threshold, so the notice and the
 * refetch never disagree about what "current" means.
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

/** Past this many days a per-day bar is a hairline, so the series buckets by week. */
const WEEKLY_ABOVE_DAYS = 120;
/** A heatmap reads as a calendar for about a year; older days scroll off it. */
const CALENDAR_DAYS = 371;

export const TOKEN_KINDS = ["input", "output", "cacheRead", "cacheWrite"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const TOKEN_KIND_LABELS: Readonly<Record<TokenKind, string>> = {
  input: "Input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
};

export type UsageGrain = "day" | "week";

/**
 * One bucket of the time series. Declared as a type alias, not an interface,
 * so it carries the implicit index signature nivo's `BarDatum` asks for.
 */
export type UsagePoint = {
  /** The bucket's first day, `YYYY-MM-DD`. Doubles as the bar's index. */
  readonly key: string;
  readonly label: string;
  readonly cost: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly tokens: number;
};

export interface UsageModelRow {
  readonly key: string;
  readonly model: string;
  readonly provider: string;
  readonly cost: number;
  readonly tokens: number;
  readonly turns: number;
  /** Of the window's cost, or of its tokens when nothing was priced. */
  readonly share: number;
}

export interface UsageFolderRow {
  readonly key: string;
  readonly path: string | null;
  readonly label: string;
  /** The parent folder, shown only when another row shares this row's name. */
  readonly qualifier: string | undefined;
  readonly cost: number;
  readonly tokens: number;
  readonly share: number;
}

export interface UsageChatRow {
  readonly sessionId: SessionId;
  readonly label: string;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
  readonly cost: number;
  readonly tokens: number;
  readonly share: number;
}

export interface UsageCalendar {
  readonly from: string;
  readonly to: string;
  readonly data: readonly { readonly day: string; readonly value: number }[];
}

export interface UsageDerived {
  readonly grain: UsageGrain;
  readonly from: string;
  readonly to: string;
  readonly points: readonly UsagePoint[];
  readonly calendar: UsageCalendar;
  readonly totals: UsageTotals;
  /** The window of equal length before this one, when history reached that far. */
  readonly previousCost: number | undefined;
  readonly models: readonly UsageModelRow[];
  readonly folders: readonly UsageFolderRow[];
  readonly chats: readonly UsageChatRow[];
  /** Spend with no model of its own: compaction summaries and tool executions. */
  readonly overheadCost: number;
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

function daySpan(from: string, to: string): readonly string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

export function dayLabel(day: string): string {
  return new Date(dayStart(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function bucketLabel(first: string, last: string, grain: UsageGrain): string {
  return grain === "day" ? dayLabel(first) : `${dayLabel(first)} – ${dayLabel(last)}`;
}

/** The window a range asks the host for. `all` cannot name its own start. */
export function usageWindow(range: UsageRange, now: number): UsageWindow {
  const untilDay = localDay(now);
  return {
    sinceDay: range === "all" ? null : shiftDay(untilDay, -(RANGE_LENGTHS[range] - 1)),
    untilDay,
  };
}

/** The last path segment, which is what a person calls the folder. */
export function folderLabel(path: string | null): string {
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

export function chatLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === "" ? "Untitled chat" : trimmed;
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

/**
 * Group the cells of one window into every shape the page draws.
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

  const perDay = new Map<string, UsageTotals>();
  const perModel = new Map<string, UsageModelRow>();
  const perFolder = new Map<string, UsageFolderRow>();
  const perChat = new Map<SessionId, { cost: number; tokens: number }>();
  let totals = EMPTY_TOTALS;
  let overheadCost = 0;

  let priorCost = 0;
  let sawPrior = false;

  for (const entry of report.entries) {
    if (prior !== undefined && entry.day >= prior.from && entry.day <= prior.to) {
      sawPrior = true;
      priorCost += entry.totals.cost;
    }
    if (entry.day < from || entry.day > to) continue;

    totals = addTotals(totals, entry.totals);
    perDay.set(entry.day, addTotals(perDay.get(entry.day) ?? EMPTY_TOTALS, entry.totals));

    const folderKey = entry.workspacePath ?? "";
    const folder = perFolder.get(folderKey);
    perFolder.set(folderKey, {
      key: folderKey,
      path: entry.workspacePath,
      label: folderLabel(entry.workspacePath),
      qualifier: undefined,
      cost: (folder?.cost ?? 0) + entry.totals.cost,
      tokens: (folder?.tokens ?? 0) + entry.totals.tokens,
      share: 0,
    });

    const chat = perChat.get(entry.sessionId);
    perChat.set(entry.sessionId, {
      cost: (chat?.cost ?? 0) + entry.totals.cost,
      tokens: (chat?.tokens ?? 0) + entry.totals.tokens,
    });

    if (entry.subject.kind !== "model") {
      overheadCost += entry.totals.cost;
      continue;
    }
    const modelKey = JSON.stringify([entry.subject.provider, entry.subject.model]);
    const model = perModel.get(modelKey);
    perModel.set(modelKey, {
      key: modelKey,
      model: entry.subject.model,
      provider: entry.subject.provider,
      cost: (model?.cost ?? 0) + entry.totals.cost,
      tokens: (model?.tokens ?? 0) + entry.totals.tokens,
      turns: (model?.turns ?? 0) + entry.totals.turns,
      share: 0,
    });
  }

  // Rank by cost while anything is priced; a free local model still ranks by tokens.
  const byCost = totals.cost > 0;
  const shareOf = (cost: number, tokens: number): number => {
    const part = byCost ? cost : tokens;
    const whole = byCost ? totals.cost : totals.tokens;
    return whole === 0 ? 0 : part / whole;
  };
  const rank = (
    left: { readonly cost: number; readonly tokens: number },
    right: { readonly cost: number; readonly tokens: number },
  ): number => right.cost - left.cost || right.tokens - left.tokens;

  const bucketSize = grain === "day" ? 1 : 7;
  const points: UsagePoint[] = [];
  for (let index = 0; index < days.length; index += bucketSize) {
    const bucket = days.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket.at(-1);
    if (first === undefined || last === undefined) continue;
    const summed = bucket.reduce(
      (running, day) => addTotals(running, perDay.get(day) ?? EMPTY_TOTALS),
      EMPTY_TOTALS,
    );
    points.push({
      key: first,
      label: bucketLabel(first, last, grain),
      cost: summed.cost,
      input: summed.input,
      output: summed.output,
      cacheRead: summed.cacheRead,
      cacheWrite: summed.cacheWrite,
      tokens: summed.tokens,
    });
  }

  const calendarFrom = days.length > CALENDAR_DAYS ? shiftDay(to, -(CALENDAR_DAYS - 1)) : from;
  const calendar: UsageCalendar = {
    from: calendarFrom,
    to,
    data: [...perDay]
      .filter(([day, spent]) => day >= calendarFrom && spent.tokens > 0)
      .map(([day, spent]) => ({ day, value: spent.tokens }))
      .toSorted((left, right) => left.day.localeCompare(right.day)),
  };

  // Two checkouts can end in the same directory name, so a repeated leaf earns
  // the segment above it. Unique names stay short.
  const leafCounts = new Map<string, number>();
  for (const folder of perFolder.values()) {
    leafCounts.set(folder.label, (leafCounts.get(folder.label) ?? 0) + 1);
  }

  const chats: UsageChatRow[] = [];
  for (const session of report.sessions) {
    const spent = perChat.get(session.sessionId);
    if (spent === undefined) continue;
    chats.push({
      sessionId: session.sessionId,
      label: chatLabel(session.name),
      workspacePath: session.workspacePath,
      lastActivityAt: session.lastActivityAt,
      cost: spent.cost,
      tokens: spent.tokens,
      share: shareOf(spent.cost, spent.tokens),
    });
  }

  return {
    grain,
    from,
    to,
    points,
    calendar,
    totals,
    previousCost: sawPrior ? priorCost : undefined,
    models: [...perModel.values()]
      .toSorted(rank)
      .map((model) => ({ ...model, share: shareOf(model.cost, model.tokens) })),
    folders: [...perFolder.values()].toSorted(rank).map((folder) => ({
      ...folder,
      qualifier: (leafCounts.get(folder.label) ?? 0) > 1 ? folderParent(folder.path) : undefined,
      share: shareOf(folder.cost, folder.tokens),
    })),
    chats: chats.toSorted(
      (left, right) => rank(left, right) || right.lastActivityAt - left.lastActivityAt,
    ),
    overheadCost,
    unreadFolders: report.sources
      .filter((source) => source.status === "failed")
      .map((source) => folderLabel(source.workspacePath)),
  };
}

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

/**
 * Short enough for an axis tick: `$0`, `$12`, `$1.2k`. Sub-dollar ticks carry
 * enough decimals to stay distinct, since a low-spend axis would otherwise
 * label four different gridlines `$0.00`.
 */
export function formatUsdCompact(dollars: number): string {
  if (dollars === 0) return "$0";
  if (dollars < 0.001) return "<$0.001";
  if (dollars < 0.01) return `$${dollars.toFixed(3)}`;
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  if (dollars < 1_000) return `$${String(Math.round(dollars))}`;
  return `$${(dollars / 1_000).toFixed(1)}k`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}K`;
  if (tokens < 1_000_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 2 : 1)}M`;
  return `${(tokens / 1_000_000_000).toFixed(2)}B`;
}

export function formatCount(value: number): string {
  return group(String(Math.round(value)));
}

export function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%";
  if (fraction < 0.01) return "<1%";
  return `${String(Math.round(fraction * 100))}%`;
}

/**
 * How this window compares with the one before it. An empty previous window
 * has no rate of change to report, only the fact that everything here is new.
 */
export function costChange(
  current: number,
  previous: number | undefined,
): { readonly direction: "up" | "down" | "flat"; readonly label: string } | undefined {
  if (previous === undefined) return undefined;
  if (previous === 0) return current === 0 ? undefined : { direction: "up", label: "New" };
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return { direction: "flat", label: "No change" };
  return {
    direction: change > 0 ? "up" : "down",
    label: `${change > 0 ? "+" : "−"}${formatPercent(Math.abs(change))}`,
  };
}

/** Cache reads as a share of all prompt tokens, including newly written cache entries. */
export function cacheHitRate(totals: UsageTotals): number {
  const read = totals.input + totals.cacheRead + totals.cacheWrite;
  return read === 0 ? 0 : totals.cacheRead / read;
}

/**
 * The tools whose local history the page reads, in the order their rows sit.
 * Claude Code and Codex fold whole histories with no days, so the comparison
 * across tools is all-time and Nyte joins it with its all-time sum.
 */
export const USAGE_TOOLS = ["nyte", "claudeCode", "codex"] as const;
export type UsageTool = (typeof USAGE_TOOLS)[number];

export const USAGE_TOOL_LABELS: Readonly<Record<UsageTool, string>> = {
  nyte: "Nyte",
  claudeCode: "Claude Code",
  codex: "Codex",
};

/** Where each tool's history lives, for the row that found none. */
export const USAGE_TOOL_HOMES: Readonly<Record<Exclude<UsageTool, "nyte">, string>> = {
  claudeCode: "CLAUDE_CONFIG_DIR or ~/.claude",
  codex: "CODEX_HOME or ~/.codex",
};

export type ToolSpend =
  | {
      readonly tool: UsageTool;
      readonly kind: "ready";
      readonly cost: number;
      readonly tokens: number;
      /** Of the total across tools; by tokens when nothing anywhere was priced. */
      readonly share: number;
      /** Some history was skipped or unpriced, so the numbers are a floor. */
      readonly partial: boolean;
    }
  | { readonly tool: Exclude<UsageTool, "nyte">; readonly kind: "missing" }
  | { readonly tool: UsageTool; readonly kind: "failed"; readonly message: string };

export interface ToolsDerived {
  readonly cost: number;
  readonly tokens: number;
  readonly tools: readonly ToolSpend[];
  /** Every tool that answered, so the total can say what it is a total of. */
  readonly counted: number;
}

function localHistorySpend(
  tool: Exclude<UsageTool, "nyte">,
  usage: UsageSnapshot["claudeCode"],
): ToolSpend {
  if (usage.kind !== "ready") return { tool, ...usage };
  return {
    tool,
    kind: "ready",
    cost: usage.summary.total.cost.total,
    tokens: usage.summary.total.totalTokens,
    share: 0,
    partial: usage.unpricedRecords > 0 || usage.malformedRecords > 0 || usage.unreadableFiles > 0,
  };
}

/** Every tool's all-time spend against the sum of them, so a row's share means one thing. */
export function deriveTools(report: UsageSnapshot): ToolsDerived {
  const nyte: ToolSpend =
    report.nyteError !== null
      ? { tool: "nyte", kind: "failed", message: report.nyteError }
      : {
          tool: "nyte",
          kind: "ready",
          cost: report.entries.reduce((sum, entry) => sum + entry.totals.cost, 0),
          tokens: report.entries.reduce((sum, entry) => sum + entry.totals.tokens, 0),
          share: 0,
          partial: report.sources.some((source) => source.status === "failed"),
        };
  const unshared = [
    nyte,
    localHistorySpend("claudeCode", report.claudeCode),
    localHistorySpend("codex", report.codex),
  ];
  const ready = unshared.filter((spend) => spend.kind === "ready");
  const cost = ready.reduce((sum, spend) => sum + spend.cost, 0);
  const tokens = ready.reduce((sum, spend) => sum + spend.tokens, 0);
  const byCost = cost > 0;
  const whole = byCost ? cost : tokens;
  return {
    cost,
    tokens,
    counted: ready.length,
    tools: unshared.map((spend) =>
      spend.kind === "ready"
        ? { ...spend, share: whole === 0 ? 0 : (byCost ? spend.cost : spend.tokens) / whole }
        : spend,
    ),
  };
}
