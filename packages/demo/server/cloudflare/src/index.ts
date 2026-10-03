import { DurableObject } from "cloudflare:workers";
import { createNyte, sessionId, UnknownSession } from "@nyte-ai/core";
import { SqlStore } from "@nyte-ai/core/store";
import { createNyteServer } from "@nyte-ai/server";
import { Settings } from "typebox/system";
import { configureModels } from "./models.ts";
import { durableSqlite } from "./sqlite.ts";

Settings.Set({ useAcceleration: false });

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.NYTE.getByName("local").fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class NyteHost extends DurableObject<Env> {
  private readonly store: SqlStore;
  private readonly runtime: ReturnType<NyteHost["open"]>;
  private admissions = 0;
  private revision = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new SqlStore(durableSqlite(ctx.storage));
    this.runtime = ctx.blockConcurrencyWhile(() => this.open());
  }

  private async open() {
    const sdk = await createNyte({
      ...configureModels(this.env),
      store: this.store,
      plugins: [],
      env: { cwd: "/tmp" },
    });
    const server = createNyteServer({
      sdk: {
        ...sdk,
        sessions: {
          ...sdk.sessions,
          configure: (input) => this.submit(() => sdk.sessions.configure(input)),
        },
        messages: {
          ...sdk.messages,
          send: (input) => this.submit(() => sdk.messages.send(input)),
          redeliver: (input) => this.submit(() => sdk.messages.redeliver(input)),
        },
        runs: {
          ...sdk.runs,
          reply: (input) => this.submit(() => sdk.runs.reply(input)),
          abort: (input) => this.submit(() => sdk.runs.abort(input)),
        },
      },
      version: "0.0.0-cloudflare-demo",
      auth: { kind: "token", token: this.env.NYTE_TOKEN },
      describe: () => ({ capabilities: { workspace: false }, persistence: "durable" }),
      onError: (failure) =>
        console.error(
          JSON.stringify({
            event: "nyte.do.failure",
            route: failure.route,
            name: failure.cause instanceof Error ? failure.cause.name : "unknown",
          }),
        ),
    });
    if ((await this.ctx.storage.getAlarm()) === null && (await this.store.list()).length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 1);
    }
    return { sdk, server };
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.runtime).server.fetch(request);
  }

  async alarm(): Promise<void> {
    const { sdk } = await this.runtime;
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    if (this.admissions > 0) return;
    const revision = this.revision;
    const sessions = await this.store.list();
    let next: number | undefined;
    for (const session of sessions) {
      const id = sessionId(session.id);
      try {
        for (const { head } of await sdk.heads.list({ sessionId: id })) {
          const outcome = await sdk.advance({ sessionId: id, head });
          let due: number | undefined;
          switch (outcome.kind) {
            case "continue":
            case "finished":
              due = Date.now() + 1;
              break;
            case "retry":
              due = outcome.at;
              break;
            case "busy":
              due = outcome.until + 1;
              break;
            case "waiting":
              due = outcome.until;
              break;
            case "fenced":
              due = Date.now() + 1_000;
              break;
            case "idle":
              break;
            default: {
              const _exhaustive: never = outcome;
              return _exhaustive;
            }
          }
          if (due !== undefined) next = Math.min(next ?? due, due);
        }
      } catch (cause) {
        if (!(cause instanceof UnknownSession)) throw cause;
      }
    }
    const known = new Set(sessions.map((session) => session.id));
    if (
      revision !== this.revision ||
      (await this.store.list()).some((session) => !known.has(session.id))
    )
      next = Date.now() + 1;
    if (next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
  }

  private async submit<T>(run: () => Promise<T>): Promise<T> {
    this.admissions += 1;
    this.revision += 1;
    try {
      await this.ctx.storage.setAlarm(Date.now() + 1);
      return await run();
    } finally {
      this.admissions -= 1;
      this.revision += 1;
      await this.ctx.storage.setAlarm(Date.now() + 1);
    }
  }
}
