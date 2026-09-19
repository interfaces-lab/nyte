import { setTimeout } from "node:timers/promises";
import { hashCanonicalJson, hashObject } from "../hash.ts";
import { canonicalJson } from "@nyte-ai/client";
import { CursorExpired } from "@nyte-ai/protocol";
import { type Commit, type Event, type EventBody, type Lease, type Obj } from "../model.ts";
import { isRefName, newOwnerId } from "../names.ts";
import { checkEventBody, checkObject } from "../store-schemas.ts";
import {
  CorruptObject,
  UnknownSession,
  type Session,
  type RefUpdateOptions,
  type Refs,
  type Leases,
  type Objects,
  type Events,
  type AppendOutcome,
} from "../store.ts";
import {
  databaseTime,
  integerColumn,
  stringColumn,
  type PostgresDatabase,
  type PostgresQuery,
  type PostgresRow,
} from "./database.ts";

const WATCH_PAGE_SIZE = 256;

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError("limit must be a non-negative safe integer");
  }
}

function parseObject(row: PostgresRow): { readonly oid: string; readonly object: Obj } {
  const oid = stringColumn(row, "oid");
  const value: unknown = JSON.parse(stringColumn(row, "body"));
  if (!checkObject.Check(value)) throw new CorruptObject(oid, "is not a known object");
  if (hashObject(value) !== oid) throw new CorruptObject(oid, "does not match its hash");
  return { oid, object: value };
}

function parseEvent(row: PostgresRow): Event {
  const body: unknown = JSON.parse(stringColumn(row, "body"));
  if (!checkEventBody.Check(body)) throw new TypeError("Stored event is not a known event body");
  return { ...body, seq: integerColumn(row, "seq"), at: integerColumn(row, "at") };
}

function parseLease(row: PostgresRow, name: string): Lease {
  return {
    name,
    owner: stringColumn(row, "owner"),
    fence: integerColumn(row, "fence"),
    expiresAt: integerColumn(row, "expires_at"),
  };
}

function expiry(now: number, ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(now + ttlMs)) {
    throw new RangeError("ttlMs must be a positive safe integer");
  }
  return now + ttlMs;
}

class SessionState {
  readonly id: string;
  readonly db: PostgresDatabase;
  readonly signal: AbortSignal;
  readonly watchPollIntervalMs: number;
  private readonly closeController = new AbortController();

  constructor(options: {
    readonly id: string;
    readonly db: PostgresDatabase;
    readonly storeSignal: AbortSignal;
    readonly watchPollIntervalMs: number;
  }) {
    this.id = options.id;
    this.db = options.db;
    this.watchPollIntervalMs = options.watchPollIntervalMs;
    this.signal = AbortSignal.any([this.closeController.signal, options.storeSignal]);
  }

  assertOpen(): void {
    if (this.signal.aborted) throw new Error(`Session is closed: ${this.id}`);
  }

  async transact<T>(
    run: (transaction: PostgresQuery, session: PostgresRow) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    return this.db.transaction(async (transaction) => {
      // The session row serializes ref CAS, lease takeover, event allocation,
      // and deletion without locking unrelated sessions.
      const [row] = await transaction.query(
        "SELECT next_seq, event_floor FROM nyte_sessions WHERE id = $1 FOR UPDATE",
        [this.id],
      );
      if (row === undefined) throw new UnknownSession(this.id);
      return run(transaction, row);
    });
  }

  async metadata(): Promise<PostgresRow> {
    this.assertOpen();
    const [row] = await this.db.query(
      "SELECT next_seq, event_floor FROM nyte_sessions WHERE id = $1",
      [this.id],
    );
    if (row === undefined) throw new UnknownSession(this.id);
    return row;
  }

  async leaseMatches(transaction: PostgresQuery, lease: Lease): Promise<boolean> {
    const rows = await transaction.query(
      `SELECT 1 FROM nyte_leases
       WHERE session_id = $1 AND name = $2 AND owner = $3 AND fence = $4`,
      [this.id, lease.name, lease.owner, lease.fence],
    );
    return rows.length === 1;
  }

