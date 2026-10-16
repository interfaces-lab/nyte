import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  decodeObject,
  decodeSessionRecord,
  decodeWorkspaceRecord,
  parseSessionRef,
} from "@nyte-ai/core";
import type { ModelRef, SessionId, Usage } from "@nyte-ai/schema";
import type {
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageSubject,
  UsageTotals,
  UsageWindow,
} from "./usage-types.ts";
import { cacheSavings, usageTokens } from "./usage-summary.ts";
import { decodeEvent, numberOf, textOf } from "./store-rows.ts";

export interface UsageRecord {
  readonly at: number;
  readonly subject: UsageSubject;
  readonly usage: Usage;
}

export interface SessionUsage {
  readonly sessionId: SessionId;
  readonly name: string | undefined;
  readonly records: readonly UsageRecord[];
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
  return {
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cacheRead: totals.cacheRead + usage.cacheRead,
    cacheWrite: totals.cacheWrite + usage.cacheWrite,
    reasoning: totals.reasoning + (usage.reasoning ?? 0),
    tokens: totals.tokens + usageTokens(usage),
    cost: totals.cost + usage.cost.total,
    cacheSavings: totals.cacheSavings + cacheSavings(usage),
  };
}

function reported(usage: Usage): boolean {
  return (
    usage.total > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.cost.total > 0
  );
}

export const USAGE_EVENTS =
  "SELECT session, seq, at, event FROM log WHERE json_extract(event, '$.kind') = 'request' OR (json_extract(event, '$.kind') = 'run' AND json_extract(event, '$.change') = 'started') ORDER BY session, seq";

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

      for (const spend of session.records) {
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
    entries: [...cells.values()]
      .map((cell) => ({ ...cell.entry, totals: cell.totals }))
      .toSorted((left, right) => left.day.localeCompare(right.day)),
    sessions: [...sessions.values()],
    sources,
    previous: sawPrior ? { cost: priorCost, tokens: priorTokens } : undefined,
    earliestDay,
  };
}

export function readNyteUsage(home: string, window: UsageWindow): UsageReport {
  const readAt = Date.now();
  const path = join(home, ".nyte", "nyte.db");

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
        readonly records: UsageRecord[];
      }
    >();

    const refs = database
      .prepare(
        "SELECT refs.name, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE refs.name LIKE 'workspaces/%' OR (refs.name LIKE 'sessions/%' AND instr(substr(refs.name, 10), '/') = 0)",
      )
      .all();

    for (const row of refs) {
      const name = textOf(row.name);
      const body = textOf(row.body);

      if (name === null || body === null || !name.startsWith("workspaces/")) continue;
      const workspace = decodeWorkspaceRecord(decodeObject(body));

      if (workspace !== null)
        workspaces.set(
          workspace.id,
          workspace.target.kind === "local" && "path" in workspace.target
            ? textOf(workspace.target.path)
            : null,
        );
    }

    for (const row of refs) {
      const name = textOf(row.name);
      const body = textOf(row.body);

      if (name === null || body === null || name.split("/").length !== 2) continue;
      const id = parseSessionRef(name);

      if (id === null) continue;
      const session = decodeSessionRecord(decodeObject(body));

      if (session === null) throw new Error(`Cannot read session ${id}.`);
      sessions.set(id, {
        workspacePath: workspaces.get(session.workspace) ?? null,
        name: session.name ?? undefined,
        lastActivityAt: session.lastActivityAt,
        records: [],
      });
    }

    const models = new Map<SessionId, Map<string | null, ModelRef>>();

    for (const row of database.prepare(USAGE_EVENTS).iterate()) {
      const session = parseSessionRef(`sessions/${textOf(row.session) ?? ""}`);

      if (session === null) throw new Error("Cannot read usage session.");
      const event = decodeEvent(numberOf(row.seq), numberOf(row.at), textOf(row.event) ?? "");
      let heads = models.get(session);

      if (heads === undefined) {
        heads = new Map();
        models.set(session, heads);
      }

      if (event.kind === "run" && event.change === "started")
        heads.set(event.head, event.view.configuration.model);

      if (event.kind !== "request") continue;
      const model = heads.get(event.head);

      const subject: UsageSubject =
        event.step === "compaction" || event.step === "summary"
          ? { kind: "compaction" }
          : event.step === "plugin"
            ? { kind: "tool" }
            : {
                kind: "model",
                provider: model?.provider ?? "unknown",
                model: model?.id ?? "unknown",
              };

      let info = sessions.get(session);

      if (info === undefined) {
        info = { workspacePath: null, name: undefined, lastActivityAt: undefined, records: [] };
        sessions.set(session, info);
      }

      info.records.push({ at: event.at, subject, usage: event.usage });
    }

    database.exec("COMMIT");
    const stores = new Map<string | null, SessionUsage[]>();

    for (const [sessionId, info] of sessions) {
      const group = stores.get(info.workspacePath) ?? [];
      group.push({
        sessionId,
        name: info.name,
        records: info.records,
        lastActivityAt: info.lastActivityAt,
      });
      stores.set(info.workspacePath, group);
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
