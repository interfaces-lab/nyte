import { asId } from "@nyte-ai/schema";
import type { AdvanceReport, HeadName, Owned, SessionId } from "@nyte-ai/schema";
import type { Models } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import { SdkError, composeHost } from "@nyte-ai/core";
import type { Host, Kernel, Listener, OpenOptions, WaitRegistry } from "@nyte-ai/core";
import { encodeError, errorStatus } from "@nyte-ai/protocol";
import { Settings } from "typebox/system";
import { credentialStore } from "@nyte-ai/host/credentials";
import { durableObjectStore } from "@nyte-ai/host/durable-object";
import type { DurableObjectSql, SqlValue } from "@nyte-ai/host/durable-object";
import { seedSigner } from "@nyte-ai/host/identity";
import { listenFetch } from "@nyte-ai/host/listen-fetch";
import { chatOnlyProvider } from "@nyte-ai/host/providers";
import manifest from "../../../package.json" with { type: "json" };

Settings.Set({ useAcceleration: false });

/** Returns the parts of a Durable Object's `state` `NyteHost` uses, structurally: the storage `durableObjectStore` reads with the object's one alarm, and `blockConcurrencyWhile` to hold requests until the host is composed. */
export type WorkerState = {
  readonly storage: DurableObjectSql & {
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

/** Returns the Worker's bindings: the `NyteHost` namespace `wrangler.jsonc` binds, the listener token it requires as a secret (`secrets.required`, set with `wrangler secret put NYTE_TOKEN`, at least 16 characters; §42l), the optional base64 secrets key (decision 10; absent, see `secretsFrom`), and the optional base64 identity seed (§50a; absent, the host answers no identity challenge). */
export type WorkerEnv = {
  readonly NYTE_HOST: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  readonly NYTE_TOKEN: string;
  readonly NYTE_SECRET_KEY?: string;
  readonly NYTE_IDENTITY_KEY?: string;
};

export type PassBudget = {
  readonly heads: number;
  readonly ms: number;
  readonly repair: boolean;
};

export type PassHost = Pick<Host, "execution"> & {
  readonly kernel: { readonly waits: Pick<WaitRegistry, "tick"> };
};

const PASS_BUDGET = { heads: 32, ms: 10_000 } as const;

const REPAIR_EVERY = 60;

const RETRY_MS = 30_000;

const PAGE = 100;

export function scheduleFrom(report: AdvanceReport, now: number): number | null {
  switch (report.kind) {
    case "continue":
      return now;
    case "waiting":
      return report.until;
    case "retry":
    case "busy":
      return report.until;
    case "idle":
    case "fenced":
      return null;
  }
}

export async function pass(
  host: PassHost,
  storage: Pick<DurableObjectSql, "sql">,
  budget: PassBudget,
): Promise<number | null> {
  const began = Date.now();
  const schedule = scheduleOf(storage);
  await host.kernel.waits.tick(began);

  if (budget.repair) {
    let cursor: Parameters<Host["execution"]["repair"]>[0]["cursor"];

    do {
      cursor = (await host.execution.repair({ cursor, limit: PAGE })).next ?? undefined;
    } while (cursor !== undefined);
  }

  const advances: Promise<void>[] = [];

  for (const entry of schedule.due(Date.now())) {
    if (advances.length >= budget.heads || Date.now() - began >= budget.ms) {
      schedule.write(entry.session, entry.head, began);

      continue;
    }

    advances.push(
      host.execution.advance({ session: entry.session, head: entry.head }).then(
        (report) => schedule.settle(entry, scheduleFrom(report, Date.now())),
        (error: unknown) => {
          console.error(`Advancing ${entry.session}/${entry.head} failed:`, error);
          schedule.settle(entry, Date.now() + RETRY_MS);
        },
      ),
    );
  }

  await Promise.all(advances);

  return schedule.earliest();
}

/** The Durable Object that is one Nyte host, importing only the node-free subpaths (§41j): composed once per object over its own SQLite storage with a chat-only workspace, served through `listenFetch`, and driven by its alarm. */
export class NyteHost {
  readonly #state: WorkerState;
  readonly #env: WorkerEnv;
  readonly #models: Models | undefined;
  #served: Promise<Served> | null = null;
  #passes = 0;

  constructor(state: WorkerState, env: WorkerEnv, options?: { readonly models?: Models }) {
    this.#state = state;
    this.#env = env;
    this.#models = options?.models;
    void state.blockConcurrencyWhile(async () => {
      await this.#serve().catch(() => undefined);
    });
  }

  /** Answers one request through the listener once the host is composed; an object whose composition failed answers its encoded `SdkError` (`unavailable`, 503) and composes again on the next request. */
  async fetch(request: Request): Promise<Response> {
    let served: Served;

    try {
      served = await this.#serve();
    } catch (error) {
      const failure = new SdkError(
        "unavailable",
        `The host did not start: ${error instanceof Error ? error.message : String(error)}`,
      );

      return new Response(JSON.stringify(encodeError(failure)), {
        status: errorStatus[failure.code],
        headers: { "Content-Type": "application/json" },
      });
    }

    return served.listener.fetch(request);
  }

  async alarm(): Promise<void> {
    const served = await this.#serve();
    const repair = this.#passes % REPAIR_EVERY === 0;
    this.#passes += 1;
    const next = await pass(served.host, this.#state.storage, { ...PASS_BUDGET, repair });

    if (next === null) await this.#state.storage.deleteAlarm();
    else await this.#state.storage.setAlarm(next);
  }

  #serve(): Promise<Served> {
    const served = (this.#served ??= compose(this.#state, this.#env, this.#models));

    served.catch(() => {
      if (this.#served === served) this.#served = null;
    });

    return served;
  }
}

/** The Worker: routes every request to the one `NyteHost` object, `env.NYTE_HOST.getByName("host")`. */
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return env.NYTE_HOST.getByName("host").fetch(request);
  },
};

type Served = {
  readonly host: Omit<Host, "listen"> & { readonly kernel: Kernel };
  readonly listener: Listener;
  readonly coverage: Owned;
};

async function compose(
  state: WorkerState,
  env: WorkerEnv,
  models: Models | undefined,
): Promise<Served> {
  const { storage } = state;
  const store = durableObjectStore(storage);
  const secrets = secretsFrom(env.NYTE_SECRET_KEY);
  const description = { name: "nyte-host", platform: "cloudflare", version: manifest.version };

  const host = await composeHost({
    store,
    models: models ?? createModels({ credentials: credentialStore(store, secrets) }),
    plugins: [{ id: "chat-only", environment: chatOnlyProvider() }],
    workspace: { kind: "chat-only", locator: null },
    execution: { kind: "admit-only" },
    secrets,
    home: null,
    description,
  });

  try {
    const coverage = await host.execution.cover({ kind: "all" });
    const schedule = scheduleOf(storage);

    host.kernel.wakes.subscribe((session, head) => {
      const now = Date.now();
      schedule.write(session, head, now);
      void storage.setAlarm(now);
    });

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: env.NYTE_TOKEN },
      execution: { kind: "admit-only" },
      describe: () => description,
      ...(env.NYTE_IDENTITY_KEY === undefined || env.NYTE_IDENTITY_KEY === ""
        ? {}
        : {
            identity: await seedSigner(host.hostId, Uint8Array.fromBase64(env.NYTE_IDENTITY_KEY)),
          }),
    });

    await storage.setAlarm(Date.now());

    return { host, listener, coverage };
  } catch (error) {
    await host.close();

    throw error;
  }
}