  async writeEvents(
    transaction: PostgresQuery,
    session: PostgresRow,
    bodies: readonly EventBody[],
  ): Promise<number> {
    const firstSeq = integerColumn(session, "next_seq");
    if (bodies.length === 0) return firstSeq - 1;
    const nextSeq = firstSeq + bodies.length;
    if (!Number.isSafeInteger(nextSeq)) throw new RangeError("Session event sequence overflow");
    await transaction.query("UPDATE nyte_sessions SET next_seq = $2 WHERE id = $1", [
      this.id,
      nextSeq,
    ]);
    // JSON is a single bound parameter so a streamed batch pays one round trip.
    await transaction.query(
      `INSERT INTO nyte_events (session_id, seq, at, body)
       SELECT $1, $2::bigint + ordinal - 1,
         floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, body
       FROM json_array_elements_text($3::json) WITH ORDINALITY AS batch(body, ordinal)`,
      [this.id, firstSeq, JSON.stringify(bodies.map((body) => JSON.stringify(body)))],
    );
    return nextSeq - 1;
  }

  close(): void {
    this.closeController.abort();
  }
}

class PostgresObjects implements Objects {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async put(objects: readonly Obj[]): Promise<readonly string[]> {
    const encoded = objects.map((object) => {
      const body = canonicalJson(object);
      return { oid: hashCanonicalJson(body), kind: object.kind, body };
    });
    await this.state.transact(async (transaction) => {
      if (encoded.length === 0) return;
      await transaction.query(
        `INSERT INTO nyte_objects (session_id, oid, kind, body, at)
         SELECT $1, item.oid, item.kind, item.body,
           floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
         FROM json_to_recordset($2::json) AS item(oid text, kind text, body text)
         ON CONFLICT (session_id, oid) DO NOTHING`,
        [this.state.id, JSON.stringify(encoded)],
      );
    });
    return encoded.map((item) => item.oid);
  }

  async get(oid: string): Promise<Obj | undefined> {
    this.state.assertOpen();
    const [row] = await this.state.db.query(
      "SELECT oid, body FROM nyte_objects WHERE session_id = $1 AND oid = $2",
      [this.state.id, oid],
    );
    return row === undefined ? undefined : parseObject(row).object;
  }

  async chain(
    from: string,
    options: { readonly limit: number },
  ): Promise<readonly { readonly oid: string; readonly object: Obj }[]> {
    this.state.assertOpen();
    validateLimit(options.limit);
    if (options.limit === 0) return [];
    const rows = await this.state.db.query(
      `WITH RECURSIVE chain(oid, body, depth) AS (
         SELECT oid, body, 0 FROM nyte_objects WHERE session_id = $1 AND oid = $2
         UNION ALL
         SELECT objects.oid, objects.body, chain.depth + 1
         FROM chain JOIN nyte_objects objects
           ON objects.session_id = $1 AND objects.oid = chain.body::json ->> 'parent'
         WHERE chain.depth + 1 < $3
       ) SELECT oid, body FROM chain ORDER BY depth`,
      [this.state.id, from, options.limit],
    );
    return rows.map(parseObject);
  }

  async list(): Promise<readonly { readonly oid: string; readonly at: number }[]> {
    this.state.assertOpen();
    const rows = await this.state.db.query(
      'SELECT oid, at FROM nyte_objects WHERE session_id = $1 ORDER BY oid COLLATE "C"',
      [this.state.id],
    );
    return rows.map((row) => ({ oid: stringColumn(row, "oid"), at: integerColumn(row, "at") }));
  }

  async commits(): Promise<readonly { readonly oid: string; readonly commit: Commit }[]> {
    this.state.assertOpen();
    const rows = await this.state.db.query(
      "SELECT oid, body FROM nyte_objects WHERE session_id = $1 AND kind = 'commit'",
      [this.state.id],
    );
    const commits: { readonly oid: string; readonly commit: Commit }[] = [];
    for (const row of rows) {
      const { oid, object } = parseObject(row);
      if (object.kind === "commit") commits.push({ oid, commit: object });
    }
    return commits.sort(
      (left, right) => left.commit.at - right.commit.at || left.oid.localeCompare(right.oid),
    );
  }

  async delete(oids: readonly string[]): Promise<number> {
    return this.state.transact(async (transaction) => {
      const rows = await transaction.query(
        "DELETE FROM nyte_objects WHERE session_id = $1 AND oid = ANY($2::text[]) RETURNING oid",
        [this.state.id, oids],
      );
      return rows.length;
    });
  }
}

class PostgresRefs implements Refs {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async read(name: string): Promise<string | null> {
    this.state.assertOpen();
    const [row] = await this.state.db.query(
      "SELECT oid FROM nyte_refs WHERE session_id = $1 AND name = $2",
      [this.state.id, name],
    );
    return row === undefined ? null : stringColumn(row, "oid");
  }

