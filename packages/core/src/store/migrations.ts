import {
  compile,
  FileStatusType,
  HunkType,
  isJson,
  isJsonObject,
  SdkError,
  writePatch,
} from "@nyte-ai/schema";
import type { Json, ObjectId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { decodeCallRecord, decodeRunRecord } from "../contract/records.ts";
import { objectId } from "../util/content.ts";
import { callRef, liveRef, parseSessionRef, runRef } from "./refs.ts";
import { waitIndex, wokenIndex } from "./wait-index.ts";

export type StoreDialect = "sqlite" | "postgres";

/** Adds structure or rebuilds tables derived from refs and objects; a change to stored records is a `RewriteStep`. */
interface SchemaStep {
  readonly kind: "schema";
  readonly name: string;
  readonly sql: { readonly [D in StoreDialect]: readonly string[] };
}

/** Rewrites stored records (`rewrite`, one record or null to keep it), logged events (`rewriteLog`, one session's events in seq order, each rewritten or null to keep it), or derives new refs from a record (`adds`, the names of refs to create at the record the ref `name` holds, after every step's rewrite; one that exists is kept). */
interface RewriteStep {
  readonly kind: "rewrite";
  readonly name: string;
  rewrite?(record: Json): Json | null;
  rewriteLog?(events: readonly Json[]): readonly (Json | null)[];
  adds?(name: string, record: Json): readonly string[];
}

type StoreStep = SchemaStep | RewriteStep;

export interface StoreStamp {
  readonly version: number;
  readonly empty: boolean;
}

export interface StoredRecord {
  readonly name: string;
  readonly target: ObjectId;
  readonly revision: string;
  readonly body: string;
}

interface Repoint {
  readonly name: string;
  readonly expect: string;
  readonly id: ObjectId;
  readonly body: string;
}

/** A ref the migration creates at an object it already holds, unless the ref exists. */
interface Creation {
  readonly name: string;
  readonly target: ObjectId;
}

/** One logged event as the store keeps it. */
export interface LoggedRow {
  readonly seq: number;
  readonly event: string;
}

/** A session's logged events, in seq order. */
export interface SessionLog {
  readonly session: string;
  readonly events: readonly LoggedRow[];
}

/** A logged event rewritten in place: the event at `seq` of `session`, which must still read `expect`, becomes `event`. */
export interface Relog {
  readonly session: string;
  readonly seq: number;
  readonly expect: string;
  readonly event: string;
}

export interface StoreChange {
  readonly from: number;
  readonly to: number;

  readonly sql: readonly string[];
  readonly repoints: readonly Repoint[];
  readonly creates: readonly Creation[];
  readonly relogs: readonly Relog[];
  /** Rebuild the session read index from current refs inside the migration transaction. */
  readonly reindexSessions: boolean;
}

export type CommitOutcome = "committed" | "moved" | "conflict";

export interface MigrationTarget {
  readonly dialect: StoreDialect;
  stamp(): Promise<StoreStamp>;
  records(): Promise<readonly StoredRecord[]>;
  /** Every session's log, one session at a time; read only when a step rewrites logged events. */
  logs(): AsyncIterable<SessionLog>;
  commit(change: StoreChange): Promise<CommitOutcome>;
  /**
   * Saves the current rows of `refs`, the refs the next commit repoints, and
   * the logged events it rewrites (their `expect`), before it runs. Called only
   * when a rewrite changes records or events: schema steps touch derived tables
   * alone, and objects are never deleted, so these rows are enough to restore
   * the store as it was.
   */
  backup?(from: number, to: number, refs: readonly string[], log: readonly Relog[]): Promise<void>;
}

const metaTable =
  "CREATE TABLE IF NOT EXISTS store_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)";

const baseline: SchemaStep = {
  kind: "schema",
  name: "baseline",
  sql: {
    sqlite: [
      "CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL)",
      "CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
      metaTable,
    ],
    postgres: [
      "CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BYTEA NULL)",
      'CREATE TABLE IF NOT EXISTS refs (name TEXT COLLATE "C" PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)',
      "CREATE TABLE IF NOT EXISTS log (session TEXT NOT NULL, seq BIGINT NOT NULL, at BIGINT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
      metaTable,
    ],
  },
};

type JsonObject = { readonly [key: string]: Json };

function patched(object: Json, patch: (body: JsonObject) => JsonObject): Json | null {
  if (!isJsonObject(object) || !isJsonObject(object.body)) return null;
  const body = patch(object.body);

  return body === object.body ? null : { ...object, body };
}

function filled(body: JsonObject, defaults: JsonObject): JsonObject {
  const missing = Object.entries(defaults).filter(([key]) => !(key in body));

  return missing.length === 0 ? body : { ...body, ...Object.fromEntries(missing) };
}

const recordFields: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-12-record-fields",
  rewrite(object) {
    if (!isJsonObject(object)) return null;

    switch (object.kind) {
      case "call":
        return patched(object, (body) => filled(body, { reran: null }));
      case "inbox":
        return patched(object, (body) => filled(body, { pendingInput: [] }));
      case "run":
        return patched(object, (body) =>
          filled(body, { waitedBy: [], parked: [], lastSnapshot: null }),
        );
      case "principals":
        return patched(object, (body) => {
          const principals = Array.isArray(body.principals) ? body.principals : [];
          const dated = principals.some((entry) => isJsonObject(entry) && "lastSeenAt" in entry);

          if (!dated && "codes" in body) return body;

          return {
            ...filled(body, { codes: [] }),
            principals: principals.map((entry) =>
              isJsonObject(entry)
                ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "lastSeenAt"))
                : entry,
            ),
          };
        });
      default:
        return null;
    }
  },
};