function secretsFrom(key: string | undefined): NonNullable<OpenOptions["secrets"]> {
  if (key === undefined || key === "")
    return {
      key: async () => {
        throw new SdkError("unavailable", "Set NYTE_SECRET_KEY to a base64 32-byte key.");
      },
    };
  const bytes = Uint8Array.from(atob(key), (character) => character.charCodeAt(0));

  return { key: async () => bytes };
}

function scheduleOf(storage: Pick<DurableObjectSql, "sql">) {
  const rows = (query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[] =>
    storage.sql.exec(query, ...bindings).toArray();

  rows(
    "CREATE TABLE IF NOT EXISTS nyte_schedule (session TEXT NOT NULL, head TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session, head))",
  );

  const atOf = (session: SessionId, head: HeadName): number | null => {
    const at = rows("SELECT at FROM nyte_schedule WHERE session = ? AND head = ?", session, head)[0]
      ?.at;

    return typeof at === "number" ? at : null;
  };

  const write = (session: SessionId, head: HeadName, at: number): void => {
    rows(
      "INSERT INTO nyte_schedule (session, head, at) VALUES (?, ?, ?) ON CONFLICT (session, head) DO UPDATE SET at = excluded.at",
      session,
      head,
      at,
    );
  };

  return {
    write,
    due(
      now: number,
    ): readonly { readonly session: SessionId; readonly head: HeadName; readonly at: number }[] {
      return rows(
        "SELECT session, head, at FROM nyte_schedule WHERE at <= ? ORDER BY at",
        now,
      ).flatMap((row) =>
        typeof row.session === "string" &&
        typeof row.head === "string" &&
        typeof row.at === "number"
          ? [{ session: asId<"session">(row.session), head: asId<"head">(row.head), at: row.at }]
          : [],
      );
    },
    settle(
      entry: { readonly session: SessionId; readonly head: HeadName; readonly at: number },
      next: number | null,
    ): void {
      if (atOf(entry.session, entry.head) !== entry.at) return;

      if (next === null)
        rows("DELETE FROM nyte_schedule WHERE session = ? AND head = ?", entry.session, entry.head);
      else write(entry.session, entry.head, next);
    },
    earliest(): number | null {
      const at = rows("SELECT MIN(at) AS at FROM nyte_schedule")[0]?.at;

      return typeof at === "number" ? at : null;
    },
  };
}