  async list(prefix: string): Promise<readonly { readonly name: string; readonly oid: string }[]> {
    this.state.assertOpen();
    const rows = await this.state.db.query(
      `SELECT name, oid FROM nyte_refs WHERE session_id = $1 AND starts_with(name, $2)
       ORDER BY name COLLATE "C"`,
      [this.state.id, prefix],
    );
    return rows.map((row) => ({ name: stringColumn(row, "name"), oid: stringColumn(row, "oid") }));
  }

  async update(
    updates: Parameters<Refs["update"]>[0],
    options: RefUpdateOptions,
  ): ReturnType<Refs["update"]> {
    if (updates.length === 0) throw new TypeError("refs.update requires at least one update");
    const names = new Set<string>();
    for (const update of updates) {
      if (!isRefName(update.name)) throw new TypeError(`Invalid ref name: ${update.name}`);
      if (names.has(update.name)) throw new TypeError(`Duplicate ref name: ${update.name}`);
      names.add(update.name);
    }
    return this.state.transact(async (transaction, session): ReturnType<Refs["update"]> => {
      if (
        options.lease !== undefined &&
        !(await this.state.leaseMatches(transaction, options.lease))
      ) {
        return { ok: false, reason: "fenced" };
      }
      const rows = await transaction.query(
        "SELECT name, oid FROM nyte_refs WHERE session_id = $1 AND name = ANY($2::text[])",
        [this.state.id, [...names]],
      );
      const actualRefs = new Map(
        rows.map((row) => [stringColumn(row, "name"), stringColumn(row, "oid")]),
      );
      for (const update of updates) {
        const actual = actualRefs.get(update.name) ?? null;
        if (actual !== update.from)
          return { ok: false, reason: "conflict", name: update.name, actual };
      }
      const writes = updates.filter((update) => update.to !== update.from);
      for (const update of writes) {
        if (update.to === null) {
          await transaction.query("DELETE FROM nyte_refs WHERE session_id = $1 AND name = $2", [
            this.state.id,
            update.name,
          ]);
        } else {
          await transaction.query(
            `INSERT INTO nyte_refs (session_id, name, oid) VALUES ($1, $2, $3)
             ON CONFLICT (session_id, name) DO UPDATE SET oid = excluded.oid`,
            [this.state.id, update.name, update.to],
          );
        }
      }
      const events: EventBody[] = writes.map((update) => ({
        kind: "ref",
        ...update,
        reason: options.reason,
        ...(options.actor === undefined ? {} : { actor: options.actor }),
      }));
      const seq = await this.state.writeEvents(transaction, session, [
        ...events,
        ...(options.events ?? []),
      ]);
      return { ok: true, seq };
    });
  }
}

class PostgresLeases implements Leases {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async acquire(name: string, ttlMs: number): ReturnType<Leases["acquire"]> {
    return this.state.transact(async (transaction): ReturnType<Leases["acquire"]> => {
      const now = await databaseTime(transaction);
      const expiresAt = expiry(now, ttlMs);
      const [row] = await transaction.query(
        "SELECT owner, fence, expires_at FROM nyte_leases WHERE session_id = $1 AND name = $2",
        [this.state.id, name],
      );
      const holder = row === undefined ? undefined : parseLease(row, name);
      if (holder !== undefined && holder.expiresAt > now) return { ok: false, holder };
      const fence = (holder?.fence ?? 0) + 1;
      if (!Number.isSafeInteger(fence)) throw new RangeError("Lease fence overflow");
      const lease: Lease = { name, owner: newOwnerId(), fence, expiresAt };
      await transaction.query(
        `INSERT INTO nyte_leases (session_id, name, owner, fence, expires_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, name) DO UPDATE SET owner = excluded.owner,
           fence = excluded.fence, expires_at = excluded.expires_at`,
        [this.state.id, name, lease.owner, lease.fence, lease.expiresAt],
      );
      return { ok: true, lease };
    });
  }

  async renew(lease: Lease, ttlMs: number): Promise<boolean> {
    return this.state.transact(async (transaction) => {
      const expiresAt = expiry(await databaseTime(transaction), ttlMs);
      const rows = await transaction.query(
        `UPDATE nyte_leases SET expires_at = $5
         WHERE session_id = $1 AND name = $2 AND owner = $3 AND fence = $4 RETURNING name`,
        [this.state.id, lease.name, lease.owner, lease.fence, expiresAt],
      );
      return rows.length === 1;
    });
  }

