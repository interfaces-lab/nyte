import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import {
  decodeObject,
  decodeSessionRecord,
  decodeWorkspaceRecord,
  parseSessionRef,
} from "@nyte-ai/core/store";
import type { SessionId, Usage } from "@nyte-ai/schema";
import type {
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageSubject,
  UsageTotals,
  UsageWindow,
} from "./usage-types.ts";
import { storePath } from "./sqlite.ts";
import { readCacheDocument, writeCacheDocument } from "./usage-history.ts";
import { cacheSavings, usageTokens } from "./usage-summary.ts";
import { decodeEvent, parseNumber, parseText } from "./store-rows.ts";

export interface UsageRecord {
  readonly at: number;
  readonly subject: UsageSubject;
  readonly usage: Usage;
}

/** A session's charged requests on one local day for one subject. */
export interface UsageCell {
  readonly day: string;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
  /** When the cell's latest request was recorded, in epoch ms. */
  readonly lastAt: number;
}

export interface SessionUsage {
  readonly sessionId: SessionId;
  readonly name: string | undefined;
  readonly cells: Iterable<UsageCell>;
  readonly lastActivityAt?: number;
}

export interface StoreRead {
  readonly workspacePath: string | null;
  readonly sessions: readonly SessionUsage[];
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
  cacheSavings: 0,
};

function add(totals: UsageTotals, usage: Usage): UsageTotals {
  return addTotals(totals, {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning ?? 0,
    tokens: usageTokens(usage),
    cost: usage.cost.total,
    cacheSavings: cacheSavings(usage),
  });
}

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

/**
 * Adds a request to its session's cells. A request that charged nothing is skipped, so it
 * moves neither the earliest day nor the last activity.
 */
export function foldUsage(cells: Map<string, UsageCell>, record: UsageRecord): void {
  const usage = record.usage;

  const amounts = [
    usage.total,
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.cost.total,
  ];

  if (!amounts.some((amount) => amount > 0)) return;
  const day = localDay(record.at);
  const key = JSON.stringify([day, record.subject]);
  const cell = cells.get(key);

  cells.set(key, {
    day,
    subject: record.subject,
    totals: add(cell?.totals ?? EMPTY_TOTALS, usage),
    lastAt: Math.max(cell?.lastAt ?? 0, record.at),
  });
}

/** Request rows after a log rowid, read from the log kind index in rowid order. */
export const USAGE_EVENTS =
  "SELECT rowid AS id, session, seq, at, event FROM log WHERE json_extract(event, '$.kind') = 'request' AND rowid > ?";

const USAGE_EVENT_COUNT =
  "SELECT count(*) AS requests FROM log WHERE json_extract(event, '$.kind') = 'request' AND rowid <= ?";

const USAGE_REFS =
  "SELECT refs.name, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE (refs.name >= 'workspaces/' AND refs.name < 'workspaces0') OR (refs.name >= 'sessions/' AND refs.name < 'sessions0' AND instr(substr(refs.name, 10), '/') = 0)";

