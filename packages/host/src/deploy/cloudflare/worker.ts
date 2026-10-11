import { asId } from "@nyte-ai/schema";
import type { AdvanceReport, HeadName, Owned, SessionId } from "@nyte-ai/schema";
import type { Models } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import { SdkError, composeHost } from "@nyte-ai/core";
import type { Host, Kernel, Listener, WaitRegistry } from "@nyte-ai/core";
import { encodeError, errorStatus, operations } from "@nyte-ai/protocol";
import { Settings } from "typebox/system";
import { durableObjectStore } from "@nyte-ai/host/durable-object";
import type { DurableObjectSql, SqlValue } from "@nyte-ai/host/durable-object";
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

/** Returns the Worker's bindings: the `NyteHost` namespace `wrangler.jsonc` binds, the listener token it requires as a secret (`secrets.required`, set with `wrangler secret put NYTE_TOKEN`, at least 16 characters; §42l), and the optional base64 secrets key (decision 10; absent, `secrets.set` answers `unavailable`). */
export type WorkerEnv = {
  readonly NYTE_HOST: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  readonly NYTE_TOKEN: string;
  readonly NYTE_SECRET_KEY?: string;
};

/** Returns how much one alarm pass may do: at most `heads` advances, none started once `ms` has elapsed, and whether it also pages `repair` (§42i: 32 heads, 10 s, repair on a cold start and every 60th pass). */
export type PassBudget = {
  readonly heads: number;
  readonly ms: number;
  readonly repair: boolean;
};

/** Returns the host `pass` drives: what it advances and repairs through, and the wait registry it fires timers on. The composed host is one. */
export type PassHost = Pick<Host, "execution"> & {
  readonly kernel: { readonly waits: Pick<WaitRegistry, "tick"> };
};

const PASS_BUDGET = { heads: 32, ms: 10_000 } as const;

const REPAIR_EVERY = 60;

const RETRY_MS = 30_000;

const PAGE = 100;

/** Returns when the object's alarm should next fire for a head after one advance: `now` for `continue`; `until` for `waiting` with a timer, `retry` and `busy`; null for `idle`, `fenced` and `waiting` with no timer, whose wake schedules it. */
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

