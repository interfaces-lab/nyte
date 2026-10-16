import { isJson } from "@nyte-ai/schema";
import type { Json, ObjectId } from "@nyte-ai/schema";
import { objectId } from "../util/content.ts";
import { SdkError } from "../util/error.ts";
import { isJsonObject } from "../util/json-schema.ts";

export type StoreDialect = "sqlite" | "postgres";

interface SchemaStep {
  readonly kind: "schema";
  readonly name: string;
  readonly sql: { readonly [D in StoreDialect]: readonly string[] };
}

interface RewriteStep {
  readonly kind: "rewrite";
  readonly name: string;
  rewrite(record: Json): Json | null;
}

type StoreStep = SchemaStep | RewriteStep;

export interface StoreStamp {
  readonly version: number;
  readonly empty: boolean;
}

export interface StoredRecord {
  readonly name: string;
  readonly revision: string;
  readonly body: string;
}

interface Repoint {
  readonly name: string;
  readonly expect: string;
  readonly id: ObjectId;
  readonly body: string;
}

export interface StoreChange {
  readonly from: number;
  readonly to: number;

  readonly sql: readonly string[];
  readonly repoints: readonly Repoint[];
  /** Rebuild the session read index from current refs inside the migration transaction. */
  readonly reindexSessions: boolean;
}

export type CommitOutcome = "committed" | "moved" | "conflict";

export interface MigrationTarget {
  readonly dialect: StoreDialect;
  stamp(): Promise<StoreStamp>;
  records(): Promise<readonly StoredRecord[]>;
  commit(change: StoreChange): Promise<CommitOutcome>;
  backup?(from: number, to: number): Promise<void>;
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

const STORE_STEPS: readonly StoreStep[] = [
  baseline,
  recordFields,
  sessionIndex,
  orderedSessionIndex,
  logKindIndex,
  workspaceTrust,
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

    if (attempt === 0 && !stamp.empty) await target.backup?.(stamp.version, STORE_VERSION);
    const rewrites = steps.flatMap((step) => (step.kind === "rewrite" ? [step] : []));

    const outcome = await target.commit({
      from: stamp.version,
      to: STORE_VERSION,
      sql: steps.flatMap((step) => (step.kind === "schema" ? step.sql[target.dialect] : [])),
      repoints:
        stamp.empty || rewrites.length === 0
          ? []
          : await repoints(rewrites, await target.records()),
      reindexSessions: steps.includes(sessionIndex) || steps.includes(orderedSessionIndex),
    });

    if (outcome === "committed") return;
  }

  throw new SdkError(
    "unavailable",
    "Nyte couldn't update its data because another Nyte kept writing to it. Try again.",
  );
}

async function repoints(
  rewrites: readonly RewriteStep[],
  records: readonly StoredRecord[],
): Promise<readonly Repoint[]> {
  const moved: Repoint[] = [];

  for (const stored of records) {
    const record = parsed(stored.body);

    if (record === null) continue;
    const next = rewrites.reduce((value, step) => step.rewrite(value) ?? value, record);

    if (next === record) continue;
    moved.push({
      name: stored.name,
      expect: stored.revision,
      id: await objectId(next),
      body: JSON.stringify(next),
    });
  }

  return moved;
}

function parsed(body: string): Json | null {
  try {
    const value: unknown = JSON.parse(body);

    return isJson(value) ? value : null;
  } catch {
    return null;
  }
}
