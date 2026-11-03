/**
 * One environment as its relay Durable Object holds it, in the object's own
 * SQLite: the identity it copies from D1 once, its devices, the proofs its
 * key signed, when its desktop last leased, and the D1 writes it still owes.
 * Every rule about those lives here, so leases, phone requests, and socket
 * auth answer without a D1 round trip. Node-safe: the relay object supplies
 * `ctx.storage` and a channel to its desktop; Node tests supply `node:sqlite`
 * and a fake desktop.
 *
 * Methods answer an `Outcome`: the RPC answer, and the socket effects the
 * relay applies (ending a device's channels, every channel, or every socket).
 */
import {
  BROKER_ROUTES,
  CLOCK_TOLERANCE_SECONDS,
  DESKTOP_ROUTES,
  DEVICE_LIMIT,
  ENROLLMENT_LIFETIME_SECONDS,
  LEASE_LIFETIME_SECONDS,
  ONLINE_WINDOW_SECONDS,
  ReceiptClaims,
  ReceiptEnvelope,
  TOKEN_TYPES,
} from "@nyte-ai/connect";
import type {
  EnrollEnvelope,
  EnrollRequest,
  EnrollResponse,
  EnrollmentClaims,
  ErrorCode,
  LeaseClaims,
  LeaseResponse,
  ProofClaims,
} from "@nyte-ai/connect";
import type { RelayRefusalCode } from "@nyte-ai/connect/relay";
import {
  nowSeconds,
  randomId,
  sha256,
  signClaims,
  verifyClaims,
  verifyProof,
} from "@nyte-ai/connect/signing";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { Config } from "./config.ts";
import type { D1Database } from "./d1.ts";
import type {
  Actor,
  Answer,
  OwnerStanding,
  Presence,
  Proven,
  RelayAdmission,
} from "./environment-api.ts";
import { parseJson, readText } from "./http.ts";
import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import { loadEnvironment, retireEnvironment } from "./store/environments.ts";
import { denySession, sessionDenied } from "./store/owners.ts";
import { IdRow, OwnerStatus, many, one } from "./store/rows.ts";

/** One value Durable Object SQL binds and answers. */
export type SqlValue = ArrayBuffer | string | number | null;

/**
 * The part of `ctx.storage` the record uses, structurally: `sql.exec` runs
 * one statement and answers its rows, and `transactionSync` runs a
 * synchronous closure whose writes land together or not at all (Durable
 * Object SQL refuses `BEGIN`).
 */
export interface DurableObjectSql {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
  };
  transactionSync<T>(closure: () => T): T;
}

/** One request to the desktop over its relay socket. Rejects when no desktop is attached. */
export type DesktopExchange = (request: {
  readonly path: string;
  readonly body: string;
  readonly signal: AbortSignal;
}) => Promise<Response>;

export type Effect =
  /** End the device's open channels; the socket stays. */
  | { readonly kind: "end-device"; readonly deviceId: string }
  /** End every open channel; the socket stays, as for an owner who was disabled. */
  | { readonly kind: "end-channels" }
  /** Close every socket with `RELAY_CLOSE.revoked`. */
  | { readonly kind: "close" };

export interface Outcome<T> {
  readonly answer: Answer<T>;
  readonly effects: readonly Effect[];
}

/** What the relay decided about a phone request's bearer. */
type Admitted =
  | { readonly ok: true; readonly deviceId: string | undefined }
  | { readonly ok: false; readonly code: RelayRefusalCode };

/**
 * Only revocation ever changed an environment's generation, and a revoked
 * environment issues nothing, so every lease and grant names this one.
 */
const GENERATION = 1;

/** The window spent proofs are counted in, and kept for at least. */
const PROOF_WINDOW_MS = 60_000;

/** Proofs this environment's key may sign per window, by what they are for. */
const PROOF_LIMITS = {
  /** Three heartbeats a minute, plus readiness refreshes after enrollments. */
  lease: 20,
  /** Releases and removals the desktop signs. */
  revoke: 30,
} as const;

