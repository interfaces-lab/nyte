import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { hashObject } from "./hash.ts";
import { canonicalJson, type JsonObject, type JsonValue } from "./json.ts";
import { CursorExpired } from "./model.ts";
import { isRefName, newOwnerId } from "./names.ts";
import { sql } from "./sql.ts";
import { UnknownSession } from "./store.ts";
import type {
  Actor,
  Event,
  EventBody,
  Lease,
  Obj,
  Oid,
  RefName,
  RefUpdate,
  RefUpdateOutcome,
  Seq,
  ToolProgress,
} from "./model.ts";
import type {
  AppendOutcome,
  Events,
  Leases,
  Objects,
  Refs,
  RefUpdateOptions,
  Session,
  SessionInfo,
  Store,
} from "./store.ts";

const DEFAULT_WATCH_POLL_INTERVAL_MS = 25;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  next_seq INTEGER NOT NULL,
  event_floor INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS objects (
  session_id TEXT NOT NULL,
  oid TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (session_id, oid)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS refs (
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  oid TEXT NOT NULL,
  PRIMARY KEY (session_id, name)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS leases (
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  fence INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, name)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;
`;

/**
 * Bumped whenever the tables change shape. There is no migration: a store an
 * earlier schema wrote is refused with a message that says to delete it, since
 * `CREATE TABLE IF NOT EXISTS` would keep the old shape and fail later.
 */
const SCHEMA_VERSION = 2;

function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  return row === undefined ? 0 : numberColumn(row, "user_version");
}

function isFresh(db: DatabaseSync): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1").get() === undefined
  );
}

const WAL_ATTEMPTS = 40;
const WAL_RETRY_MS = 25;

/**
 * Switching the journal mode needs the file to itself, and SQLite answers
 * "locked" at once rather than waiting the busy timeout. Two processes
 * opening a new store together hit that, so the switch is retried briefly.
 */
function enableWal(db: DatabaseSync): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      db.exec("PRAGMA journal_mode=WAL");
      return;
    } catch (error) {
      if (attempt >= WAL_ATTEMPTS) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAL_RETRY_MS);
    }
  }
}

function transact<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed COMMIT has already rolled back.
    }
    throw error;
  }
}

function readTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed COMMIT has already rolled back.
    }
    throw error;
  }
}

type SqliteRow = Record<string, SQLOutputValue>;

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringKey(value: PropertyKey): value is string {
  return typeof value === "string";
}

function isJsonPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isJsonPrimitive(value)) return true;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!isJsonValue(value[index])) return false;
    }
    return true;
  }
  return isRecord(value);
}

function isRecord(value: unknown): value is JsonObject {
  if (!isObjectValue(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (!isStringKey(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !isJsonValue(descriptor.value)) {
      return false;
    }
  }
  return true;
}

function isStringColumn(value: SQLOutputValue | undefined): value is string {
  return typeof value === "string";
}

function isSafeIntegerColumn(value: SQLOutputValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function stringColumn(row: SqliteRow, name: string): string {
  const value = row[name];
  if (!isStringColumn(value)) {
    throw new TypeError(`SQLite column ${name} is not a string`);
  }
  return value;
}

function numberColumn(row: SqliteRow, name: string): number {
  const value = row[name];
  if (!isSafeIntegerColumn(value)) {
    throw new TypeError(`SQLite column ${name} is not a safe integer`);
  }
  return value;
}

const OBJECT_KINDS: ReadonlySet<string> = new Set([
  "commit",
  "change",
  "run",
  "effect",
  "stack",
  "blob",
]);

function isObjectKind(value: JsonValue | undefined): value is Obj["kind"] {
  return typeof value === "string" && OBJECT_KINDS.has(value);
}

/**
 * Stored bytes are trusted exactly as far as git trusts them: an object whose
 * canonical hash is the id it was filed under was written by `put` from a
 * typed `Obj`, so its fields are the writer's. Anything else is corruption, not
 * a value.
 */
function parseObject(raw: string, oid: Oid): Obj {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !isObjectKind(value.kind)) {
    throw new TypeError(`Stored object ${oid} has an unknown kind`);
  }
  // SAFETY: the hash below proves these bytes are what `put` serialized from an `Obj`.
  const object = value as Obj;
  if (hashObject(object) !== oid)
    throw new TypeError(`Stored object ${oid} does not match its hash`);
  return object;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isActor(value: unknown): value is Actor {
  return (
    isRecord(value) &&
    (value.clientId === undefined || typeof value.clientId === "string") &&
    (value.userId === undefined || typeof value.userId === "string") &&
    (value.device === undefined || typeof value.device === "string")
  );
}

function isToolProgress(value: unknown): value is ToolProgress {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    (value.title === undefined || typeof value.title === "string")
  );
}

/** Events carry no hash, so each kind is checked field by field. */
function isEventBody(value: unknown): value is EventBody {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "ref":
      return (
        typeof value.name === "string" &&
        isNullableString(value.from) &&
        isNullableString(value.to) &&
        typeof value.reason === "string" &&
        (value.actor === undefined || isActor(value.actor))
      );
    case "delta":
      return (
        typeof value.runId === "string" &&
        typeof value.attempt === "number" &&
        typeof value.index === "number" &&
        (value.part === "text" || value.part === "thinking") &&
        typeof value.delta === "string"
      );
    case "progress":
      return (
        typeof value.runId === "string" &&
        typeof value.callId === "string" &&
        isToolProgress(value.progress)
      );
    case "notice":
      return (
        (value.level === "info" || value.level === "warn" || value.level === "error") &&
        typeof value.owner === "string" &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

function parseEventBody(raw: string): EventBody {
  const value: unknown = JSON.parse(raw);
  if (!isEventBody(value)) throw new TypeError("Stored event is not a known event body");
  return value;
}

function encodeEventBody(body: EventBody): string {
  const encoded = JSON.stringify(body);
  if (encoded === undefined) throw new TypeError("Event body is not JSON serializable");
  return encoded;
}

function allocateSeq(options: {
  readonly db: DatabaseSync;
  readonly sessionId: string;
  readonly count: number;
}): Seq {
  const row = sql`SELECT next_seq FROM sessions WHERE id = ${options.sessionId}`.get(options.db);
  if (row === undefined) throw new UnknownSession(options.sessionId);
  const nextSeq = numberColumn(row, "next_seq");
  sql`UPDATE sessions SET next_seq = ${nextSeq + options.count}
    WHERE id = ${options.sessionId}`.run(options.db);
  return nextSeq;
}

function readLastSeq(db: DatabaseSync, sessionId: string): Seq {
  const row = sql`SELECT next_seq FROM sessions WHERE id = ${sessionId}`.get(db);
  if (row === undefined) throw new UnknownSession(sessionId);
  return numberColumn(row, "next_seq") - 1;
}

function readEventFloor(db: DatabaseSync, sessionId: string): Seq {
  const row = sql`SELECT event_floor FROM sessions WHERE id = ${sessionId}`.get(db);
  if (row === undefined) throw new UnknownSession(sessionId);
  return numberColumn(row, "event_floor");
}

function writeEvents(options: {
  readonly db: DatabaseSync;
  readonly sessionId: string;
  readonly bodies: readonly EventBody[];
}): Seq {
  if (options.bodies.length === 0) return readLastSeq(options.db, options.sessionId);
  const firstSeq = allocateSeq({
    db: options.db,
    sessionId: options.sessionId,
    count: options.bodies.length,
  });
  for (let index = 0; index < options.bodies.length; index++) {
    const body = options.bodies[index];
    if (body === undefined) continue;
    const seq = firstSeq + index;
    sql`INSERT INTO events (session_id, seq, at, body)
      VALUES (${options.sessionId}, ${seq}, ${Date.now()}, ${encodeEventBody(body)})`.run(
      options.db,
    );
  }
  return firstSeq + options.bodies.length - 1;
}

function leaseMatches(options: {
  readonly db: DatabaseSync;
  readonly sessionId: string;
  readonly lease: Lease;
}): boolean {
  return (
    sql`SELECT 1 FROM leases
      WHERE session_id = ${options.sessionId} AND name = ${options.lease.name}
        AND owner = ${options.lease.owner} AND fence = ${options.lease.fence}`.get(options.db) !==
    undefined
  );
}

function validateTtl(ttlMs: number, now: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(now + ttlMs)) {
    throw new RangeError("ttlMs must be a positive safe integer");
  }
}

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError("limit must be a non-negative safe integer");
  }
}

function validateUpdates(updates: readonly RefUpdate[]): void {
  if (updates.length === 0) throw new TypeError("refs.update requires at least one update");
  const names = new Set<string>();
  for (const update of updates) {
    if (!isRefName(update.name)) throw new TypeError(`Invalid ref name: ${update.name}`);
    if (names.has(update.name)) throw new TypeError(`Duplicate ref name: ${update.name}`);
    names.add(update.name);
  }
}

class ChangeSubscription {
  private pending = false;
  private resolver: (() => void) | undefined;
  private stopped = false;
  private readonly abortListeners: Array<[AbortSignal, () => void]> = [];
  private readonly onClose: () => void;
  readonly sessionId: string;

  constructor(sessionId: string, signals: readonly AbortSignal[], onClose: () => void) {
    this.sessionId = sessionId;
    this.onClose = onClose;
    if (signals.some((signal) => signal.aborted)) {
      this.stopped = true;
      return;
    }
    for (const signal of signals) {
      const listener = (): void => this.close();
      this.abortListeners.push([signal, listener]);
      signal.addEventListener("abort", listener, { once: true });
    }
  }

  get closed(): boolean {
    return this.stopped;
  }

  wake(): void {
    if (this.stopped) return;
    const resolve = this.resolver;
    if (resolve === undefined) {
      this.pending = true;
      return;
    }
    this.resolver = undefined;
    resolve();
  }

  wait(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pending) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [signal, listener] of this.abortListeners) {
      signal.removeEventListener("abort", listener);
    }
    this.abortListeners.length = 0;
    const resolve = this.resolver;
    this.resolver = undefined;
    resolve?.();
    this.onClose();
  }
}

/** Wakes local watchers immediately and polls data_version only while one exists. */
class SqliteChangeTracker {
  private readonly db: DatabaseSync;
  private readonly pollIntervalMs: number;
  private readonly subscriptions = new Set<ChangeSubscription>();
  private dataVersion: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(db: DatabaseSync, pollIntervalMs: number) {
    this.db = db;
    this.pollIntervalMs = pollIntervalMs;
  }

  subscribe(sessionId: string, signals: readonly AbortSignal[]): ChangeSubscription {
    let subscription: ChangeSubscription;
    subscription = new ChangeSubscription(sessionId, signals, () => {
      this.subscriptions.delete(subscription);
      if (this.subscriptions.size === 0 && this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.dataVersion = undefined;
      }
    });
    if (!this.closed && !subscription.closed) {
      this.subscriptions.add(subscription);
      this.startPolling();
    }
    return subscription;
  }

  notify(sessionId: string): void {
    for (const subscription of this.subscriptions) {
      if (subscription.sessionId === sessionId) subscription.wake();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const subscription of this.subscriptions) subscription.close();
  }

  private startPolling(): void {
    if (this.timer !== undefined || this.closed || this.subscriptions.size === 0) return;
    if (this.dataVersion === undefined) this.dataVersion = this.readDataVersion();
    this.timer = setTimeout(() => this.poll(), this.pollIntervalMs);
    this.timer.unref();
  }

  private poll(): void {
    this.timer = undefined;
    if (this.closed || this.subscriptions.size === 0) return;
    try {
      const next = this.readDataVersion();
      if (this.dataVersion !== next) {
        this.dataVersion = next;
        for (const subscription of this.subscriptions) subscription.wake();
      }
    } catch {
      // A transient read failure is retried. Cursor queries still prevent gaps.
    } finally {
      this.startPolling();
    }
  }

  private readDataVersion(): number {
    const row = sql`PRAGMA data_version`.get(this.db);
    if (row === undefined) throw new Error("Could not read SQLite data_version");
    return numberColumn(row, "data_version");
  }
}

class SessionState {
  readonly id: string;
  readonly db: DatabaseSync;
  readonly changes: SqliteChangeTracker;
  readonly closeController = new AbortController();
  private closed = false;

  constructor(id: string, db: DatabaseSync, changes: SqliteChangeTracker) {
    this.id = id;
    this.db = db;
    this.changes = changes;
  }

  assertOpen(): void {
    if (this.closed || !this.db.isOpen) throw new Error(`Session is closed: ${this.id}`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeController.abort();
  }
}

class SqliteObjects implements Objects {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async put(objects: readonly Obj[]): Promise<readonly Oid[]> {
    this.state.assertOpen();
    const encoded = objects.map((object) => ({
      object,
      oid: hashObject(object),
      body: canonicalJson(object),
    }));
    const at = Date.now();
    transact(this.state.db, () => {
      for (const item of encoded) {
        sql`INSERT OR IGNORE INTO objects (session_id, oid, kind, body, at)
          VALUES (${this.state.id}, ${item.oid}, ${item.object.kind}, ${item.body}, ${at})`.run(
          this.state.db,
        );
      }
    });
    return encoded.map((item) => item.oid);
  }

  async get(oid: Oid): Promise<Obj | undefined> {
    this.state.assertOpen();
    const row = sql`SELECT body FROM objects
      WHERE session_id = ${this.state.id} AND oid = ${oid}`.get(this.state.db);
    return row === undefined ? undefined : parseObject(stringColumn(row, "body"), oid);
  }

  async list(): Promise<readonly { readonly oid: Oid; readonly at: number }[]> {
    this.state.assertOpen();
    return sql`SELECT oid, at FROM objects WHERE session_id = ${this.state.id} ORDER BY oid`
      .all(this.state.db)
      .map((row) => ({ oid: stringColumn(row, "oid"), at: numberColumn(row, "at") }));
  }

  async delete(oids: readonly Oid[]): Promise<number> {
    this.state.assertOpen();
    return transact(this.state.db, () => {
      let deleted = 0;
      for (const oid of oids) {
        const result = sql`DELETE FROM objects
          WHERE session_id = ${this.state.id} AND oid = ${oid}`.run(this.state.db);
        deleted += Number(result.changes);
      }
      return deleted;
    });
  }
}

class SqliteRefs implements Refs {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async read(name: RefName): Promise<Oid | null> {
    this.state.assertOpen();
    const row = sql`SELECT oid FROM refs
      WHERE session_id = ${this.state.id} AND name = ${name}`.get(this.state.db);
    return row === undefined ? null : stringColumn(row, "oid");
  }

  async list(prefix: string): Promise<readonly { readonly name: RefName; readonly oid: Oid }[]> {
    this.state.assertOpen();
    return sql`SELECT name, oid FROM refs
      WHERE session_id = ${this.state.id} AND substr(name, 1, length(${prefix})) = ${prefix}
      ORDER BY name`
      .all(this.state.db)
      .map((row) => ({
        name: stringColumn(row, "name"),
        oid: stringColumn(row, "oid"),
      }));
  }

  async update(
    updates: readonly RefUpdate[],
    options: RefUpdateOptions,
  ): Promise<RefUpdateOutcome> {
    this.state.assertOpen();
    validateUpdates(updates);
    const outcome = transact(this.state.db, (): RefUpdateOutcome => {
      if (
        options.lease !== undefined &&
        !leaseMatches({
          db: this.state.db,
          sessionId: this.state.id,
          lease: options.lease,
        })
      ) {
        return { ok: false, reason: "fenced" };
      }

      for (const update of updates) {
        const row = sql`SELECT oid FROM refs
          WHERE session_id = ${this.state.id} AND name = ${update.name}`.get(this.state.db);
        const actual = row === undefined ? null : stringColumn(row, "oid");
        if (actual !== update.from) {
          return { ok: false, reason: "conflict", name: update.name, actual };
        }
      }

      // An update whose `to` equals `from` asserts the ref and writes nothing:
      // no row change, no event. Every publish asserts `refs/deleted` this way.
      const writes = updates.filter((update) => update.to !== update.from);
      for (const update of writes) {
        if (update.to === null) {
          sql`DELETE FROM refs
            WHERE session_id = ${this.state.id} AND name = ${update.name}`.run(this.state.db);
        } else {
          sql`INSERT INTO refs (session_id, name, oid)
            VALUES (${this.state.id}, ${update.name}, ${update.to})
            ON CONFLICT(session_id, name) DO UPDATE SET oid = excluded.oid`.run(this.state.db);
        }
      }

      const refEvents: EventBody[] = writes.map((update) =>
        options.actor === undefined
          ? {
              kind: "ref",
              name: update.name,
              from: update.from,
              to: update.to,
              reason: options.reason,
            }
          : {
              kind: "ref",
              name: update.name,
              from: update.from,
              to: update.to,
              reason: options.reason,
              actor: options.actor,
            },
      );
      const seq = writeEvents({
        db: this.state.db,
        sessionId: this.state.id,
        bodies: [...refEvents, ...(options.events ?? [])],
      });
      return { ok: true, seq };
    });
    if (outcome.ok) this.state.changes.notify(this.state.id);
    return outcome;
  }
}

class SqliteLeases implements Leases {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async acquire(
    name: string,
    ttlMs: number,
  ): Promise<
    { readonly ok: true; readonly lease: Lease } | { readonly ok: false; readonly holder: Lease }
  > {
    this.state.assertOpen();
    const now = Date.now();
    validateTtl(ttlMs, now);
    return transact(this.state.db, () => {
      const row = sql`SELECT owner, fence, expires_at FROM leases
        WHERE session_id = ${this.state.id} AND name = ${name}`.get(this.state.db);
      if (row !== undefined) {
        const holder: Lease = {
          name,
          owner: stringColumn(row, "owner"),
          fence: numberColumn(row, "fence"),
          expiresAt: numberColumn(row, "expires_at"),
        };
        if (holder.expiresAt > now) return { ok: false, holder };

        const lease: Lease = {
          name,
          owner: newOwnerId(),
          fence: holder.fence + 1,
          expiresAt: now + ttlMs,
        };
        sql`UPDATE leases SET owner = ${lease.owner}, fence = ${lease.fence},
            expires_at = ${lease.expiresAt}
          WHERE session_id = ${this.state.id} AND name = ${name}`.run(this.state.db);
        return { ok: true, lease };
      }

      const lease: Lease = {
        name,
        owner: newOwnerId(),
        fence: 1,
        expiresAt: now + ttlMs,
      };
      sql`INSERT INTO leases (session_id, name, owner, fence, expires_at)
        VALUES (${this.state.id}, ${name}, ${lease.owner}, ${lease.fence},
                ${lease.expiresAt})`.run(this.state.db);
      return { ok: true, lease };
    });
  }

  async renew(lease: Lease, ttlMs: number): Promise<boolean> {
    this.state.assertOpen();
    const now = Date.now();
    validateTtl(ttlMs, now);
    return transact(this.state.db, () => {
      const result = sql`UPDATE leases SET expires_at = ${now + ttlMs}
        WHERE session_id = ${this.state.id} AND name = ${lease.name}
          AND owner = ${lease.owner} AND fence = ${lease.fence}`.run(this.state.db);
      return Number(result.changes) === 1;
    });
  }

  async release(lease: Lease): Promise<boolean> {
    this.state.assertOpen();
    return transact(this.state.db, () => {
      const result = sql`DELETE FROM leases
        WHERE session_id = ${this.state.id} AND name = ${lease.name}
          AND owner = ${lease.owner} AND fence = ${lease.fence}`.run(this.state.db);
      return Number(result.changes) === 1;
    });
  }

  async read(name: string): Promise<Lease | undefined> {
    this.state.assertOpen();
    const row = sql`SELECT owner, fence, expires_at FROM leases
      WHERE session_id = ${this.state.id} AND name = ${name}
        AND expires_at > ${Date.now()}`.get(this.state.db);
    if (row === undefined) return undefined;
    return {
      name,
      owner: stringColumn(row, "owner"),
      fence: numberColumn(row, "fence"),
      expiresAt: numberColumn(row, "expires_at"),
    };
  }
}

class SqliteEvents implements Events {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async append(
    events: readonly EventBody[],
    options?: { readonly lease?: Lease },
  ): Promise<AppendOutcome> {
    this.state.assertOpen();
    const outcome = transact(this.state.db, (): AppendOutcome => {
      if (
        options?.lease !== undefined &&
        !leaseMatches({
          db: this.state.db,
          sessionId: this.state.id,
          lease: options.lease,
        })
      ) {
        return { ok: false, reason: "fenced" };
      }
      return {
        ok: true,
        seq: writeEvents({ db: this.state.db, sessionId: this.state.id, bodies: events }),
      };
    });
    if (outcome.ok && events.length > 0) this.state.changes.notify(this.state.id);
    return outcome;
  }

  async read(options: {
    readonly afterSeq: Seq;
    readonly limit?: number;
  }): Promise<readonly Event[]> {
    this.state.assertOpen();
    validateLimit(options.limit);
    return readTransaction(this.state.db, () => {
      const floor = readEventFloor(this.state.db, this.state.id);
      if (options.afterSeq < floor) throw new CursorExpired(floor);
      const rows =
        options.limit === undefined
          ? sql`SELECT seq, at, body FROM events
              WHERE session_id = ${this.state.id} AND seq > ${options.afterSeq}
              ORDER BY seq`.all(this.state.db)
          : sql`SELECT seq, at, body FROM events
              WHERE session_id = ${this.state.id} AND seq > ${options.afterSeq}
              ORDER BY seq LIMIT ${options.limit}`.all(this.state.db);
      return rows.map((row): Event => ({
        ...parseEventBody(stringColumn(row, "body")),
        seq: numberColumn(row, "seq"),
        at: numberColumn(row, "at"),
      }));
    });
  }

  async last(): Promise<Seq> {
    this.state.assertOpen();
    return readLastSeq(this.state.db, this.state.id);
  }

  async floor(): Promise<Seq> {
    this.state.assertOpen();
    return readEventFloor(this.state.db, this.state.id);
  }

  async trim(beforeSeq: Seq): Promise<void> {
    this.state.assertOpen();
    transact(this.state.db, () => {
      // The floor never passes the newest seq, so an event written next is
      // never born expired.
      const floor = Math.min(beforeSeq, readLastSeq(this.state.db, this.state.id));
      sql`DELETE FROM events
        WHERE session_id = ${this.state.id} AND seq <= ${floor}`.run(this.state.db);
      sql`UPDATE sessions SET event_floor =
          CASE WHEN event_floor < ${floor} THEN ${floor} ELSE event_floor END
        WHERE id = ${this.state.id}`.run(this.state.db);
    });
    this.state.changes.notify(this.state.id);
  }

  watch(options: { readonly afterSeq: Seq; readonly signal?: AbortSignal }): AsyncIterable<Event> {
    this.state.assertOpen();
    const signals =
      options.signal === undefined
        ? [this.state.closeController.signal]
        : [this.state.closeController.signal, options.signal];
    return this.stream(options.afterSeq, signals);
  }

  private async *stream(afterSeq: Seq, signals: readonly AbortSignal[]): AsyncIterable<Event> {
    const subscription = this.state.changes.subscribe(this.state.id, signals);
    let cursor = afterSeq;
    try {
      while (!subscription.closed) {
        const events = await this.read({ afterSeq: cursor });
        for (const event of events) {
          if (subscription.closed) return;
          cursor = event.seq;
          yield event;
        }
        await subscription.wait();
      }
    } finally {
      subscription.close();
    }
  }
}

class SqliteSession implements Session {
  readonly id: string;
  readonly objects: Objects;
  readonly refs: Refs;
  readonly leases: Leases;
  readonly events: Events;
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
    this.id = state.id;
    this.objects = new SqliteObjects(state);
    this.refs = new SqliteRefs(state);
    this.leases = new SqliteLeases(state);
    this.events = new SqliteEvents(state);
  }

  async close(): Promise<void> {
    this.state.close();
  }
}

export interface SqliteStoreOptions {
  readonly watchPollIntervalMs?: number;
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;
  private readonly changes: SqliteChangeTracker;
  private closed = false;

  constructor(path: string, options?: SqliteStoreOptions) {
    const watchPollIntervalMs = options?.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS;
    if (!Number.isSafeInteger(watchPollIntervalMs) || watchPollIntervalMs <= 0) {
      throw new RangeError("watchPollIntervalMs must be a positive safe integer");
    }

    // SQLite creates a missing file, not a missing directory.
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=5000");
      enableWal(db);
      db.exec("PRAGMA synchronous=FULL");
      transact(db, () => {
        const version = schemaVersion(db);
        if (version !== SCHEMA_VERSION && !(version === 0 && isFresh(db))) {
          throw new Error(
            `${path} was written by another nyte schema (${String(version)}, this build reads ${String(SCHEMA_VERSION)}). Delete it to start over.`,
          );
        }
        db.exec(SCHEMA);
        db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
      });
    } catch (error) {
      db.close();
      throw error;
    }
    this.db = db;
    this.changes = new SqliteChangeTracker(db, watchPollIntervalMs);
  }

  async create(options?: { readonly id?: string }): Promise<Session> {
    this.assertOpen();
    const id = options?.id ?? `session_${randomUUID().slice(0, 12)}`;
    const createdAt = Date.now();
    transact(this.db, () => {
      const result = sql`INSERT OR IGNORE INTO sessions (id, created_at, next_seq, event_floor)
        VALUES (${id}, ${createdAt}, 1, 0)`.run(this.db);
      if (Number(result.changes) !== 1) throw new Error(`Session already exists: ${id}`);
    });
    return this.session(id);
  }

  async open(id: string): Promise<Session> {
    this.assertOpen();
    const row = sql`SELECT id FROM sessions WHERE id = ${id}`.get(this.db);
    if (row === undefined) throw new UnknownSession(id);
    return this.session(stringColumn(row, "id"));
  }

  async list(): Promise<readonly SessionInfo[]> {
    this.assertOpen();
    return sql`SELECT id, created_at FROM sessions ORDER BY created_at, id`
      .all(this.db)
      .map((row) => ({
        id: stringColumn(row, "id"),
        createdAt: numberColumn(row, "created_at"),
      }));
  }

  async delete(id: string): Promise<void> {
    this.assertOpen();
    transact(this.db, () => {
      sql`DELETE FROM objects WHERE session_id = ${id}`.run(this.db);
      sql`DELETE FROM refs WHERE session_id = ${id}`.run(this.db);
      sql`DELETE FROM leases WHERE session_id = ${id}`.run(this.db);
      sql`DELETE FROM events WHERE session_id = ${id}`.run(this.db);
      sql`DELETE FROM sessions WHERE id = ${id}`.run(this.db);
    });
    this.changes.notify(id);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.changes.close();
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) throw new Error("SQLite store is closed");
  }

  private session(id: string): Session {
    return new SqliteSession(new SessionState(id, this.db, this.changes));
  }
}
