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
import type { SessionId } from "@nyte-ai/core";
import type { AccountUsage, UsageSnapshot } from "../../../shared/ipc.ts";
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

/** One bucket of the trend: when it is, and what it cost. */
interface UsagePoint {
  readonly label: string;
  readonly cost: number;
}

/**
 * One ranked row, formatted. `value` says why there is no amount rather than
 * printing `$0.00`, because a history nobody could read is not free usage.
 */
export interface UsageRow {
  readonly key: string;
  readonly label: string;
  readonly meta: string;
  readonly value:
    | { readonly kind: "cost"; readonly text: string }
    | { readonly kind: "absent"; readonly text: string };
  /** Of the window's cost, or of its tokens when nothing in it was priced. */
  readonly share: number;
}

export interface UsageDerived {
  readonly grain: UsageGrain;
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

/** Cache reads as a share of all prompt tokens, including newly written entries. */
function cacheHitRate(totals: UsageTotals): number {
  const read = totals.input + totals.cacheRead + totals.cacheWrite;
  return read === 0 ? 0 : totals.cacheRead / read;
}

/** The sentence under a total: what the number is, and what it is made of. */
export function describeTotals(totals: UsageTotals): string {
  return `API estimate · ${formatTokens(totals.tokens)} tokens · ${plural(totals.turns, "request")} · ${formatPercent(cacheHitRate(totals))} of context from cache`;
}

function cost(dollars: number): UsageRow["value"] {
  return { kind: "cost", text: formatUsd(dollars) };
}

function absent(text: string): UsageRow["value"] {
  return { kind: "absent", text };
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

interface Spend {
  cost: number;
  tokens: number;
}

interface ModelSpend extends Spend {
  readonly model: string;
  readonly provider: string;
  turns: number;
}

interface FolderSpend extends Spend {
  readonly path: string | null;
}

function bump<K, V extends Spend>(into: Map<K, V>, key: K, seed: V, totals: UsageTotals): V {
  const found = into.get(key) ?? seed;
  found.cost += totals.cost;
  found.tokens += totals.tokens;
  into.set(key, found);
  return found;
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

  const perDay = new Map<string, number>();
  const perModel = new Map<string, ModelSpend>();
  const perFolder = new Map<string, FolderSpend>();
  const perChat = new Map<SessionId, Spend>();
  const overhead: Spend = { cost: 0, tokens: 0 };
  let totals = EMPTY_TOTALS;

  let priorCost = 0;
  let sawPrior = false;

  for (const entry of report.entries) {
    if (prior !== undefined && entry.day >= prior.from && entry.day <= prior.to) {
      sawPrior = true;
      priorCost += entry.totals.cost;
    }
    if (entry.day < from || entry.day > to) continue;

    totals = addTotals(totals, entry.totals);
    perDay.set(entry.day, (perDay.get(entry.day) ?? 0) + entry.totals.cost);
    bump(
      perFolder,
      entry.workspacePath ?? "",
      { path: entry.workspacePath, cost: 0, tokens: 0 },
      entry.totals,
    );
    bump(perChat, entry.sessionId, { cost: 0, tokens: 0 }, entry.totals);

    if (entry.subject.kind === "model") {
      const seed: ModelSpend = {
        model: entry.subject.model,
        provider: entry.subject.provider,
        cost: 0,
        tokens: 0,
        turns: 0,
      };
      const key = JSON.stringify([entry.subject.provider, entry.subject.model]);
      bump(perModel, key, seed, entry.totals).turns += entry.totals.turns;
      continue;
    }
    overhead.cost += entry.totals.cost;
    overhead.tokens += entry.totals.tokens;
  }

  // Rank by cost while anything is priced; a free local model still ranks by tokens.
  const byCost = totals.cost > 0;
  const shareOf = (spend: Spend): number => {
    const whole = byCost ? totals.cost : totals.tokens;
    return whole === 0 ? 0 : (byCost ? spend.cost : spend.tokens) / whole;
  };
  const ranked = (rows: readonly UsageRow[]): readonly UsageRow[] =>
    rows.toSorted((left, right) => right.share - left.share);

  const bucketSize = grain === "day" ? 1 : 7;
  const points: UsagePoint[] = [];
  for (let index = 0; index < days.length; index += bucketSize) {
    const bucket = days.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket.at(-1);
    if (first === undefined || last === undefined) continue;
    points.push({
      label: bucketLabel(first, last, grain),
      cost: bucket.reduce((running, day) => running + (perDay.get(day) ?? 0), 0),
    });
  }

  // Two checkouts can end in the same directory name, so a repeated leaf earns
  // the segment above it. Unique names stay short.
  const leafCounts = new Map<string, number>();
  for (const folder of perFolder.values()) {
    const leaf = folderLabel(folder.path);
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }

  const models: UsageRow[] = [...perModel].map(([key, model]) => ({
    key,
    label: model.model,
    meta: `${model.provider} · ${formatTokens(model.tokens)} tokens · ${plural(model.turns, "request")}`,
    value: cost(model.cost),
    share: shareOf(model),
  }));
  if (overhead.cost > 0 || overhead.tokens > 0) {
    models.push({
      key: "overhead",
      label: "Compaction and tools",
      meta: `No model of its own · ${formatTokens(overhead.tokens)} tokens`,
      value: cost(overhead.cost),
      share: shareOf(overhead),
    });
  }

  return {
    grain,
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
        return {
          key,
          label: parent === undefined ? leaf : `${leaf} in ${parent}`,
          meta: `${formatTokens(folder.tokens)} tokens`,
          value: cost(folder.cost),
          share: shareOf(folder),
        };
      }),
    ),
    chats: ranked(
      report.sessions.flatMap((session) => {
        const spent = perChat.get(session.sessionId);
        return spent === undefined
          ? []
          : [
              {
                key: session.sessionId,
                label: chatLabel(session.name),
                meta: `${formatTokens(spent.tokens)} tokens`,
                value: cost(spent.cost),
                share: shareOf(spent),
              },
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
): { readonly title: string; readonly body: string; readonly offerAllTime: boolean } {
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

/** The two tools whose history is a file on this machine rather than Nyte's own. */
export const LOCAL_TOOLS = ["claudeCode", "codex"] as const;
type LocalTool = (typeof LOCAL_TOOLS)[number];

export const USAGE_TOOL_LABELS: Readonly<Record<UsageTool, string>> = {
  nyte: "Nyte",
  claudeCode: "Claude Code",
  codex: "Codex",
};

/** Where each tool's history lives, for the row that found none. */
const USAGE_TOOL_HOMES: Readonly<Record<LocalTool, string>> = {
  claudeCode: "CLAUDE_CONFIG_DIR or ~/.claude",
  codex: "CODEX_HOME or ~/.codex",
};

/** A total and the rows that make it up. */
interface UsageBreakdown {
  readonly amount: string;
  readonly meta: string;
  readonly rows: readonly UsageRow[];
}

/** A history that answered, or the sentence explaining why it did not. */
type LocalHistoryView =
  | {
      readonly kind: "rows";
      readonly rows: readonly UsageRow[];
      /** What the read skipped, when it skipped anything. */
      readonly note: string | undefined;
    }
  | { readonly kind: "message"; readonly message: string; readonly failed: boolean };

type LocalHistory = UsageSnapshot["claudeCode"];

/** What a history left out. Unpriced records still count toward tokens. */
function coverageGaps(usage: Extract<LocalHistory, { kind: "ready" }>): readonly string[] {
  return [
    usage.malformedRecords > 0 && plural(usage.malformedRecords, "malformed record"),
    usage.unreadableFiles > 0 && plural(usage.unreadableFiles, "unreadable file"),
    usage.unpricedRecords > 0 && plural(usage.unpricedRecords, "unpriced record"),
  ].filter((gap) => gap !== false);
}

/** One tool's models, all time, or the sentence explaining why there are none. */
export function deriveLocalHistory(tool: LocalTool, usage: LocalHistory): LocalHistoryView {
  if (usage.kind === "missing") {
    return {
      kind: "message",
      message: `No local history in ${USAGE_TOOL_HOMES[tool]}.`,
      failed: false,
    };
  }
  if (usage.kind === "failed") {
    return {
      kind: "message",
      message: `Couldn't read ${USAGE_TOOL_LABELS[tool]} history. ${usage.message}`,
      failed: true,
    };
  }

  const total = usage.summary.total;
  const gaps = coverageGaps(usage);
  const priced = total.cost.total > 0;
  const whole = priced ? total.cost.total : total.totalTokens;

  return {
    kind: "rows",
    note: gaps.length === 0 ? undefined : `Skipped ${gaps.join(", ")}`,
    rows: usage.summary.models.map((row) => ({
      key: `${row.provider}/${row.model}`,
      label: row.model,
      meta: `${formatTokens(row.usage.totalTokens)} tokens · ${plural(row.turns, "record")}`,
      value:
        row.usage.cost.total === 0 && gaps.length > 0
          ? absent("Unpriced")
          : cost(row.usage.cost.total),
      share: whole === 0 ? 0 : (priced ? row.usage.cost.total : row.usage.totalTokens) / whole,
    })),
  };
}

/** A tool's row, with the spend behind it when the tool answered at all. */
interface ToolEntry {
  readonly row: UsageRow;
  readonly spend: Spend | undefined;
}

/** Every tool's all-time spend against the sum of them, so a share means one thing. */
export function deriveTools(report: UsageSnapshot): UsageBreakdown {
  const entries = USAGE_TOOLS.map((tool): ToolEntry => {
    const label = USAGE_TOOL_LABELS[tool];
    if (tool === "nyte") {
      if (report.nyteError !== null) {
        return {
          row: {
            key: tool,
            label,
            meta: report.nyteError,
            value: absent("Couldn't read"),
            share: 0,
          },
          spend: undefined,
        };
      }
      const spend = report.entries.reduce<Spend>(
        (sum, entry) => ({
          cost: sum.cost + entry.totals.cost,
          tokens: sum.tokens + entry.totals.tokens,
        }),
        { cost: 0, tokens: 0 },
      );
      const partial = report.sources.some((source) => source.status === "failed");
      return {
        row: {
          key: tool,
          label,
          meta: `${formatTokens(spend.tokens)} tokens${partial ? " · partial history" : ""}`,
          value: cost(spend.cost),
          share: 0,
        },
        spend,
      };
    }

    const history = report[tool];
    if (history.kind !== "ready") {
      return {
        row: {
          key: tool,
          label,
          meta:
            history.kind === "missing"
              ? `No local history in ${USAGE_TOOL_HOMES[tool]}`
              : history.message,
          value: absent(history.kind === "missing" ? "Not found" : "Couldn't read"),
          share: 0,
        },
        spend: undefined,
      };
    }
    const spend: Spend = {
      cost: history.summary.total.cost.total,
      tokens: history.summary.total.totalTokens,
    };
    return {
      row: {
        key: tool,
        label,
        meta: `${formatTokens(spend.tokens)} tokens${coverageGaps(history).length > 0 ? " · partial history" : ""}`,
        value: cost(spend.cost),
        share: 0,
      },
      spend,
    };
  });

  const counted = entries.flatMap((entry) => (entry.spend === undefined ? [] : [entry.spend]));
  const spent = counted.reduce((sum, spend) => sum + spend.cost, 0);
  const tokens = counted.reduce((sum, spend) => sum + spend.tokens, 0);
  const byCost = spent > 0;
  const whole = byCost ? spent : tokens;

  return {
    amount: counted.length === 0 ? "No history read" : formatUsd(spent),
    meta: `API estimate · ${formatTokens(tokens)} tokens · ${formatCount(counted.length)} of ${formatCount(USAGE_TOOLS.length)} histories read`,
    rows: entries.map(({ row, spend }) =>
      spend === undefined || whole === 0
        ? row
        : { ...row, share: (byCost ? spend.cost : spend.tokens) / whole },
    ),
  };
}

// ---------------------------------------------------------------------------
// subscription windows
// ---------------------------------------------------------------------------

/** The account behind a subscription window, named the way its provider is. */
const LIMIT_PROVIDER_LABELS: Readonly<Record<AccountUsage["provider"], string>> = {
  anthropic: "Claude",
  "openai-codex": "Codex",
};

const LIMIT_WINDOW_LABELS: Readonly<Record<string, string>> = {
  five_hour: "5 hours",
  seven_day: "Weekly",
  primary: "Current window",
  secondary: "Secondary window",
};

const SCOPED_WEEKLY = "seven_day_";

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

/** A provider's own windows, named the way its own dashboard names them. */
export function deriveAccount(account: AccountUsage): AccountView {
  const name = LIMIT_PROVIDER_LABELS[account.provider];
  if (account.kind === "failed") {
    return { title: name, meters: [], message: account.message, failed: true };
  }
  if (account.kind === "unavailable") {
    return {
      title: name,
      meters: [],
      message: `Sign in to ${name} with a subscription in Settings › Models to see its limits.`,
      failed: false,
    };
  }
  return {
    title: account.limits.plan === undefined ? name : `${name} · ${account.limits.plan}`,
    meters: account.limits.windows.map((window) => ({
      key: window.id,
      label:
        LIMIT_WINDOW_LABELS[window.id] ??
        (window.id.startsWith(SCOPED_WEEKLY)
          ? `Weekly · ${window.id.slice(SCOPED_WEEKLY.length)}`
          : window.id),
      used: Math.round(window.usedPercent),
      reset:
        window.resetsAt === undefined
          ? "Reset time unknown"
          : `Resets ${new Date(window.resetsAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`,
    })),
    message: undefined,
    failed: false,
  };
}