const sessionIndex: SchemaStep = {
  kind: "schema",
  name: "2026-10-14-session-index",
  sql: {
    sqlite: [
      "CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, sort_at REAL NOT NULL, version TEXT NOT NULL)",
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      "CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL)",
      "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
      "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
    ],
    postgres: [
      'CREATE TABLE session_index (name TEXT COLLATE "C" PRIMARY KEY, session TEXT COLLATE "C" NOT NULL UNIQUE, parent TEXT COLLATE "C" NULL, sort_at DOUBLE PRECISION NOT NULL, version TEXT NOT NULL)',
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      'CREATE TABLE pending_work (name TEXT COLLATE "C" PRIMARY KEY, session TEXT COLLATE "C" NOT NULL, kind TEXT NOT NULL)',
      "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
      "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
    ],
  },
};

const orderedSessionIndex: SchemaStep = {
  kind: "schema",
  name: "2026-10-14-session-index-order",
  sql: {
    sqlite: ["DROP TABLE session_index", "DROP TABLE pending_work", ...sessionIndex.sql.sqlite],
    postgres: ["DROP TABLE session_index", "DROP TABLE pending_work", ...sessionIndex.sql.postgres],
  },
};

const logKindIndex: SchemaStep = {
  kind: "schema",
  name: "2026-10-15-log-kind-index",
  sql: {
    sqlite: ["CREATE INDEX log_kind ON log(json_extract(event, '$.kind'))"],
    postgres: [],
  },
};

const workspaceTrust: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-15-workspace-trust",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "workspace") return null;

    return patched(object, (body) =>
      body.projectResources === true ? { ...body, projectResources: null } : body,
    );
  },
};

const LEGACY_PATCH = compile(
  Type.Object({
    path: Type.String(),
    status: FileStatusType,
    kind: Type.Literal("text"),
    hunks: Type.Array(HunkType),
  }),
);

/** An edit tool's output from before patches were text: its hunks become the unified diff they stand for. */
function unifiedOutput(output: Json | undefined): Json | null {
  if (!isJsonObject(output) || !LEGACY_PATCH.Check(output)) return null;
  const { hunks, ...entry } = output;

  return { ...entry, patch: writePatch(output.path, output.status, hunks) };
}

function withOutput(outcome: Json | undefined): Json | null {
  if (!isJsonObject(outcome)) return null;
  const output = unifiedOutput(outcome.output);

  return output === null ? null : { ...outcome, output };
}

const patchText: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-patch-text",
  rewrite(object) {
    if (!isJsonObject(object)) return null;

    switch (object.kind) {
      case "call":
        return patched(object, (body) => {
          const result = withOutput(body.result);
          const nested = isJsonObject(body.nested) ? body.nested : {};

          const outcomes = Object.fromEntries(
            Object.entries(nested).map(([key, outcome]) => [key, withOutput(outcome) ?? outcome]),
          );

          const nestedChanged = Object.keys(nested).some((key) => outcomes[key] !== nested[key]);

          if (result === null && !nestedChanged) return body;

          return {
            ...body,
            ...(result !== null && { result }),
            ...(nestedChanged && { nested: outcomes }),
          };
        });
      case "part":
        return patched(object, (body) => {
          const state = body.state;

          if (!isJsonObject(state)) return body;
          const outcome = withOutput(state.outcome);

          return outcome === null ? body : { ...body, state: { ...state, outcome } };
        });
      default:
        return null;
    }
  },
  rewriteLog: (events) =>
    events.map((event) => {
      if (!isJsonObject(event) || event.kind !== "call" || event.change !== "settled") return null;
      const outcome = withOutput(event.outcome);

      return outcome === null ? null : { ...event, outcome };
    }),
};

/**
 * A call's `intent` event repeated the name, args and class its part's
 * `created` event, logged in the same write, already holds. The intent keeps
 * only its ids; where an old intent's fields differ from its part's, the
 * part's state takes the intent's, as the fold showed it.
 */