  async release(lease: Lease): Promise<boolean> {
    return this.state.transact(async (transaction) => {
      const rows = await transaction.query(
        `DELETE FROM nyte_leases WHERE session_id = $1 AND name = $2 AND owner = $3 AND fence = $4
         RETURNING name`,
        [this.state.id, lease.name, lease.owner, lease.fence],
      );
      return rows.length === 1;
    });
  }

  async read(name: string): Promise<Lease | undefined> {
    this.state.assertOpen();
    const [row] = await this.state.db.query(
      `SELECT owner, fence, expires_at FROM nyte_leases WHERE session_id = $1 AND name = $2
       AND expires_at > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint`,
      [this.state.id, name],
    );
    return row === undefined ? undefined : parseLease(row, name);
  }
}

class PostgresEvents implements Events {
  private readonly state: SessionState;

  constructor(state: SessionState) {
    this.state = state;
  }

  async append(
    events: readonly EventBody[],
    options?: { readonly lease?: Lease },
  ): Promise<AppendOutcome> {
    return this.state.transact(async (transaction, session): Promise<AppendOutcome> => {
      if (
        options?.lease !== undefined &&
        !(await this.state.leaseMatches(transaction, options.lease))
      ) {
        return { ok: false, reason: "fenced" };
      }
      return { ok: true, seq: await this.state.writeEvents(transaction, session, events) };
    });
  }

  async read(options: {
    readonly afterSeq: number;
    readonly limit?: number;
  }): Promise<readonly Event[]> {
    this.state.assertOpen();
    validateLimit(options.limit);
    // One statement observes the floor and event page in the same MVCC snapshot.
    // Separate READ COMMITTED queries could miss a concurrent trim and lose events.
    const rows = await this.state.db.query(
      `SELECT session.event_floor, events.seq, events.at, events.body
       FROM nyte_sessions session LEFT JOIN LATERAL (
         SELECT seq, at, body FROM nyte_events WHERE session_id = session.id AND seq > $2
         ORDER BY seq LIMIT $3
       ) events ON true WHERE session.id = $1 ORDER BY events.seq`,
      [this.state.id, options.afterSeq, options.limit ?? null],
    );
    const first = rows[0];
    if (first === undefined) throw new UnknownSession(this.state.id);
    const floor = integerColumn(first, "event_floor");
    if (options.afterSeq < floor) throw new CursorExpired(floor);
    return rows.filter((row) => row.seq !== null).map(parseEvent);
  }

  async last(): Promise<number> {
    return integerColumn(await this.state.metadata(), "next_seq") - 1;
  }

  async floor(): Promise<number> {
    return integerColumn(await this.state.metadata(), "event_floor");
  }

  async trim(beforeSeq: number): Promise<void> {
    await this.state.transact(async (transaction, session) => {
      const floor = Math.max(
        integerColumn(session, "event_floor"),
        Math.min(beforeSeq, integerColumn(session, "next_seq") - 1),
      );
      await transaction.query("DELETE FROM nyte_events WHERE session_id = $1 AND seq <= $2", [
        this.state.id,
        floor,
      ]);
      await transaction.query("UPDATE nyte_sessions SET event_floor = $2 WHERE id = $1", [
        this.state.id,
        floor,
      ]);
    });
  }

  watch(options: {
    readonly afterSeq: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<Event> {
    this.state.assertOpen();
    const signal =
      options.signal === undefined
        ? this.state.signal
        : AbortSignal.any([this.state.signal, options.signal]);
    return this.stream(options.afterSeq, signal);
  }

  private async *stream(afterSeq: number, signal: AbortSignal): AsyncIterable<Event> {
    let cursor = afterSeq;
    while (!signal.aborted) {
      const events = await this.read({ afterSeq: cursor, limit: WATCH_PAGE_SIZE });
      for (const event of events) {
        if (signal.aborted) return;
        cursor = event.seq;
        yield event;
      }
      if (events.length === WATCH_PAGE_SIZE) continue;
      try {
        await setTimeout(this.state.watchPollIntervalMs, undefined, { signal, ref: false });
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
    }
  }
}

export function postgresSession(options: ConstructorParameters<typeof SessionState>[0]): Session {
  const state = new SessionState(options);
  return {
    id: state.id,
    objects: new PostgresObjects(state),
    refs: new PostgresRefs(state),
    leases: new PostgresLeases(state),
    events: new PostgresEvents(state),
    close: async () => state.close(),
  };
}
