import { DatabaseSync } from "node:sqlite";
import {
  decodeCallRecord,
  decodeCommitRecord,
  decodeHostIdentity,
  decodeInboxRecord,
  decodeLease,
  decodeObject,
  decodePartRecord,
  decodePrincipalRecord,
  decodeReceiptRecord,
  decodeRunRecord,
  decodeSeenRecord,
  decodeSessionRecord,
  decodeWorkspaceRecord,
  loggedEvent,
  objectId,
  projectSessionIndex,
  STORE_VERSION,
} from "@nyte-ai/core/store";
import type { RecordKind } from "@nyte-ai/core/store";
import { isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import { changedPaths, derivedRefs, MAPPING, migratedLog, migratedRecord } from "./mapping.ts";

type Decode = (object: Json | null) => object | null;

const DECODERS = new Map<string, Decode>(
  Object.entries({
    session: decodeSessionRecord,
    commit: decodeCommitRecord,
    inbox: decodeInboxRecord,
    run: decodeRunRecord,
    part: decodePartRecord,
    receipt: decodeReceiptRecord,
    seen: decodeSeenRecord,
    workspace: decodeWorkspaceRecord,
    lease: decodeLease,
    call: decodeCallRecord,
    principals: decodePrincipalRecord,
    identity: decodeHostIdentity,
  } satisfies Record<Exclude<RecordKind, "kv">, Decode>),
);

interface RefRow {
  readonly target: string | null;
  readonly revision: string;
  readonly body: string | null;
}

interface LogRow {
  readonly seq: number;
  readonly at: number;
  readonly event: string;
}

/** What `verifyMigration` found: every difference `MAPPING` does not explain in `problems`, and counts of what it checked. */
export interface MigrationReport {
  readonly from: number;
  readonly to: number;
  readonly objects: {
    readonly before: number;
    readonly after: number;
    readonly lostOrChanged: number;
  };
  readonly refs: {
    readonly before: number;
    readonly after: number;
    readonly outcomes: Readonly<Record<string, number>>;
    readonly added: Readonly<Record<string, number>>;
  };
  readonly log: { readonly sessions: number; readonly events: number; readonly relogged: number };
  readonly fieldChanges: Readonly<Record<string, number>>;
  readonly decoded: Readonly<Record<string, number>>;
  readonly sessionIndex: { readonly rows: number; readonly pendingWork: number };
  readonly problems: readonly string[];
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A changed field's path with array indexes and `nested` call keys as `*`, so a report counts fields rather than positions. */
function fieldPattern(path: string): string {
  return path.replace(/\/nested\/[^/]+/u, "/nested/*").replace(/\/\d+(?=\/|$)/gu, "/*");
}

function readStamp(database: DatabaseSync, schema: string): number {
  const table = database
    .prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = 'store_meta'`)
    .get();

  return table === undefined
    ? 0
    : Number(
        database.prepare(`SELECT version FROM ${schema}.store_meta WHERE id = 1`).get()?.version ??
          0,
      );
}

function readRefs(database: DatabaseSync, schema: string): Map<string, RefRow> {
  return new Map(
    database
      .prepare(
        `SELECT r.name, r.target, r.revision, o.body FROM ${schema}.refs r LEFT JOIN ${schema}.objects o ON o.id = r.target ORDER BY r.name`,
      )
      .all()
      .map((row) => [
        text(row.name),
        {
          target: row.target === null ? null : text(row.target),
          revision: text(row.revision),
          body: typeof row.body === "string" ? row.body : null,
        },
      ]),
  );
}

function readLog(database: DatabaseSync, schema: string): Map<string, LogRow[]> {
  const sessions = new Map<string, LogRow[]>();

  for (const row of database
    .prepare(`SELECT session, seq, at, event FROM ${schema}.log ORDER BY session, seq`)
    .iterate()) {
    const list = sessions.get(text(row.session)) ?? [];
    list.push({ seq: Number(row.seq), at: Number(row.at), event: text(row.event) });
    sessions.set(text(row.session), list);
  }

  return sessions;
}

function label(event: Json): string {
  return isJsonObject(event)
    ? [event.kind, event.change].filter((part) => typeof part === "string").join("/")
    : "?";
}

/**
 * Compares a store before migration (`beforePath`, only read) with the same
 * store after it (`afterPath`): every object row kept byte for byte; every
 * ref kept, its record either untouched (same target and revision) or
 * repointed to the content-addressed id of exactly the record `MAPPING` maps
 * it to; every added ref one `MAPPING` derives, at the record of the ref it
 * derives from, and every derived ref present; every logged event at its
 * session, seq and time, its body exactly `MAPPING`'s and readable as a
 * `SessionEvent`; every record of a known kind decoding with today's
 * schemas; and the session index and pending work matching what the refs
 * project.
 */
export async function verifyMigration(
  beforePath: string,
  afterPath: string,
): Promise<MigrationReport> {
  const database = new DatabaseSync(afterPath, { readOnly: true });
  database.exec(`ATTACH DATABASE '${beforePath.replaceAll("'", "''")}' AS before`);
  const problems: string[] = [];
  const fieldChanges = new Map<string, number>();

  try {
    const from = readStamp(database, "before");
    const to = readStamp(database, "main");

    if (to !== STORE_VERSION)
      problems.push(`store_meta is ${to}, not STORE_VERSION ${STORE_VERSION}`);

    if (MAPPING.at(-1)?.version !== STORE_VERSION)
      problems.push(
        `MAPPING ends at ${MAPPING.at(-1)?.version}, STORE_VERSION is ${STORE_VERSION}`,
      );

    const lostOrChanged = Number(
      database
        .prepare(
          "SELECT count(*) AS n FROM before.objects b LEFT JOIN main.objects a ON a.id = b.id WHERE a.id IS NULL OR a.body IS NOT b.body OR a.bytes IS NOT b.bytes",
        )
        .get()?.n,
    );

    if (lostOrChanged > 0) problems.push(`${lostOrChanged} objects lost or changed`);
    const objectsBefore = Number(
      database.prepare("SELECT count(*) AS n FROM before.objects").get()?.n,
    );
    const objectsAfter = Number(
      database.prepare("SELECT count(*) AS n FROM main.objects").get()?.n,
    );
    const refsBefore = readRefs(database, "before");
    const refsAfter = readRefs(database, "main");
    const outcomes = new Map<string, number>();
    const derived = new Map<string, string | null>();

    for (const [name, row] of refsBefore) {
      const now = refsAfter.get(name);

      if (now === undefined) {
        problems.push(`ref ${name} lost`);
        continue;
      }

      if (row.body === null) {
        if (now.target !== row.target || now.revision !== row.revision)
          problems.push(`ref ${name} without a body moved`);
        count(outcomes, "kept (no body)");
        continue;
      }

      const record = decodeObject(row.body);
      const expected = migratedRecord(from, record);
      const kind =
        isJsonObject(record) && typeof record.kind === "string" ? record.kind : "no kind";

      for (const derivedName of derivedRefs(from, name, expected))
        if (!refsBefore.has(derivedName)) derived.set(derivedName, now.target);

      if (expected === record) {
        if (now.target !== row.target || now.revision !== row.revision)
          problems.push(`ref ${name} moved with no mapped change`);
        count(outcomes, `kept ${kind}`);
        continue;
      }

      const body = now.body === null ? null : decodeObject(now.body);

      if (!Value.Equal(body, expected)) {
        problems.push(
          `ref ${name} (${kind}) is not its mapped record at ${changedPaths(expected, body).join(", ")}`,
        );
        continue;
      }

      if (now.target !== (await objectId(expected)))
        problems.push(`ref ${name} target is not its body's id`);

      for (const path of changedPaths(record, expected))
        count(fieldChanges, `${kind} ${fieldPattern(path)}`);
      count(outcomes, `rewritten ${kind}`);
    }

    const added = new Map<string, number>();

    for (const [name, row] of refsAfter) {
      if (refsBefore.has(name)) continue;

      if (!derived.has(name)) problems.push(`ref ${name} added outside the mapping`);
      else if (derived.get(name) !== row.target)
        problems.push(`ref ${name} added at the wrong record`);
      const [root, second, third] = name.split("/");
      count(added, root === "waits" ? `waits/${second ?? ""}` : `${root ?? ""}/*/${third ?? ""}`);
    }

    for (const name of derived.keys())
      if (!refsAfter.has(name)) problems.push(`mapped ref ${name} was not added`);

    const logBefore = readLog(database, "before");
    const logAfter = readLog(database, "main");
    let events = 0;
    let relogged = 0;

    if (logAfter.size !== logBefore.size)
      problems.push(`log holds ${logAfter.size} sessions, held ${logBefore.size}`);

    for (const [session, rows] of logBefore) {
      const now = logAfter.get(session) ?? [];

      if (now.length !== rows.length) {
        problems.push(`session ${session} logs ${now.length} events, logged ${rows.length}`);
        continue;
      }

      const originals = rows.map((row) => decodeObject(row.event));
      const expected = migratedLog(from, originals);

      for (const [index, row] of rows.entries()) {
        events += 1;
        const current = now[index];

        if (current === undefined || current.seq !== row.seq || current.at !== row.at) {
          problems.push(`session ${session} seq ${row.seq} moved`);
          continue;
        }

        const event = decodeObject(current.event);

        if (!Value.Equal(event, expected[index])) {
          problems.push(
            `session ${session} seq ${row.seq} is not its mapped event at ${changedPaths(expected[index], event).join(", ")}`,
          );
          continue;
        }

        try {
          loggedEvent(current.seq, current.at, event);
        } catch {
          problems.push(`session ${session} seq ${row.seq} does not read as a SessionEvent`);
        }

        if (current.event === row.event) continue;
        relogged += 1;
        const original = originals[index] ?? null;

        for (const path of changedPaths(original, event))
          count(fieldChanges, `log ${label(original)} ${fieldPattern(path)}`);
      }
    }

    const decoded = new Map<string, number>();
    const indexed = new Map<string, Json>();
    const pending = new Map<string, string>();

    for (const [name, row] of refsAfter) {
      const record = row.body === null ? null : decodeObject(row.body);
      const kind =
        isJsonObject(record) && typeof record.kind === "string" ? record.kind : "no kind";
      const decode = DECODERS.get(kind);

      if (decode === undefined) count(decoded, `unchecked ${kind}`);
      else if (decode(record) === null) problems.push(`ref ${name} (${kind}) does not decode`);
      else count(decoded, kind);
      const entry = projectSessionIndex(name, record);

      if (entry === null) continue;

      if (entry.kind === "session")
        indexed.set(name, { session: entry.session, parent: entry.parent, sortAt: -entry.at });
      else pending.set(name, entry.kind);
    }

    const indexRows = database
      .prepare("SELECT name, session, parent, sort_at, version FROM main.session_index")
      .all();
    const pendingRows = database.prepare("SELECT name, kind FROM main.pending_work").all();

    for (const row of indexRows)
      if (
        !Value.Equal(indexed.get(text(row.name)), {
          session: row.session,
          parent: row.parent,
          sortAt: row.sort_at,
        }) ||
        text(row.version) === ""
      )
        problems.push(`session_index row ${text(row.name)} does not match its ref`);

    if (indexRows.length !== indexed.size)
      problems.push(
        `session_index holds ${indexRows.length} rows, the refs project ${indexed.size}`,
      );

    for (const row of pendingRows)
      if (pending.get(text(row.name)) !== row.kind)
        problems.push(`pending_work row ${text(row.name)} does not match its ref`);

    if (pendingRows.length !== pending.size)
      problems.push(
        `pending_work holds ${pendingRows.length} rows, the refs project ${pending.size}`,
      );

    return {
      from,
      to,
      objects: { before: objectsBefore, after: objectsAfter, lostOrChanged },
      refs: {
        before: refsBefore.size,
        after: refsAfter.size,
        outcomes: Object.fromEntries(
          [...outcomes].sort(([left], [right]) => left.localeCompare(right)),
        ),
        added: Object.fromEntries([...added].sort(([left], [right]) => left.localeCompare(right))),
      },
      log: { sessions: logBefore.size, events, relogged },
      fieldChanges: Object.fromEntries(
        [...fieldChanges].sort(([left], [right]) => left.localeCompare(right)),
      ),
      decoded: Object.fromEntries(
        [...decoded].sort(([left], [right]) => left.localeCompare(right)),
      ),
      sessionIndex: { rows: indexRows.length, pendingWork: pendingRows.length },
      problems,
    };
  } finally {
    database.close();
  }
}
