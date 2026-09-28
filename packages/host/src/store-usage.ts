/**
 * Nyte's own recorded usage, read from session stores and folded into the
 * flat cells a Usage page draws. Core owns commit classification and
 * token-count semantics; this module folds those records into one cell per
 * day, folder, chat, and subject. Zero-token, zero-cost records open no cell.
 * Tokens with an unknown or zero price still count; these totals are not a
 * subscription bill.
 *
 * The window is an input: a cell only exists if it landed inside the
 * requested days. The walk visits every stored commit whatever window it is
 * handed, so a page can ask for an unbounded read once and narrow it per
 * range itself. Days are the serving machine's local days.
 *
 * The scan reads stores and the Claude Code and Codex histories in seconds of
 * CPU cold, so a host that must stay responsive runs `UsageScanner` on a
 * worker thread. Names are the one thing the scan does not return: the host
 * reads them through the SDK, which owns how a session's facts are stored.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Models } from "@nyte-ai/ai";
import { commitUsage, usageTokens } from "@nyte-ai/client";
import type { UsageSubject } from "@nyte-ai/client";
import { sessionId } from "@nyte-ai/core";
import type { SessionId } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import type {
  Commit,
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageTotals,
  UsageWindow,
} from "@nyte-ai/protocol";
import type { Api, Model, Usage } from "@nyte-ai/schema";
import {
  createUsageScanCaches,
  decodeUsageScanCaches,
  encodeUsageScanCaches,
  readLocalUsage,
} from "./usage.ts";
import type { LocalUsage, UsageScanCaches } from "./usage.ts";

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
  readonly failure: { readonly message: string } | null;
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

/** A Nyte store to read: the folder it belongs to and where its database is. */
export interface StoreLocation {
  readonly workspacePath: string | null;
  readonly path: string;
}

/** One store's spend per session, or why it could not be read. */
interface StoreScan {
  readonly workspacePath: string | null;
  readonly sessions: readonly {
    readonly sessionId: SessionId;
    readonly commits: readonly UsageCommit[];
  }[];
  readonly failure: string | null;
}

/** The catalog rows the readers price against; plain data, so they cross a thread. */
type CatalogModels = readonly Model<Api>[];

export function catalogForUsage(models: Pick<Models, "getModels">): CatalogModels {
  return [...models.getModels("anthropic"), ...models.getModels("openai-codex")];
}

export interface UsageScanRequest {
  readonly stores: readonly StoreLocation[];
  readonly catalog: CatalogModels;
}

export interface UsageScan extends LocalUsage {
  readonly stores: readonly StoreScan[];
}

export interface UsageScanReader {
  scan(request: UsageScanRequest): Promise<UsageScan>;
  close(): Promise<void>;
}

type SessionScan = StoreScan["sessions"][number];

/**
 * A session's spend, keyed by a fingerprint of its object rows. Objects are
 * immutable and content-addressed, so a session whose rows have not changed
 * cannot have different spend; only a session that grew is read again.
 */
type SessionScanCache = Map<string, { readonly fingerprint: string; readonly scan: SessionScan }>;

async function scanStore(location: StoreLocation, cache: SessionScanCache): Promise<StoreScan> {
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(location.path);
    const sessions: SessionScan[] = [];
    const seen = new Set<string>();

    for (const info of await store.list()) {
      seen.add(info.id);
      const session = await store.open(info.id);

      try {
        const listed = await session.objects.list();
        const fingerprint = `${String(listed.length)}:${String(listed.reduce((latest, row) => Math.max(latest, row.at), 0))}`;
        const hit = cache.get(info.id);

        if (hit !== undefined && hit.fingerprint === fingerprint) {
          sessions.push(hit.scan);
          continue;
        }

        const commits = await session.objects.commits();

        const scan: SessionScan = {
          sessionId: sessionId(info.id),
          commits: commits.flatMap(({ commit }) => usageCommit(commit) ?? []),
        };

        cache.set(info.id, { fingerprint, scan });
        sessions.push(scan);
      } finally {
        await session.close();
      }
    }

    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);

    return { workspacePath: location.workspacePath, sessions, failure: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    return { workspacePath: location.workspacePath, sessions: [], failure: message };
  } finally {
    await store?.close();
  }
}

/**
 * The read itself. Stores are read independently, so one that fails is a
 * row on the page rather than an error over the folders that answered. The
 * transcript readers keep a per-file cache for the life of the process,
 * persisted under the Nyte home so a restart pays stat calls rather than a
 * cold parse; a cache that cannot be loaded or saved costs time, never numbers.
 */
export class UsageScanner implements UsageScanReader {
  private readonly cachePath: string;
  private loaded: Promise<UsageScanCaches> | undefined;
  /** Per store path; a store read in this process keeps its sessions' spend. */
  private readonly sessions = new Map<string, SessionScanCache>();
  /** The text last written, so an unchanged cache is not rewritten. */
  private persisted: string | undefined;

  constructor(home: string) {
    this.cachePath = join(home, "usage-scan-cache.json");
  }

  async scan(request: UsageScanRequest): Promise<UsageScan> {
    const caches = await this.load();
    const models: Pick<Models, "getModels"> = { getModels: () => request.catalog };

    const [stores, local] = await Promise.all([
      Promise.all(
        request.stores.map((location) => {
          const cache = this.sessions.get(location.path) ?? new Map();
          this.sessions.set(location.path, cache);

          return scanStore(location, cache);
        }),
      ),
      readLocalUsage({ models, caches }),
    ]);

    await this.save(caches);

    return { stores, ...local };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private load(): Promise<UsageScanCaches> {
    // One load per process, shared by concurrent first readers, so neither
    // parses cold against an empty cache while the other is still decoding.
    this.loaded ??= readFile(this.cachePath, "utf8").then(
      (text) => {
        this.persisted = text;

        return decodeUsageScanCaches(text);
      },
      () => createUsageScanCaches(),
    );

    return this.loaded;
  }

  private async save(caches: UsageScanCaches): Promise<void> {
    const text = encodeUsageScanCaches(caches);

    if (text === this.persisted) return;

    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      // A crash mid-write leaves the previous cache, not half of this one.
      const staging = `${this.cachePath}.tmp`;
      await writeFile(staging, text, "utf8");
      await rename(staging, this.cachePath);
      this.persisted = text;
    } catch {
      // Left unset: the next read tries to persist again.
    }
  }
}