const callIntentOnce: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-call-intent-once",
  rewriteLog(events) {
    const next: (Json | null)[] = events.map(() => null);
    const opened = new Map<Json, number>();

    events.forEach((event, index) => {
      if (!isJsonObject(event)) return;

      if (event.kind === "part" && event.change === "created")
        opened.set(event.part ?? null, index);

      if (event.kind !== "call" || event.change !== "intent") return;
      const { name, args, class: called, ...ids } = event;
      const at = opened.get(event.part ?? null);
      const created = at === undefined ? undefined : (next[at] ?? events[at]);

      if (name === undefined || args === undefined || called === undefined) return;

      if (at === undefined || !isJsonObject(created) || !isJsonObject(created.state)) return;
      next[index] = ids;
      const state = created.state;

      if (
        Value.Equal(state.name, name) &&
        Value.Equal(state.args, args) &&
        Value.Equal(state.class, called)
      )
        return;
      next[at] = { ...created, state: { ...state, name, args, class: called } };
    });

    return next;
  },
};

/** A run's live ref, the fence its run-scoped writes land under, for each run an older Nyte started and has not stopped: only a run's start wrote one. */
const liveRefs: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-live-refs",
  adds(name, record) {
    const session = parseSessionRef(name);
    const run = decodeRunRecord(record);

    if (session === null || run === null || run.stopping || name !== runRef(session, run.view.id))
      return [];

    return [liveRef(session, run.view.id)];
  },
};

/** The `waits/` index of each call an older Nyte parked: only a park writes it, and every wake reads it. */
const parkedWaitIndex: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-wait-index",
  adds(name, record) {
    const session = parseSessionRef(name);
    const call = decodeCallRecord(record);

    if (
      session === null ||
      call === null ||
      call.result !== null ||
      name !== callRef(session, call.id)
    )
      return [];

    return waitIndex(session, call);
  },
};

/**
 * A `tool` call's intent repeated the name and args of its part, written in
 * the same step. The intent keeps its caller (principal, arguments error); a
 * recovering host reads the name and args from the part. A before_tool gate
 * that changed the args kept the model's call in its hook call's intent.
 */
const toolArgsInPart: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-tool-args-in-part",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "call") return null;

    return patched(object, (body) => {
      const intent = body.intent;

      if (body.kind !== "tool" || !isJsonObject(intent) || !("name" in intent || "args" in intent))
        return body;

      return {
        ...body,
        intent: Object.fromEntries(
          Object.entries(intent).filter(([key]) => key !== "name" && key !== "args"),
        ),
      };
    });
  },
};

/** An unopened tool call's intent records its position among its response's calls, the order a recovering host runs them in; an older Nyte's has none, and keeps the call-id order it ran in, from position 0. */
const intentPosition: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-intent-position",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "call") return null;

    return patched(object, (body) =>
      body.kind !== "intent" || !isJsonObject(body.intent) || "position" in body.intent
        ? body
        : { ...body, intent: { ...body.intent, position: 0 } },
    );
  },
};

/** The `woken/` index of each call an older Nyte woke and had not stepped since: only a wake writes it, and a poll for other processes' wakes reads only it. */
const wokenCalls: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-woken-index",
  adds(name, record) {
    const session = parseSessionRef(name);
    const call = decodeCallRecord(record);

    if (
      session === null ||
      call === null ||
      call.result !== null ||
      call.waiting !== null ||
      call.waits.length === 0 ||
      name !== callRef(session, call.id)
    )
      return [];

    return [wokenIndex(session, call.id)];
  },
};

const BeforeToolHookType = Type.Object({
  kind: Type.Literal("hook"),
  id: Type.String({ pattern: "^hook:before_tool:" }),
});

/** A before_tool hook call's intent repeated the tool call its part holds, and a gate's `modify` result the whole changed call. The intent keeps its principal, and the result the changed args alone. */
const hookToolArgs: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-hook-tool-args",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "call") return null;

    return patched(object, (body) => {
      if (!Value.Check(BeforeToolHookType, { kind: body.kind, id: body.id })) return body;
      const { intent, result } = body;
      let next = body;

      if (isJsonObject(intent) && "args" in intent)
        next = { ...next, intent: { principal: intent.principal ?? null } };

      if (isJsonObject(result) && result.action === "modify" && isJsonObject(result.value))
        next = { ...next, result: { action: "modify", value: result.value.args ?? null } };

      return next;
    });
  },
};

/** A workspace record names the session it isolates in a git worktree, or `null` for a folder the user added. */
const workspaceIsolation: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-16-workspace-isolation",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "workspace") return null;

    return patched(object, (body) => filled(body, { isolation: null }));
  },
};

