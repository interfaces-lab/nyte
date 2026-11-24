import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { utcDay } from "./days.ts";

const STATS_DAYS = 30;

export interface Stats {
  updated: string;
  days: number;
  installs: { day: string; installs: number; updates: number }[];
  active: { day: string; count: number }[];
  versions: { version: string; count: number }[];
  platforms: { os: string; arch: string; count: number }[];
  clients: { client: string; count: number }[];
  providers: { provider: string; requests: number; input: number; output: number; cost: number }[];
  models: {
    provider: string;
    model: string;
    requests: number;
    input: number;
    output: number;
    cost: number;
  }[];
  tokens: { day: string; provider: string; tokens: number }[];
}

const InstallDayRow = Type.Object({
  day: Type.String(),
  installs: Type.Number(),
  updates: Type.Number(),
});

const ActiveDayRow = Type.Object({ day: Type.String(), count: Type.Number() });

const VersionRow = Type.Object({ version: Type.String(), count: Type.Number() });

const PlatformRow = Type.Object({ os: Type.String(), arch: Type.String(), count: Type.Number() });

const ClientRow = Type.Object({ client: Type.String(), count: Type.Number() });

const ProviderRow = Type.Object({
  provider: Type.String(),
  requests: Type.Number(),
  input: Type.Number(),
  output: Type.Number(),
  cost: Type.Number(),
});

const ModelRow = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  requests: Type.Number(),
  input: Type.Number(),
  output: Type.Number(),
  cost: Type.Number(),
});

const TokenDayRow = Type.Object({
  day: Type.String(),
  provider: Type.String(),
  tokens: Type.Number(),
});

const INSTALLS = `SELECT day,
    SUM(CASE WHEN kind = 'install' THEN count ELSE 0 END) AS installs,
    SUM(CASE WHEN kind = 'update' THEN count ELSE 0 END) AS updates
  FROM installs WHERE day >= ?1 GROUP BY day ORDER BY day`;

const ACTIVE = `SELECT day, SUM(count) AS count FROM active WHERE day >= ?1 GROUP BY day ORDER BY day`;

const VERSIONS = `SELECT version, SUM(count) AS count FROM installs WHERE day >= ?1
  GROUP BY version ORDER BY count DESC, version LIMIT 10`;

const PLATFORMS = `SELECT os, arch, SUM(count) AS count FROM installs WHERE day >= ?1
  GROUP BY os, arch ORDER BY count DESC, os, arch`;

const CLIENTS = `SELECT client, SUM(count) AS count FROM installs WHERE day >= ?1
  GROUP BY client ORDER BY count DESC, client`;

const PROVIDERS = `SELECT provider, SUM(requests) AS requests, SUM(input) AS input,
    SUM(output) AS output, SUM(cost) AS cost
  FROM usage WHERE day >= ?1
  GROUP BY provider ORDER BY SUM(input) + SUM(output) DESC, provider`;

const MODELS = `SELECT provider, model, SUM(requests) AS requests, SUM(input) AS input,
    SUM(output) AS output, SUM(cost) AS cost
  FROM usage WHERE day >= ?1
  GROUP BY provider, model ORDER BY SUM(input) + SUM(output) DESC, provider, model LIMIT 20`;

const TOKENS = `SELECT day, provider, SUM(input + output) AS tokens FROM usage WHERE day >= ?1
  GROUP BY day, provider ORDER BY day, provider`;

const QUERIES = [INSTALLS, ACTIVE, VERSIONS, PLATFORMS, CLIENTS, PROVIDERS, MODELS, TOKENS];

export async function readStats(db: D1Database): Promise<Stats> {
  const since = utcDay(STATS_DAYS - 1);
  const results = await db.batch(QUERIES.map((query) => db.prepare(query).bind(since)));
  const rows = (query: string): unknown[] => results[QUERIES.indexOf(query)]?.results ?? [];

  return {
    updated: new Date().toISOString(),
    days: STATS_DAYS,
    installs: many(InstallDayRow, rows(INSTALLS)),
    active: many(ActiveDayRow, rows(ACTIVE)),
    versions: many(VersionRow, rows(VERSIONS)),
    platforms: many(PlatformRow, rows(PLATFORMS)),
    clients: many(ClientRow, rows(CLIENTS)),
    providers: many(ProviderRow, rows(PROVIDERS)),
    models: many(ModelRow, rows(MODELS)),
    tokens: many(TokenDayRow, rows(TOKENS)),
  };
}

function many<S extends TSchema>(schema: S, rows: readonly unknown[]): Static<S>[] {
  return rows.map((row) => {
    if (!Value.Check(schema, row)) throw new Error("D1 returned an unexpected row");

    return row;
  });
}
