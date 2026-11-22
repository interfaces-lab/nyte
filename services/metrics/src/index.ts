import { utcDay } from "./days.ts";
import { failure, json, noContent } from "./http.ts";
import { recordInstall, recordUsage } from "./reports.ts";
import { readStats } from "./stats.ts";

interface Env {
  readonly DB: D1Database;
}

const RETENTION_DAYS = 400;

const STATS_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
} as const;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const method = request.method;

    if (path === "/v1/install") {
      return method === "POST" ? recordInstall(env.DB, request) : failure(405, { allow: "POST" });
    }

    if (path === "/v1/usage") {
      return method === "POST" ? recordUsage(env.DB, request) : failure(405, { allow: "POST" });
    }

    if (path !== "/v1/stats") return failure(404);

    if (method === "OPTIONS") return noContent(STATS_CORS);

    if (method !== "GET") return failure(405, { allow: "GET, OPTIONS" });

    return json(200, await readStats(env.DB), {
      ...STATS_CORS,
      "cache-control": "public, max-age=300",
    });
  },

  async scheduled(_controller, env) {
    await prune(env.DB);
  },
} satisfies ExportedHandler<Env>;

async function prune(db: D1Database): Promise<void> {
  const cutoff = utcDay(RETENTION_DAYS);

  await db.batch(
    ["installs", "active", "usage"].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE day < ?1`).bind(cutoff),
    ),
  );
}