/** One fold checkpoint per session, a cache over the log that core rewrites when a fold settles and ignores when it cannot decode one. Postgres keeps none. */
const foldCheckpoints: SchemaStep = {
  kind: "schema",
  name: "2026-10-16-fold-checkpoints",
  sql: {
    sqlite: [
      "CREATE TABLE IF NOT EXISTS fold_checkpoints (session TEXT PRIMARY KEY, seq INTEGER NOT NULL, body TEXT NOT NULL)",
    ],
    postgres: [],
  },
};

const STORE_STEPS: readonly StoreStep[] = [
  baseline,
  recordFields,
  sessionIndex,
  orderedSessionIndex,
  logKindIndex,
  workspaceTrust,
  patchText,
  callIntentOnce,
  liveRefs,
  parkedWaitIndex,
  toolArgsInPart,
  intentPosition,
  wokenCalls,
  hookToolArgs,
  workspaceIsolation,
  foldCheckpoints,
];

export const STORE_VERSION: number = STORE_STEPS.length;

export function assertStoreVersion(version: number): void {
  if (version > STORE_VERSION)
    throw new SdkError(
      "unavailable",
      `This data was updated by a newer version of Nyte (store version ${version}; this version reads up to ${STORE_VERSION}). Update Nyte to open it.`,
    );
}

const COMMIT_ATTEMPTS = 3;

export async function migrateStore(target: MigrationTarget): Promise<void> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    const stamp = await target.stamp();
    assertStoreVersion(stamp.version);

    if (stamp.version === STORE_VERSION) return;
    const steps = STORE_STEPS.slice(stamp.version);

    const rewrites = steps.flatMap((step) => (step.kind === "rewrite" ? [step] : []));

    const { moved, created } =
      stamp.empty || !rewrites.some((step) => step.rewrite !== undefined || step.adds !== undefined)
        ? { moved: [], created: [] }
        : await rewriteRecords(rewrites, await target.records());

    const relogged =
      stamp.empty || !rewrites.some((step) => step.rewriteLog !== undefined)
        ? []
        : await relogs(rewrites, target.logs());

    if (moved.length > 0 || relogged.length > 0)
      await target.backup?.(
        stamp.version,
        STORE_VERSION,
        moved.map((repoint) => repoint.name),
        relogged,
      );

    const outcome = await target.commit({
      from: stamp.version,
      to: STORE_VERSION,
      sql: steps.flatMap((step) => (step.kind === "schema" ? step.sql[target.dialect] : [])),
      repoints: moved,
      creates: created,
      relogs: relogged,
      reindexSessions: steps.includes(sessionIndex) || steps.includes(orderedSessionIndex),
    });

    if (outcome === "committed") return;
  }

  throw new SdkError(
    "unavailable",
    "Nyte couldn't update its data because another Nyte kept writing to it. Try again.",
  );
}

async function rewriteRecords(
  rewrites: readonly RewriteStep[],
  records: readonly StoredRecord[],
): Promise<{ readonly moved: readonly Repoint[]; readonly created: readonly Creation[] }> {
  const moved: Repoint[] = [];
  const created: Creation[] = [];

  for (const stored of records) {
    const record = parsed(stored.body);

    if (record === null) continue;
    const next = rewrites.reduce((value, step) => step.rewrite?.(value) ?? value, record);
    const adds = rewrites.flatMap((step) => step.adds?.(stored.name, next) ?? []);

    if (next === record && adds.length === 0) continue;
    const id = next === record ? stored.target : await objectId(next);

    if (next !== record)
      moved.push({ name: stored.name, expect: stored.revision, id, body: JSON.stringify(next) });

    for (const name of adds) created.push({ name, target: id });
  }

  return { moved, created };
}

async function relogs(
  rewrites: readonly RewriteStep[],
  logs: AsyncIterable<SessionLog>,
): Promise<readonly Relog[]> {
  const relogged: Relog[] = [];

  for await (const log of logs) {
    const rows = log.events.flatMap((row) => {
      const event = parsed(row.event);

      return event === null ? [] : [{ row, event }];
    });

    const rewritten = rewrites.reduce<readonly Json[]>(
      (events, step) => {
        const next = step.rewriteLog?.(events);

        return next === undefined ? events : events.map((event, index) => next[index] ?? event);
      },
      rows.map((entry) => entry.event),
    );

    rows.forEach(({ row, event }, index) => {
      const next = rewritten[index];

      if (next === undefined || next === event) return;
      relogged.push({
        session: log.session,
        seq: row.seq,
        expect: row.event,
        event: JSON.stringify(next),
      });
    });
  }

  return relogged;
}

function parsed(body: string): Json | null {
  try {
    const value: unknown = JSON.parse(body);

    return isJson(value) ? value : null;
  } catch {
    return null;
  }
}
