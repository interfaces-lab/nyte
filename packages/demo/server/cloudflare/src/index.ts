/**
 * A Nyte host as one Durable Object. The object's SQLite holds every session,
 * the object attaches the runner that drives them, and `@nyte-ai/server`
 * answers the wire. The Worker in front forwards every request to that one
 * object, so a session's watchers and its runner share a process.
 *
 * Secrets: `NYTE_TOKEN` (the bearer clients present) and one API key per
 * provider you want served (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
 */
import { SqlStore } from "@nyte-ai/core/store";
import { createChatHost } from "@nyte-ai/demo-server-host";
import type { NyteServer } from "@nyte-ai/server";
import { durableObjectSqlite } from "./store.ts";

const VERSION = "0.0.2-cloudflare";
const HOST_NAME = "host";

type Env = {
  readonly NYTE: DurableObjectNamespace;
  readonly NYTE_MODEL: string;
  readonly [secret: string]: unknown;
};

export class NyteHost {
  private readonly server: Promise<NyteServer>;

  constructor(ctx: DurableObjectState, env: Env) {
    this.server = createChatHost({
      store: new SqlStore(durableObjectSqlite(ctx.storage)),
      secrets: env,
      model: env.NYTE_MODEL,
      version: VERSION,
    });
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.server).fetch(request);
  }
}

export default {
  fetch: (request: Request, env: Env) => env.NYTE.getByName(HOST_NAME).fetch(request),
};
