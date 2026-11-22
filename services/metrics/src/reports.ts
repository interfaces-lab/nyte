import { Type } from "typebox";
import { utcDay } from "./days.ts";
import { failure, noContent, readReport } from "./http.ts";

const REPORT_WINDOW_DAYS = 7;

const Channel = Type.Union([Type.Literal("stable"), Type.Literal("nightly")]);

const Client = Type.Union([Type.Literal("desktop"), Type.Literal("tui")]);

const Version = Type.String({
  pattern: String.raw`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`,
  maxLength: 64,
});

const Platform = Type.String({ pattern: "^[a-z0-9_]{1,16}$" });

const ModelName = Type.String({ pattern: "^[A-Za-z0-9._:/-]{1,100}$" });

const Tokens = Type.Integer({ minimum: 0, maximum: 1e11 });

const InstallReport = Type.Object(
  {
    kind: Type.Union([Type.Literal("install"), Type.Literal("update")]),
    version: Version,
    channel: Channel,
    os: Platform,
    arch: Platform,
    client: Client,
  },
  { additionalProperties: false },
);

const ModelUsage = Type.Object(
  {
    provider: ModelName,
    model: ModelName,
    requests: Type.Integer({ minimum: 0, maximum: 1e6 }),
    input: Tokens,
    output: Tokens,
    cacheRead: Tokens,
    cacheWrite: Tokens,
    cost: Type.Number({ minimum: 0, maximum: 1e5 }),
  },
  { additionalProperties: false },
);

const UsageReport = Type.Object(
  {
    day: Type.String({ pattern: String.raw`^\d{4}-\d{2}-\d{2}$` }),
    version: Version,
    channel: Channel,
    os: Platform,
    arch: Platform,
    client: Client,
    models: Type.Array(ModelUsage, { maxItems: 100 }),
  },
  { additionalProperties: false },
);

const COUNT_INSTALL = `INSERT INTO installs (day, kind, version, channel, os, arch, client, count)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
  ON CONFLICT (day, kind, version, channel, os, arch, client) DO UPDATE SET count = count + 1`;

const COUNT_ACTIVE = `INSERT INTO active (day, version, channel, os, arch, client, count)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
  ON CONFLICT (day, version, channel, os, arch, client) DO UPDATE SET count = count + 1`;

const ADD_USAGE = `INSERT INTO usage (day, provider, model, requests, input, output, cache_read, cache_write, cost)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  ON CONFLICT (day, provider, model) DO UPDATE SET
    requests = requests + excluded.requests,
    input = input + excluded.input,
    output = output + excluded.output,
    cache_read = cache_read + excluded.cache_read,
    cache_write = cache_write + excluded.cache_write,
    cost = cost + excluded.cost`;

export async function recordInstall(db: D1Database, request: Request): Promise<Response> {
  const report = await readReport(request, InstallReport);

  if (report === undefined) return failure(400);
  await db
    .prepare(COUNT_INSTALL)
    .bind(
      utcDay(0),
      report.kind,
      report.version,
      report.channel,
      report.os,
      report.arch,
      report.client,
    )
    .run();

  return noContent();
}

export async function recordUsage(db: D1Database, request: Request): Promise<Response> {
  const report = await readReport(request, UsageReport);

  if (report === undefined) return failure(400);
  const time = Date.parse(report.day);
  const realDay = Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === report.day;
  const recent = report.day >= utcDay(REPORT_WINDOW_DAYS) && report.day <= utcDay(0);
  const pairs = new Set(report.models.map((usage) => `${usage.provider} ${usage.model}`));

  if (!realDay || !recent || pairs.size !== report.models.length) return failure(400);
  await db.batch([
    db
      .prepare(COUNT_ACTIVE)
      .bind(report.day, report.version, report.channel, report.os, report.arch, report.client),
    ...report.models.map((usage) =>
      db
        .prepare(ADD_USAGE)
        .bind(
          report.day,
          usage.provider,
          usage.model,
          usage.requests,
          usage.input,
          usage.output,
          usage.cacheRead,
          usage.cacheWrite,
          usage.cost,
        ),
    ),
  ]);

  return noContent();
}
