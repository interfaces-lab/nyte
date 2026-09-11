/**
 * A Nyte host as one Vercel Function. The instance's SQLite under `/tmp`
 * holds sessions for as long as the instance lives; Fluid compute keeps one
 * instance warm across requests, and an open watch keeps it alive while a
 * run is driven. A cold start begins with an empty store: this placement is
 * for trying the wire, and a Postgres store is what makes it durable.
 *
 * Secrets: `NYTE_TOKEN` (the bearer clients present) and one API key per
 * provider you want served (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
 */
import process from "node:process";
import { SqliteStore } from "@nyte-ai/core/store";
import { createChatHost } from "@nyte-ai/demo-server-host";

const VERSION = "0.0.2-vercel";

const server = createChatHost({
  store: new SqliteStore(process.env.NYTE_STORE ?? "/tmp/nyte.db"),
  secrets: process.env,
  model: process.env.NYTE_MODEL ?? "anthropic/claude-opus-5",
  version: VERSION,
});

async function handle(request: Request): Promise<Response> {
  return (await server).fetch(request);
}

export { handle as GET, handle as POST, handle as OPTIONS, handle as HEAD };
