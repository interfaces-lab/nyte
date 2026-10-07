/**
 * The durable record behind `environment.start`. One row per authenticated
 * principal and request id, written before any side effect and advanced as
 * each step lands: the session is created, its inputs are configured, the
 * first message is admitted. A retry reads the row and resumes from the step
 * it reached; a changed request under the same id conflicts; a deleted
 * session leaves a tombstone so an old retry cannot recreate the work.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const START_STATES = ["allocated", "created", "configured", "admitted", "deleted"] as const;

export type StartState = (typeof START_STATES)[number];

const RowSchema = Type.Object({
  principal: Type.String(),
  request_id: Type.String(),
  input_hash: Type.String(),
  input: Type.String(),
  workspace_id: Type.String(),
  session_id: Type.String(),
  message_key: Type.String(),
  state: Type.Enum(START_STATES),
  change: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Number(),
  updated_at: Type.Number(),
});

type Row = Static<typeof RowSchema>;

export interface StartRecord {
  readonly principal: string;
  readonly requestId: string;
  readonly inputHash: string;
  /** The request as first accepted, JSON; a resumed start replays exactly this. */
  readonly input: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly messageKey: string;
  readonly state: StartState;
  /** The admitted change, once `admitted`. */
  readonly change: string | undefined;
}

function recordOf(row: Row): StartRecord {
  return {
    principal: row.principal,
    requestId: row.request_id,
    inputHash: row.input_hash,
    input: row.input,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    messageKey: row.message_key,
    state: row.state,
    change: row.change ?? undefined,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonical(item)).join(",")}]`;

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

/** Key order and `undefined` members do not change the hash; any value does. */
export function startInputHash(input: unknown): string {
  return createHash("sha256").update(canonical(input)).digest("base64url");
}

export class StartJournal {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS starts (
        principal TEXT NOT NULL,
        request_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        input TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_key TEXT NOT NULL,
        state TEXT NOT NULL,
        change TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (principal, request_id)
      );
      CREATE INDEX IF NOT EXISTS starts_session ON starts (session_id);
    `);
  }

  private row(principal: string, requestId: string): StartRecord | undefined {
    const found: unknown = this.db
      .prepare("SELECT * FROM starts WHERE principal = ? AND request_id = ?")
      .get(principal, requestId);

    if (found === undefined) return undefined;

    if (!Value.Check(RowSchema, found)) throw new Error("Corrupt start record");

    return recordOf(found);
  }

  /**
   * The record for this request: the existing one, or a fresh `allocated`
   * row with the identities the caller minted. Insert-or-read in one
   * statement, so two concurrent first calls converge on one row.
   */
  begin(input: {
    readonly principal: string;
    readonly requestId: string;
    readonly inputHash: string;
    readonly input: string;
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly messageKey: string;
  }): StartRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO starts
           (principal, request_id, input_hash, input, workspace_id, session_id, message_key, state, change, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'allocated', NULL, ?, ?)`,
      )
      .run(
        input.principal,
        input.requestId,
        input.inputHash,
        input.input,
        input.workspaceId,
        input.sessionId,
        input.messageKey,
        now,
        now,
      );
    const record = this.row(input.principal, input.requestId);

    if (record === undefined) throw new Error("Start record vanished after insert");

    return record;
  }

  /**
   * Move one step forward, only from the state the caller holds: a stale
   * caller (or one racing a tombstone) changes nothing and reads back what
   * the row became. Transitions never leave `deleted`.
   */
  advance(record: StartRecord, state: StartState, change?: string): StartRecord {
    const result = this.db
      .prepare(
        "UPDATE starts SET state = ?, change = COALESCE(?, change), updated_at = ? WHERE principal = ? AND request_id = ? AND state = ? AND state != 'deleted'",
      )
      .run(state, change ?? null, Date.now(), record.principal, record.requestId, record.state);

    if (result.changes === 1) return { ...record, state, change: change ?? record.change };
    const current = this.row(record.principal, record.requestId);

    if (current === undefined) throw new Error("Start record vanished");

    return current;
  }

  /** Every record that minted `sessionId`, in any state. */
  bySession(sessionId: string): readonly StartRecord[] {
    const rows: unknown = this.db
      .prepare("SELECT * FROM starts WHERE session_id = ?")
      .all(sessionId);

    if (!Value.Check(Type.Array(RowSchema), rows)) throw new Error("Corrupt start records");

    return rows.map(recordOf);
  }

  /**
   * What a root is, from its records: `unminted` when this journal never
   * created it, `tombstoned` once any record says deleted, `sealed` once
   * every record is admitted, `unsealed` while a start is still under way.
   */
  rootState(sessionId: string): "unminted" | "unsealed" | "sealed" | "tombstoned" {
    const records = this.bySession(sessionId);

    if (records.length === 0) return "unminted";

    if (records.some((record) => record.state === "deleted")) return "tombstoned";

    return records.every((record) => record.state === "admitted") ? "sealed" : "unsealed";
  }

  /** Roots whose start is admitted and not tombstoned: the ones this process drives. */
  admitted(): readonly string[] {
    const rows: unknown = this.db
      .prepare("SELECT * FROM starts WHERE state = 'admitted' ORDER BY created_at")
      .all();

    if (!Value.Check(Type.Array(RowSchema), rows)) throw new Error("Corrupt start records");

    return [...new Set(rows.map((row) => row.session_id))].filter(
      (id) => this.rootState(id) === "sealed",
    );
  }

  /** Roots whose deletion began; startup finishes what an interrupted delete left. */
  tombstoned(): readonly string[] {
    const rows: unknown = this.db
      .prepare("SELECT * FROM starts WHERE state = 'deleted' ORDER BY updated_at")
      .all();

    if (!Value.Check(Type.Array(RowSchema), rows)) throw new Error("Corrupt start records");

    return [...new Set(rows.map((row) => row.session_id))];
  }

  /** Every record, finished or not, that targets the workspace; a folder with any is not forgettable. */
  byWorkspace(workspaceId: string): readonly StartRecord[] {
    const rows: unknown = this.db
      .prepare("SELECT * FROM starts WHERE workspace_id = ? AND state != 'deleted'")
      .all(workspaceId);

    if (!Value.Check(Type.Array(RowSchema), rows)) throw new Error("Corrupt start records");

    return rows.map(recordOf);
  }

  /** Records a crash left between steps, oldest first; startup resumes them before serving. */
  pending(): readonly StartRecord[] {
    const rows: unknown = this.db
      .prepare(
        "SELECT * FROM starts WHERE state IN ('allocated', 'created', 'configured') ORDER BY created_at",
      )
      .all();

    if (!Value.Check(Type.Array(RowSchema), rows)) throw new Error("Corrupt start records");

    return rows.map(recordOf);
  }

  /** The session is being deleted: every request that created it is a tombstone from now on, before the store forgets it. */
  tombstone(sessionId: string): void {
    this.db
      .prepare("UPDATE starts SET state = 'deleted', updated_at = ? WHERE session_id = ?")
      .run(Date.now(), sessionId);
  }

  close(): void {
    this.db.close();
  }
}
