/**
 * Settings › Usage sums recorded tokens and API cost estimates from retained
 * Nyte history. Core owns commit classification and token-count semantics;
 * desktop folds those records into one flat cell per day, folder, chat, and
 * subject. Zero-token, zero-cost records open no cell. Tokens with an unknown
 * or zero price still count; these totals are not a subscription bill.
 *
 * The window is an input: a cell only exists if it landed inside the requested
 * days. Reading it costs nothing either way, though — the walk below visits
 * every stored commit whatever window it is handed — so Settings › Usage asks
 * for an unbounded read once and narrows it per range itself.
 *
 * Days are the host's local days, and the renderer runs on the same machine,
 * so both sides agree on where a day starts without carrying a time zone.
 */
import { commitUsage, usageTokens } from "@nyte-ai/client";
import type { IpcFailure } from "../shared/errors.ts";
import type { SessionId } from "@nyte-ai/core";
import type { UsageSubject } from "@nyte-ai/client";
import type { Commit } from "@nyte-ai/protocol";
import type { Usage } from "@nyte-ai/schema";
import type {
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageTotals,
  UsageWindow,
} from "../shared/ipc.ts";

/** What a commit contributes to usage: when, on whose behalf, and how much. */
export interface UsageCommit {
  readonly at: number;
  readonly subject: UsageSubject;
  readonly usage: Usage;
}

export function usageCommit(commit: Commit): UsageCommit | undefined {
  const spend = commitUsage(commit);
  return spend === undefined ? undefined : { at: commit.at, ...spend };
}

/** One session's spend, read before the fold so the fold itself stays pure. */
export interface SessionCommits {
  readonly sessionId: SessionId;
  readonly name: string | undefined;
  readonly commits: readonly UsageCommit[];
}

/** One store's read, so a store that failed can be a row instead of an error page. */
export interface StoreRead {
  readonly workspacePath: string | null;
  readonly sessions: readonly SessionCommits[];
  readonly failure: IpcFailure | null;
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

function add(totals: UsageTotals, usage: Usage): UsageTotals {
  return {
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cacheRead: totals.cacheRead + usage.cacheRead,
    cacheWrite: totals.cacheWrite + usage.cacheWrite,
    reasoning: totals.reasoning + (usage.reasoning ?? 0),
    tokens: totals.tokens + usageTokens(usage),
    cost: totals.cost + usage.cost.total,
    turns: totals.turns + 1,
  };
}

function reported(usage: Usage): boolean {
  return (
    usage.totalTokens > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.cost.total > 0
  );
}

/**
 * `YYYY-MM-DD` for the local day a commit landed on. `toISOString` would name
 * the UTC day, which moves late-evening work to tomorrow west of Greenwich.
 */
export function localDay(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** Local midnight, so day arithmetic stays on calendar days across a DST shift. */
function dayStart(day: string): number {
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

/** Inclusive day count, which is also how far back the comparison window reaches. */
function daysBetween(sinceDay: string, untilDay: string): number {
  let span = 1;
  for (let day = sinceDay; day < untilDay; day = shiftDay(day, 1)) span += 1;
  return span;
}

/**
 * The equal-length window immediately before this one. An all-time read has no
 * "before", so it reports no comparison rather than an empty one.
 */
function priorWindow(
  sinceDay: string | null,
  untilDay: string,
): { readonly sinceDay: string; readonly untilDay: string } | undefined {
  if (sinceDay === null) return undefined;
  const priorUntil = shiftDay(sinceDay, -1);
  const span = daysBetween(sinceDay, untilDay);
  return { sinceDay: shiftDay(priorUntil, -(span - 1)), untilDay: priorUntil };
}

/**
 * Fold read commits into the flat cells one window is made of.
 *
 * Every commit is visited once. Cells are kept only for the requested window;
 * days outside it still feed the comparison total and the earliest-day marker,
 * both of which the page needs in order to explain an empty window.
 */
export function projectUsageReport(
  stores: readonly StoreRead[],
  window: UsageWindow,
  readAt: number,
): UsageReport {
  const requestedSince = window.sinceDay;
  const untilDay = window.untilDay;
  const prior = priorWindow(requestedSince, untilDay);

  const cells = new Map<
    string,
    { readonly entry: Omit<UsageEntry, "totals">; totals: UsageTotals }
  >();
  const sessions = new Map<SessionId, UsageSession>();
  const sources: UsageSource[] = [];
  let priorCost = 0;
  let priorTokens = 0;
  let sawPrior = false;
  let earliestDay: string | undefined;

  for (const store of stores) {
    sources.push({
      workspacePath: store.workspacePath,
      status: store.failure === null ? "ok" : "failed",
      sessions: store.sessions.length,
      message: store.failure?.message ?? null,
    });

    for (const session of store.sessions) {
      let lastActivityAt = 0;
      let spentInWindow = false;

      for (const spend of session.commits) {
        if (!reported(spend.usage)) continue;
        const day = localDay(spend.at);
        if (earliestDay === undefined || day < earliestDay) earliestDay = day;

        if (prior !== undefined && day >= prior.sinceDay && day <= prior.untilDay) {
          sawPrior = true;
          priorCost += spend.usage.cost.total;
          priorTokens += usageTokens(spend.usage);
        }

        if (day > untilDay) continue;
        if (requestedSince !== null && day < requestedSince) continue;

        const key = JSON.stringify([day, store.workspacePath, session.sessionId, spend.subject]);
        const cell = cells.get(key);
        if (cell === undefined) {
          cells.set(key, {
            entry: {
              day,
              workspacePath: store.workspacePath,
              sessionId: session.sessionId,
              subject: spend.subject,
            },
            totals: add(EMPTY_TOTALS, spend.usage),
          });
        } else {
          cell.totals = add(cell.totals, spend.usage);
        }
        spentInWindow = true;
        lastActivityAt = Math.max(lastActivityAt, spend.at);
      }

      // A chat with no cells in the window is not on the page, so it needs no name.
      if (spentInWindow) {
        sessions.set(session.sessionId, {
          sessionId: session.sessionId,
          name: session.name,
          workspacePath: store.workspacePath,
          lastActivityAt,
        });
      }
    }
  }

  return {
    readAt,
    sinceDay: requestedSince ?? earliestDay ?? untilDay,
    untilDay,
    entries: [...cells.values()]
      .map((cell) => ({ ...cell.entry, totals: cell.totals }))
      .toSorted((left, right) => left.day.localeCompare(right.day)),
    sessions: [...sessions.values()],
    sources,
    previous: sawPrior ? { cost: priorCost, tokens: priorTokens } : undefined,
    earliestDay,
  };
}