/** Relayed phone requests to this environment in one window, after the bearer is checked. */
const RELAY_LIMIT = { windowMs: 60_000, limit: 1200 };

/** How long the broker waits for the desktop to record an enrollment. */
const ENROLL_TIMEOUT_MS = 10_000;

const RECEIPT_LIMIT = 16_384;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS environment (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
    policy INTEGER NOT NULL,
    owner_status TEXT NOT NULL CHECK (owner_status IN ('active', 'disabled', 'deleted')),
    owner_version INTEGER NOT NULL,
    last_seen_at INTEGER
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    digest TEXT NOT NULL,
    session_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reserved', 'active', 'revoked')),
    revoke_reason TEXT CHECK (
      revoke_reason IN ('revoked', 'released', 'replaced', 'unconfirmed', 'expired', 'environment')
    ),
    grant_id TEXT NOT NULL UNIQUE,
    nonce TEXT NOT NULL,
    grant_expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    CHECK ((state = 'revoked') = (revoke_reason IS NOT NULL))
  ) STRICT`,
  "CREATE UNIQUE INDEX IF NOT EXISTS devices_active_client ON devices (client_id) WHERE state = 'active'",
  "CREATE INDEX IF NOT EXISTS devices_by_digest ON devices (digest)",
  `CREATE TABLE IF NOT EXISTS proofs (
    jti TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('lease', 'revoke', 'relay')),
    at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS outbox (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('deny', 'retire')),
    session_id TEXT,
    owner_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    next_at INTEGER NOT NULL,
    CHECK ((kind = 'deny') = (session_id IS NOT NULL))
  ) STRICT`,
];

const Served = Type.Object({
  owner_id: Type.String(),
  public_key: Type.String(),
  state: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
  policy: Type.Integer(),
  owner_status: OwnerStatus,
  owner_version: Type.Integer(),
  last_seen_at: Type.Union([Type.Integer(), Type.Null()]),
});

type Served = Static<typeof Served>;

const DeviceRow = Type.Object({
  id: Type.String(),
  session_id: Type.String(),
  state: Type.Union([Type.Literal("reserved"), Type.Literal("active"), Type.Literal("revoked")]),
  grant_expires_at: Type.Integer(),
});

const CountRow = Type.Object({ count: Type.Integer() });

const DueRow = Type.Object({ due: Type.Union([Type.Integer(), Type.Null()]) });

const OutboxRow = Type.Union([
  Type.Object({
    key: Type.String(),
    kind: Type.Literal("deny"),
    session_id: Type.String(),
    owner_id: Type.String(),
    at: Type.Integer(),
    attempts: Type.Integer(),
  }),
  Type.Object({
    key: Type.String(),
    kind: Type.Literal("retire"),
    session_id: Type.Null(),
    owner_id: Type.String(),
    at: Type.Integer(),
    attempts: Type.Integer(),
  }),
]);

const EmptyObject = Type.Object({}, { additionalProperties: false });

function ok<T>(value: T, effects: readonly Effect[] = []): Outcome<T> {
  return { answer: { ok: true, value }, effects };
}

function refused<T>(code: ErrorCode, effects: readonly Effect[] = []): Outcome<T> {
  return { answer: { ok: false, code }, effects };
}

export class EnvironmentRecord {
  readonly #id: string;
  readonly #storage: DurableObjectSql;
  readonly #directory: D1Database;
  readonly #config: Config;
  readonly #log: Logger;
  readonly #exchange: DesktopExchange;
  /** The one D1 read that copies the identity, shared by every call that arrives while it runs. */
  #loading: Promise<void> | undefined;
  #relayWindow = { start: 0, count: 0 };

  constructor(input: {
    readonly id: string;
    readonly storage: DurableObjectSql;
    readonly directory: D1Database;
    readonly config: Config;
    readonly log: Logger;
    readonly exchange: DesktopExchange;
  }) {
    this.#id = input.id;
    this.#storage = input.storage;
    this.#directory = input.directory;
    this.#config = input.config;
    this.#log = input.log;
    this.#exchange = input.exchange;
  }

  async lease(proof: Proven): Promise<Outcome<LeaseResponse>> {
    const served = await this.#load();

    if (served === undefined) return refused("unauthorized");

    const claims = await this.#spend(served, proof, {
      method: "POST",
      path: BROKER_ROUTES.lease(this.#id),
      kind: "lease",
    });

    if (claims === undefined) return refused("unauthorized");

    if (parseJson(EmptyObject, proof.body) === undefined) return refused("invalid");
    const current = this.#served() ?? served;

    if (current.state === "revoked" || current.owner_status === "deleted")
      return refused("revoked");

    if (!this.#within("lease")) return refused("rate_limited");

    if (current.owner_status === "disabled") return refused("owner_disabled");
    const now = Date.now();

    const devices = many(
      IdRow,
      this.#exec(
        "SELECT id FROM devices WHERE state = 'active' ORDER BY created_at, id LIMIT ?1",
        DEVICE_LIMIT,
      ),
    ).map((device) => device.id);

    this.#exec("UPDATE environment SET last_seen_at = ?1", now);
    const iat = nowSeconds(now);

    const lease: LeaseClaims = {
      iss: this.#config.origin,
      aud: this.#id,
      sub: current.owner_id,
      iat,
      exp: iat + LEASE_LIFETIME_SECONDS,
      req: claims.jti,
      generation: GENERATION,
      policy: current.policy,
      devices,
    };

    return ok({
      lease: await signClaims({
        key: this.#config.signing.active,
        typ: TOKEN_TYPES.lease,
        claims: lease,
      }),
    });
  }

  /**
   * Reserve the device, have the desktop record its digest, verify the
   * desktop's signed receipt, then activate. Activation reads D1 for a denial
   * of the enrolling session and, with no await after that read, checks
   * everything again: a denial committed before the read refuses the device,
   * one committed after it is ordered after this enrollment.
   */
  async enroll(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly body: EnrollRequest;
  }): Promise<Outcome<EnrollResponse>> {
    const served = await this.#load();

    if (served === undefined || served.owner_id !== input.ownerId || served.state !== "active")
      return refused("not_found");

    if (served.owner_status !== "active") return refused("owner_disabled");
    const reservedAt = Date.now();
    const iat = nowSeconds(reservedAt);

    const grant: EnrollmentClaims = {
      iss: this.#config.origin,
      aud: this.#id,
      sub: served.owner_id,
      iat,
      exp: iat + ENROLLMENT_LIFETIME_SECONDS,
      jti: randomId(),
      nonce: randomId(),
      generation: GENERATION,
      deviceId: crypto.randomUUID(),
      clientId: input.body.clientId,
      clientName: input.body.clientName,
      digest: input.body.digest,
      ...(input.body.role === undefined ? {} : { role: input.body.role }),
    };

    if (!this.#reserve(grant, { sessionId: input.sessionId, now: reservedAt }))
      return refused("limit");

    const authorization = await signClaims({
      key: this.#config.signing.active,
      typ: TOKEN_TYPES.enrollment,
      claims: grant,
    });

    const receipt = await this.#forwardEnrollment(authorization);

    if (
      receipt === undefined ||
      !(await this.#receiptConfirms({ receipt, publicKey: served.public_key, grant }))
    ) {
      this.#unreserve(grant.deviceId);

      return refused("unreachable");
    }

    const denied = await sessionDenied(this.#directory, {
      sessionId: input.sessionId,
      now: Date.now(),
    });

    if (!this.#activate(grant, { sessionId: input.sessionId, denied })) {
      this.#unreserve(grant.deviceId);

      return refused("conflict");
    }

    return ok({ environmentId: this.#id, deviceId: grant.deviceId });
  }

  /** The weak end, signed by the desktop after the device's own bearer asked for it. Body exactly `{}`. */
  async release(input: {
    readonly proof: Proven;
    readonly deviceId: string;
  }): Promise<Outcome<null>> {
    const served = await this.#load();

    if (served === undefined) return refused("unauthorized");

    const claims = await this.#spend(served, input.proof, {
      method: "POST",
      path: BROKER_ROUTES.release(this.#id, input.deviceId),
      kind: "revoke",
    });

    if (claims === undefined) return refused("unauthorized");

    if (input.proof.body !== "{}") return refused("invalid");

    if (!this.#within("revoke")) return refused("rate_limited");

    if (this.#device(input.deviceId) === undefined) return refused("not_found");
    const now = Date.now();

    this.#storage.transactionSync(() => {
      const ended = this.#exec(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'released', revoked_at = ?2
         WHERE id = ?1 AND state != 'revoked' RETURNING id`,
        input.deviceId,
        now,
      );

      if (ended.length > 0) this.#exec("UPDATE environment SET policy = policy + 1");
    });

    return ok(null, [{ kind: "end-device", deviceId: input.deviceId }]);
  }

  /**
   * The strong end: the device stops and the Clerk session that enrolled it
   * is denied. It applies whatever ended the device before, upgrading the
   * reason, so a weaker end never stands in for it. Answers only once the
   * denial is in D1; until then the outbox owes it and the alarm retries.
   */
  async revokeDevice(input: {
    readonly actor: Actor;
    readonly deviceId: string;
  }): Promise<Outcome<{ readonly sessionId: string }>> {
    const served = await this.#load();

    if (served === undefined)
      return refused(input.actor.kind === "owner" ? "not_found" : "unauthorized");

    const refusal = await this.#authorize(served, input.actor, {
      method: "DELETE",
      path: BROKER_ROUTES.device(this.#id, input.deviceId),
    });

    if (refusal !== undefined) return refused(refusal);
    const device = this.#device(input.deviceId);

    if (device === undefined) return refused("not_found");
    const now = Date.now();
    const owed = `deny:${device.session_id}`;

    this.#storage.transactionSync(() => {
      const before = this.#device(input.deviceId);

      if (before?.state !== "revoked") this.#exec("UPDATE environment SET policy = policy + 1");
      this.#exec(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'revoked', revoked_at = coalesce(revoked_at, ?2)
         WHERE id = ?1 AND (state != 'revoked' OR revoke_reason != 'revoked')`,
        input.deviceId,
        now,
      );
      this.#exec(
        `INSERT INTO outbox (key, kind, session_id, owner_id, at, attempts, next_at)
         VALUES (?1, 'deny', ?2, ?3, ?4, 0, ?4) ON CONFLICT (key) DO NOTHING`,
        owed,
        device.session_id,
        served.owner_id,
        now,
      );
    });
    await this.drain();
    const effects: Effect[] = [{ kind: "end-device", deviceId: input.deviceId }];

    if (this.#exec("SELECT 1 FROM outbox WHERE key = ?1", owed).length > 0)
      return refused("internal", effects);

    return ok({ sessionId: device.session_id }, effects);
  }

  /** Revoke the environment and every device. Answers success when it is already revoked. */
  async revoke(actor: Actor): Promise<Outcome<null>> {
    const served = await this.#load();

    if (served === undefined) return refused(actor.kind === "owner" ? "not_found" : "unauthorized");

    const refusal = await this.#authorize(served, actor, {
      method: "DELETE",
      path: BROKER_ROUTES.environment(this.#id),
    });

    if (refusal !== undefined) return refused(refusal);
    const ended = this.#storage.transactionSync(() => this.#end(Date.now()));

    await this.drain();

    return ok(null, ended ? [{ kind: "close" }] : []);
  }

  /**
   * Apply the owner standing D1 holds. A relay that never loaded its row
   * ignores it, since loading reads D1's current standing. An older version
   * is ignored; an equal one applies, as a Clerk lookup's does in D1. Deleted
   * is final and revokes.
   */
  setOwner(standing: OwnerStanding): Outcome<null> {
    const served = this.#served();

    if (served === undefined || served.owner_status === "deleted") return ok(null);

    if (standing.status === "deleted") {
      const ended = this.#storage.transactionSync(() => {
        this.#exec(
          "UPDATE environment SET owner_status = 'deleted', owner_version = max(owner_version, ?1)",
          standing.version,
        );

        return this.#end(Date.now());
      });

      return ok(null, ended ? [{ kind: "close" }] : []);
    }

    if (
      standing.version < served.owner_version ||
      (standing.version === served.owner_version && standing.status === served.owner_status)
    )
      return ok(null);
    this.#exec(
      "UPDATE environment SET owner_status = ?1, owner_version = ?2",
      standing.status,
      standing.version,
    );

    return ok(
      null,
      standing.status === "disabled" && served.owner_status === "active"
        ? [{ kind: "end-channels" }]
        : [],
    );
  }

  /** Presence for the owner's list. `connected`: the relay holds an authenticated socket. */
  status(ownerId: string, connected: boolean): Presence | null {
    if (!this.#loaded()) return { online: false, lastSeenAt: null };
    const served = this.#served();

    if (served === undefined || served.owner_id !== ownerId || served.state === "revoked")
      return null;

    const recent =
      served.last_seen_at !== null &&
      Date.now() - served.last_seen_at <= ONLINE_WINDOW_SECONDS * 1000;

    return { online: connected && recent, lastSeenAt: served.last_seen_at };
  }

  /**
   * Admit a phone request whose bearer must belong to a device of this
   * environment (`admission`), or to none. A relay that never loaded refuses
   * a bearer without reading D1: its desktop never connected.
   */
  async admit(input: {
    readonly bearer: string | undefined;
    readonly admission: RelayAdmission;
  }): Promise<Admitted> {
    if (input.admission === "none") return this.#counted(undefined);

    if (input.bearer === undefined || this.#served() === undefined)
      return { ok: false, code: "unauthorized" };
    const digest = await sha256(input.bearer);
    const served = this.#served();

    const device = one(
      DeviceRow,
      this.#exec(
        `SELECT id, session_id, state, grant_expires_at FROM devices WHERE digest = ?1
         ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, created_at DESC
         LIMIT 1`,
        digest,
      )[0],
    );

    if (served === undefined || device === undefined) return { ok: false, code: "unauthorized" };
    const live = served.state === "active" && device.state !== "revoked";

    if (input.admission === "reserved-or-active" && !live) return { ok: false, code: "forbidden" };

    if (input.admission === "active" && (!live || device.state !== "active"))
      return { ok: false, code: "unauthorized" };

    if (served.owner_status !== "active") return { ok: false, code: "closed" };

    return this.#counted(device.id);
  }

  /** Check a relay socket's `auth` frame: a proof for `GET` on this environment's relay route, spent once. */
  async authenticate(token: string): Promise<"ready" | "revoked" | "unauthorized"> {
    const served = await this.#load();

    if (served === undefined) return "unauthorized";

    const claims = await this.#spend(
      served,
      { token, body: "" },
      { method: "GET", path: BROKER_ROUTES.relay(this.#id), kind: "relay" },
    );

    if (claims === undefined) return "unauthorized";
    const current = this.#served() ?? served;

    if (current.state === "revoked" || current.owner_status === "deleted") return "revoked";

    return current.owner_status === "active" ? "ready" : "unauthorized";
  }

  /** Write what the outbox owes D1. A failed write waits with backoff; the relay's alarm tries again. */
  async drain(): Promise<void> {
    if (!this.#loaded()) return;

    const due = many(
      OutboxRow,
      this.#exec(
        "SELECT key, kind, session_id, owner_id, at, attempts FROM outbox WHERE next_at <= ?1 ORDER BY next_at",
        Date.now(),
      ),
    );

    for (const row of due) {
      try {
        if (row.kind === "deny")
          await denySession(this.#directory, {
            sessionId: row.session_id,
            userId: row.owner_id,
            at: row.at,
          });
        else await retireEnvironment(this.#directory, { id: this.#id, at: row.at });
        this.#exec("DELETE FROM outbox WHERE key = ?1", row.key);
      } catch (error) {
        this.#log.warn("outbox.deferred", {
          environmentId: this.#id,
          kind: row.kind,
          attempts: row.attempts,
          error: errorName(error),
        });
        this.#exec(
          "UPDATE outbox SET attempts = attempts + 1, next_at = ?2 WHERE key = ?1",
          row.key,
          Date.now() + Math.min(1000 * 2 ** Math.min(row.attempts, 12), 3_600_000),
        );
      }
    }
  }

  /** When the outbox next owes D1 a write, for the relay's alarm. */
  nextDue(): number | undefined {
    if (!this.#loaded()) return undefined;

    return one(DueRow, this.#exec("SELECT min(next_at) AS due FROM outbox")[0])?.due ?? undefined;
  }

  #exec(query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[] {
    return this.#storage.sql.exec(query, ...bindings).toArray();
  }

  /** Whether this relay copied its environment; until then it holds no tables at all. */
  #loaded(): boolean {
    return (
      this.#exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'environment'")
        .length > 0
    );
  }

  #served(): Served | undefined {
    if (!this.#loaded()) return undefined;

    return one(
      Served,
      this.#exec(
        "SELECT owner_id, public_key, state, policy, owner_status, owner_version, last_seen_at FROM environment",
      )[0],
    );
  }

  async #load(): Promise<Served | undefined> {
    const local = this.#served();

    if (local !== undefined) return local;
    this.#loading ??= this.#copy().finally(() => {
      this.#loading = undefined;
    });
    await this.#loading;

    return this.#served();
  }

  /**
   * Copy the identity and the owner's standing from D1. An id D1 doesn't know
   * creates nothing. `policy` starts from the clock, above every counter the
   * D1 store ever reached, because the desktop refuses a lease whose policy
   * is lower than one it accepted.
   */
  async #copy(): Promise<void> {
    const found = await loadEnvironment(this.#directory, this.#id);

    if (found === undefined) return;
    this.#storage.transactionSync(() => {
      for (const statement of SCHEMA) this.#exec(statement);
      this.#exec(
        `INSERT INTO environment (id, owner_id, public_key, state, policy, owner_status, owner_version, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL) ON CONFLICT (id) DO NOTHING`,
        this.#id,
        found.environment.owner_id,
        found.environment.public_key,
        found.environment.state,
        Date.now(),
        found.owner?.status ?? "active",
        found.owner?.version ?? 0,
      );
    });
  }

  /** Verify a proof this environment's key signed, and spend its `jti`. */
  async #spend(
    served: Served,
    proof: Proven,
    request: {
      readonly method: "GET" | "POST" | "DELETE";
      readonly path: string;
      readonly kind: "lease" | "revoke" | "relay";
    },
  ): Promise<ProofClaims | undefined> {
    let claims: ProofClaims;

    try {
      claims = await verifyProof({
        token: proof.token,
        key: { kty: "OKP", crv: "Ed25519", x: served.public_key },
        issuer: this.#id,
        audience: this.#config.origin,
        method: request.method,
        path: request.path,
        body: proof.body,
        now: Date.now(),
      });
    } catch {
      return undefined;
    }

    const now = Date.now();

    this.#exec("DELETE FROM proofs WHERE expires_at < ?1 AND at < ?2", now, now - PROOF_WINDOW_MS);

    const spent = this.#exec(
      `INSERT INTO proofs (jti, kind, at, expires_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (jti) DO NOTHING RETURNING jti`,
      claims.jti,
      request.kind,
      now,
      (claims.exp + CLOCK_TOLERANCE_SECONDS) * 1000,
    );

    return spent.length === 1 ? claims : undefined;
  }

  /** Whether the proofs of `kind` spent in the current window, this one included, are within its limit. */
  #within(kind: keyof typeof PROOF_LIMITS): boolean {
    const count =
      one(
        CountRow,
        this.#exec(
          "SELECT count(*) AS count FROM proofs WHERE kind = ?1 AND at > ?2",
          kind,
          Date.now() - PROOF_WINDOW_MS,
        )[0],
      )?.count ?? 0;

    return count <= PROOF_LIMITS[kind];
  }

  /** Who may remove something: the owner of this environment, or its key within the revoke window. */
  async #authorize(
    served: Served,
    actor: Actor,
    request: { readonly method: "DELETE"; readonly path: string },
  ): Promise<ErrorCode | undefined> {
    if (actor.kind === "owner") return actor.ownerId === served.owner_id ? undefined : "not_found";
    const claims = await this.#spend(served, actor.proof, { ...request, kind: "revoke" });

    if (claims === undefined) return "unauthorized";

    return this.#within("revoke") ? undefined : "rate_limited";
  }

  #device(deviceId: string): Static<typeof DeviceRow> | undefined {
    return one(
      DeviceRow,
      this.#exec(
        "SELECT id, session_id, state, grant_expires_at FROM devices WHERE id = ?1",
        deviceId,
      )[0],
    );
  }

  /** Revoke the environment and its devices, and owe D1 the retired slot. False when it already was. Call inside a transaction. */
  #end(now: number): boolean {
    const ended = this.#exec(
      "UPDATE environment SET state = 'revoked', policy = policy + 1 WHERE state = 'active' RETURNING owner_id",
    );

    const owner = one(Type.Object({ owner_id: Type.String() }), ended[0]);

    if (owner === undefined) return false;
    this.#exec(
      `UPDATE devices SET state = 'revoked', revoke_reason = 'environment', revoked_at = ?1
       WHERE state != 'revoked'`,
      now,
    );
    this.#exec(
      `INSERT INTO outbox (key, kind, session_id, owner_id, at, attempts, next_at)
       VALUES ('retire', 'retire', NULL, ?1, ?2, 0, ?2) ON CONFLICT (key) DO NOTHING`,
      owner.owner_id,
      now,
    );

    return true;
  }

  /**
   * Reserve a device before the desktop records it: lapsed reservations end
   * first, then the environment's `DEVICE_LIMIT` counts reservations and every
   * active device but the one this client replaces.
   */
  #reserve(
    grant: EnrollmentClaims,
    input: { readonly sessionId: string; readonly now: number },
  ): boolean {
    return this.#storage.transactionSync(() => {
      this.#exec(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'expired', revoked_at = ?1
         WHERE state = 'reserved' AND grant_expires_at < ?2`,
        input.now,
        input.now - CLOCK_TOLERANCE_SECONDS * 1000,
      );

      const taken =
        one(
          CountRow,
          this.#exec(
            `SELECT count(*) AS count FROM devices
             WHERE state = 'reserved' OR (state = 'active' AND client_id != ?1)`,
            grant.clientId,
          )[0],
        )?.count ?? 0;

      if (taken >= DEVICE_LIMIT) return false;
      this.#exec(
        `INSERT INTO devices
           (id, client_id, client_name, digest, session_id, state, grant_id, nonce, grant_expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'reserved', ?6, ?7, ?8, ?9)`,
        grant.deviceId,
        grant.clientId,
        grant.clientName,
        grant.digest,
        input.sessionId,
        grant.jti,
        grant.nonce,
        grant.exp * 1000,
        input.now,
      );

      return true;
    });
  }

  /** Give up a reservation the desktop never confirmed or that lost its activation. */
  #unreserve(deviceId: string): void {
    this.#exec(
      `UPDATE devices SET state = 'revoked', revoke_reason = 'unconfirmed', revoked_at = ?2
       WHERE id = ?1 AND state = 'reserved'`,
      deviceId,
      Date.now(),
    );
  }

  /**
   * Compare-and-set the reservation to active, replacing the client's earlier
   * device, only while the reservation is unexpired and unrevoked, the
   * environment and its owner are active, and neither D1 nor a strong revoke
   * here denies the session.
   */
  #activate(
    grant: EnrollmentClaims,
    input: { readonly sessionId: string; readonly denied: boolean },
  ): boolean {
    return this.#storage.transactionSync(() => {
      const served = this.#served();
      const device = this.#device(grant.deviceId);
      const now = Date.now();

      if (
        input.denied ||
        served?.state !== "active" ||
        served.owner_status !== "active" ||
        device?.state !== "reserved" ||
        device.grant_expires_at < now ||
        this.#exec(
          "SELECT 1 FROM devices WHERE session_id = ?1 AND revoke_reason = 'revoked' LIMIT 1",
          input.sessionId,
        ).length > 0
      )
        return false;
      this.#exec(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'replaced', revoked_at = ?1
         WHERE client_id = ?2 AND state = 'active' AND id != ?3`,
        now,
        grant.clientId,
        grant.deviceId,
      );
      this.#exec("UPDATE devices SET state = 'active' WHERE id = ?1", grant.deviceId);
      this.#exec("UPDATE environment SET policy = policy + 1");

      return true;
    });
  }

  /** Relay the grant to the desktop's enrollment route and read its receipt, bounded in time and size. */
  async #forwardEnrollment(authorization: string): Promise<string | undefined> {
    const envelope: EnrollEnvelope = { authorization };
    let response: Response;

    try {
      response = await this.#exchange({
        path: DESKTOP_ROUTES.enroll,
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(ENROLL_TIMEOUT_MS),
      });
    } catch {
      this.#log.warn("enroll.unreachable", { environmentId: this.#id, status: 0 });

      return undefined;
    }

    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => undefined);
      this.#log.warn("enroll.unreachable", { environmentId: this.#id, status: response.status });

      return undefined;
    }

    const text = await readText(response.body, RECEIPT_LIMIT);

    return text === undefined ? undefined : parseJson(ReceiptEnvelope, text)?.receipt;
  }

  async #receiptConfirms(input: {
    readonly receipt: string;
    readonly publicKey: string;
    readonly grant: EnrollmentClaims;
  }): Promise<boolean> {
    try {
      const claims = await verifyClaims({
        token: input.receipt,
        key: { kty: "OKP", crv: "Ed25519", x: input.publicKey },
        typ: TOKEN_TYPES.receipt,
        issuer: this.#id,
        audience: this.#config.origin,
        schema: ReceiptClaims,
        lifetime: ENROLLMENT_LIFETIME_SECONDS,
        now: Date.now(),
      });

      return (
        claims.req === input.grant.jti &&
        claims.nonce === input.grant.nonce &&
        claims.deviceId === input.grant.deviceId &&
        claims.digest === input.grant.digest
      );
    } catch {
      return false;
    }
  }

  /** Count an admitted request in this environment's relay window, held in memory: a flood keeps the object awake. */
  #counted(deviceId: string | undefined): Admitted {
    const now = Date.now();
    const start = now - (now % RELAY_LIMIT.windowMs);

    if (this.#relayWindow.start !== start) this.#relayWindow = { start, count: 0 };
    this.#relayWindow.count += 1;

    return this.#relayWindow.count <= RELAY_LIMIT.limit
      ? { ok: true, deviceId }
      : { ok: false, code: "closed" };
  }
}