export function localDay(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${String(date.getFullYear())}-${month}-${day}`;
}

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + delta);

  return localDay(date.getTime());
}

function priorWindow(
  sinceDay: string | null,
  untilDay: string,
): { readonly sinceDay: string; readonly untilDay: string } | undefined {
  if (sinceDay === null) return undefined;
  const priorUntil = shiftDay(sinceDay, -1);

  const span =
    (Date.parse(`${untilDay}T00:00:00Z`) - Date.parse(`${sinceDay}T00:00:00Z`)) / 86_400_000 + 1;

  return { sinceDay: shiftDay(priorUntil, -(span - 1)), untilDay: priorUntil };
}

export function projectUsageReport(
  stores: readonly StoreRead[],
  window: UsageWindow,
  readAt: number,
): UsageReport {
  const requestedSince = window.sinceDay;
  const untilDay = window.untilDay;
  const prior = priorWindow(requestedSince, untilDay);

  const entries = new Map<string, UsageEntry>();

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

      for (const cell of session.cells) {
        const day = cell.day;

        if (earliestDay === undefined || day < earliestDay) earliestDay = day;

        if (prior !== undefined && day >= prior.sinceDay && day <= prior.untilDay) {
          sawPrior = true;
          priorCost += cell.totals.cost;
          priorTokens += cell.totals.tokens;
        }

        if (day > untilDay) continue;

        if (requestedSince !== null && day < requestedSince) continue;

        const key = JSON.stringify([day, store.workspacePath, session.sessionId, cell.subject]);
        const entry = entries.get(key);

        entries.set(key, {
          day,
          workspacePath: store.workspacePath,
          sessionId: session.sessionId,
          subject: cell.subject,
          totals: entry === undefined ? cell.totals : addTotals(entry.totals, cell.totals),
        });

        spentInWindow = true;
        lastActivityAt = Math.max(lastActivityAt, cell.lastAt);
      }

      if (spentInWindow) {
        sessions.set(session.sessionId, {
          sessionId: session.sessionId,
          name: session.name,
          workspacePath: store.workspacePath,
          lastActivityAt: session.lastActivityAt ?? lastActivityAt,
        });
      }
    }
  }

  return {
    readAt,
    sinceDay: requestedSince ?? earliestDay ?? untilDay,
    untilDay,
    entries: [...entries.values()].toSorted((left, right) => left.day.localeCompare(right.day)),
    sessions: [...sessions.values()],
    sources,
    previous: sawPrior ? { cost: priorCost, tokens: priorTokens } : undefined,
    earliestDay,
  };
}

/**
 * Request usage folded into cells, through log row `through`. The log only grows, so a later read
 * folds just the rows after `through`; a store whose earlier rows changed is folded again whole.
 */
export interface StoreUsageCache {
  path: string;
  /** Cells bucket requests by local day, so another time zone refolds them. */
  timeZone: string;
  through: number;
  /** How many request rows `through` covers, which tells a rewritten or replaced store apart. */
  requests: number;
  readonly sessions: Map<SessionId, Map<string, UsageCell>>;
  /** Whether a read folded rows since the cache was last saved. */
  changed: boolean;
}

export function createStoreUsageCache(): StoreUsageCache {
  return { path: "", timeZone: "", through: 0, requests: 0, sessions: new Map(), changed: false };
}

export function readNyteUsage(
  home: string,
  window: UsageWindow,
  cache: StoreUsageCache = createStoreUsageCache(),
): UsageReport {
  const readAt = Date.now();
  const path = storePath(home);

  if (!existsSync(path)) return projectUsageReport([], window, readAt);
  let database: DatabaseSync | undefined;

  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
    database.exec("BEGIN");
    const workspaces = new Map<string, string | null>();

    const sessions = new Map<
      SessionId,
      {
        readonly workspacePath: string | null;
        readonly name: string | undefined;
        readonly lastActivityAt: number | undefined;
      }
    >();

    const refs = database.prepare(USAGE_REFS).all();

    for (const row of refs) {
      const name = parseText(row.name);
      const body = parseText(row.body);

      if (name === null || body === null || !name.startsWith("workspaces/")) continue;
      const workspace = decodeWorkspaceRecord(decodeObject(body));

      if (workspace !== null)
        workspaces.set(
          workspace.id,
          workspace.target.kind === "local" && "path" in workspace.target
            ? parseText(workspace.target.path)
            : null,
        );
    }

    for (const row of refs) {
      const name = parseText(row.name);
      const body = parseText(row.body);

      if (name === null || body === null || name.split("/").length !== 2) continue;
      const id = parseSessionRef(name);

      if (id === null) continue;
      const session = decodeSessionRecord(decodeObject(body));

      if (session === null) throw new Error(`Cannot read session ${id}.`);
      sessions.set(id, {
        workspacePath: workspaces.get(session.workspace) ?? null,
        name: session.name ?? undefined,
        lastActivityAt: session.lastActivityAt,
      });
    }

    foldNewRequests(database, path, cache);
    database.exec("COMMIT");
    const stores = new Map<string | null, SessionUsage[]>();

    for (const sessionId of new Set([...sessions.keys(), ...cache.sessions.keys()])) {
      const info = sessions.get(sessionId);
      const workspacePath = info?.workspacePath ?? null;
      const group = stores.get(workspacePath) ?? [];
      group.push({
        sessionId,
        name: info?.name,
        cells: cache.sessions.get(sessionId)?.values() ?? [],
        lastActivityAt: info?.lastActivityAt,
      });
      stores.set(workspacePath, group);
    }

    return projectUsageReport(
      [...stores].map(([workspacePath, sessions]) => ({ workspacePath, sessions, failure: null })),
      window,
      readAt,
    );
  } catch (cause) {
    return projectUsageReport(
      [
        {
          workspacePath: null,
          sessions: [],
          failure: { message: cause instanceof Error ? cause.message : String(cause) },
        },
      ],
      window,
      readAt,
    );
  } finally {
    database?.close();
  }
}

/** Folds the request rows after `cache.through` into `cache`, first emptying it when the rows it covers no longer match. */
function foldNewRequests(database: DatabaseSync, path: string, cache: StoreUsageCache): void {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const covered =
    cache.through === 0
      ? 0
      : parseNumber(database.prepare(USAGE_EVENT_COUNT).get(cache.through)?.requests);

  if (cache.path !== path || cache.timeZone !== timeZone || covered !== cache.requests) {
    cache.path = path;
    cache.timeZone = timeZone;
    cache.through = 0;
    cache.requests = 0;
    cache.sessions.clear();
    cache.changed = true;
  }

  for (const row of database.prepare(USAGE_EVENTS).iterate(cache.through)) {
    const session = parseSessionRef(`sessions/${parseText(row.session) ?? ""}`);

    if (session === null) throw new Error("Cannot read usage session.");

    const event = decodeEvent(
      parseNumber(row.seq),
      parseNumber(row.at),
      parseText(row.event) ?? "",
    );

    const cells = cache.sessions.get(session) ?? new Map<string, UsageCell>();

    if (event.kind === "request") {
      const model = event.model;

      foldUsage(cells, {
        at: event.at,
        subject:
          event.step === "compaction" || event.step === "summary"
            ? { kind: "compaction" }
            : event.step === "plugin"
              ? { kind: "tool" }
              : {
                  kind: "model",
                  provider: model?.provider ?? "unknown",
                  model: model?.id ?? "unknown",
                },
        usage: event.usage,
      });
    }

    cache.sessions.set(session, cells);
    cache.through = parseNumber(row.id);
    cache.requests += 1;
    cache.changed = true;
  }
}

/** Bump when what a cell keeps changes, so an older document is dropped instead of misread. */
const STORE_USAGE_CACHE_VERSION = 1;

const amount = Type.Number();

const storeUsageCacheDocument = Type.Object({
  version: Type.Literal(STORE_USAGE_CACHE_VERSION),
  path: Type.String(),
  timeZone: Type.String(),
  through: Type.Integer({ minimum: 0 }),
  requests: Type.Integer({ minimum: 0 }),
  sessions: Type.Array(
    Type.Tuple([
      Type.String(),
      Type.Array(
        Type.Object({
          day: Type.String(),
          subject: Type.Union([
            Type.Object({
              kind: Type.Literal("model"),
              provider: Type.String(),
              model: Type.String(),
            }),
            Type.Object({ kind: Type.Literal("tool") }),
            Type.Object({ kind: Type.Literal("compaction") }),
          ]),
          totals: Type.Object({
            input: amount,
            output: amount,
            cacheRead: amount,
            cacheWrite: amount,
            reasoning: amount,
            tokens: amount,
            cost: amount,
            cacheSavings: amount,
          }),
          lastAt: amount,
        }),
      ),
    ]),
  ),
});

const storeUsageCacheValidator = Compile(storeUsageCacheDocument);

/** Restores the cells {@link saveStoreUsageCache} wrote to `path`; a missing or outdated document starts empty. */
export async function loadStoreUsageCache(path: string): Promise<StoreUsageCache> {
  const document = await readCacheDocument(path, storeUsageCacheValidator);

  if (document === undefined) return createStoreUsageCache();

  return {
    path: document.path,
    timeZone: document.timeZone,
    through: document.through,
    requests: document.requests,
    sessions: new Map(
      document.sessions.flatMap(([id, cells]) => {
        const sessionId = parseSessionRef(`sessions/${id}`);

        return sessionId === null
          ? []
          : [
              [
                sessionId,
                new Map(cells.map((cell) => [JSON.stringify([cell.day, cell.subject]), cell])),
              ] as const,
            ];
      }),
    ),
    changed: false,
  };
}

/** Writes `cache` to `path` when a read folded rows since it was last saved; a failed write is tried again on the next save. */
export async function saveStoreUsageCache(path: string, cache: StoreUsageCache): Promise<void> {
  if (!cache.changed) return;

  const saved = await writeCacheDocument(path, {
    version: STORE_USAGE_CACHE_VERSION,
    path: cache.path,
    timeZone: cache.timeZone,
    through: cache.through,
    requests: cache.requests,
    sessions: [...cache.sessions].map(([sessionId, cells]) => [sessionId, [...cells.values()]]),
  } satisfies Static<typeof storeUsageCacheDocument>);

  if (saved) cache.changed = false;
}