/** Runs one alarm pass over a composed host and the object's `nyte_schedule(session, head, at)` table in `storage` (§42f, §42i), and returns when the alarm should fire next. It fires the due timers and deadlines (`kernel.waits.tick(now)`), then takes the heads whose row is due, earliest first, and, when `budget.repair`, every head `host.execution.repair` pages out (100 a page, until `next` is null) that has no row; it advances up to `budget.heads` of them concurrently, starting none once `budget.ms` has passed since the pass began, and writes each head it left at `now`, so the remainder runs on the next alarm at once. Leases are claimed lazily, per advanced head: `advance` claims a head's lease on its first step, owned by the object's lifetime cover, and releases it when the head reports `idle`, `waiting` or `retry` (a `continue` keeps it for the next pass), so a lease is held only while a turn runs and the heads a pass leaves untouched cost no writes (§42t, §42y). The pass waits for every turn it started, so one long turn delays the object's other heads, and a turn past the 15 min alarm limit is cut short (§42w, for the owner). Each report sets its head's row to `scheduleFrom(report, now)` or deletes it on null, unless a wake rewrote the row during that step; an advance that throws is logged with `console.error` and its row set 30 s later, so one failing head never blocks the rest. Answers the earliest `at` left in the table, or null when it is empty. */
export async function pass(
  host: PassHost,
  storage: Pick<DurableObjectSql, "sql">,
  budget: PassBudget,
): Promise<number | null> {
  const began = Date.now();
  const schedule = scheduleOf(storage);
  await host.kernel.waits.tick(began);

  const heads = new Map<
    string,
    { readonly session: SessionId; readonly head: HeadName; readonly at: number | null }
  >();

  for (const row of schedule.due(began)) heads.set(keyOf(row.session, row.head), row);

  if (budget.repair) {
    let cursor: Parameters<Host["execution"]["repair"]>[0]["cursor"];

    do {
      const page = await host.execution.repair({ cursor, limit: PAGE });

      for (const { session, head } of page.runnable)
        if (!heads.has(keyOf(session, head)))
          heads.set(keyOf(session, head), { session, head, at: null });
      cursor = page.next ?? undefined;
    } while (cursor !== undefined);
  }

  const advances: Promise<void>[] = [];

  for (const entry of heads.values()) {
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

  /** Composes the host once inside `blockConcurrencyWhile`: `composeHost` with `durableObjectStore(state.storage)`, the plugin `{ id: "chat-only", environment: chatOnlyProvider() }` and workspace `{ kind: "chat-only", locator: null }`, `execution: { kind: "admit-only" }`, no `poll` (one instance, §42h), `home: null` (decision 9: no `Resources.user`), protocol's `operations()`, description `{ name: "nyte-host", platform: "cloudflare", version }`, `createModels()` from `@nyte-ai/ai/models`, and `secrets` from `NYTE_SECRET_KEY`; then takes `host.execution.cover({ kind: "all" })` for the object's life (§42i), which claims no lease (each is claimed when a pass advances its head, §42t), parks the store's waits and counts every session as covered (§42a), so admission wakes heads and activation attaches the workspace; serves `listenFetch` with `auth: { kind: "token", token: env.NYTE_TOKEN }` and `execution: { kind: "admit-only" }`; creates `nyte_schedule(session TEXT, head TEXT, at INTEGER, PRIMARY KEY (session, head))` beside the store's tables; subscribes to `kernel.wakes`, each wake writing its head's row at now and setting the alarm now; and sets the alarm now whatever alarm is pending (§42y: the schedule table keeps the timers, so the first pass repairs what a lost wake left and re-arms the rest). `options.models` replaces `createModels()`, for a deployment that configures its providers itself and for tests. TypeBox acceleration is off for the whole module, because workerd refuses code generation inside a request. */
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

  /** Runs `pass(host, state.storage, { heads: 32, ms: 10_000, repair })` with `repair` true on this object's first pass since it was constructed (a cold start) and on every 60th pass after it, counted in memory (§42i), each advanced head claiming its lease lazily (§42t); then sets the alarm to the time the pass answers, or deletes it on null. A pass that throws leaves the alarm to Cloudflare's retry. */
  async alarm(): Promise<void> {
    const served = await this.#serve();
    const repair = this.#passes % REPAIR_EVERY === 0;
    this.#passes += 1;
    const next = await pass(served.host, this.#state.storage, { ...PASS_BUDGET, repair });

    if (next === null) await this.#state.storage.deleteAlarm();
    else await this.#state.storage.setAlarm(next);
  }

  /** Returns the composed host and its listener, composing them on first call; a failed composition is forgotten, so the next call composes again. */
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

/** Returns what a composed object holds: its host, listener, and the coverage it drives under. */
type Served = {
  readonly host: Omit<Host, "listen"> & { readonly kernel: Kernel };
  readonly listener: Listener;
  readonly coverage: Owned;
};

/** Composes the object's host as `NyteHost`'s constructor describes. */
async function compose(
  state: WorkerState,
  env: WorkerEnv,
  models: Models | undefined,
): Promise<Served> {
  const { storage } = state;
  const key = env.NYTE_SECRET_KEY;

  const host = await composeHost({
    store: durableObjectStore(storage),
    models: models ?? createModels(),
    plugins: [{ id: "chat-only", environment: chatOnlyProvider() }],
    workspace: { kind: "chat-only", locator: null },
    execution: { kind: "admit-only" },
    secrets:
      key === undefined || key === ""
        ? undefined
        : { key: async () => Uint8Array.from(atob(key), (character) => character.charCodeAt(0)) },
    home: null,
    operations: operations(),
    description: { name: "nyte-host", platform: "cloudflare", version: manifest.version },
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
    });

    await storage.setAlarm(Date.now());

    return { host, listener, coverage };
  } catch (error) {
    await host.close();

    throw error;
  }
}

/** Returns the object's `nyte_schedule` table, created if absent: the heads it owes a step and when. */
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
      entry: { readonly session: SessionId; readonly head: HeadName; readonly at: number | null },
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

function keyOf(session: SessionId, head: HeadName): string {
  return JSON.stringify([session, head]);
}
