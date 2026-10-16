import { timingSafeEqual } from "node:crypto";
import {
  CLOCK_TOLERANCE_SECONDS,
  DEVICE_LIMIT,
  ENROLLMENT_LIFETIME_SECONDS,
  ENROLLMENT_READINESS_SECONDS,
  EnrollmentClaims,
  LEASE_LIFETIME_SECONDS,
  LeaseClaims,
  PROOF_LIFETIME_SECONDS,
  TOKEN_TYPES,
} from "../index.ts";
import type { DeviceRole, ReceiptClaims } from "../index.ts";
import { nowSeconds, signClaims } from "../signing.ts";
import type { ConnectLease, ConnectRelay } from "../view.ts";
import type { DesktopBroker, LeaseAnswer } from "./broker.ts";
import type { ConnectFiles, ConnectTiming } from "./context.ts";
import type { ConnectOutbox } from "./outbox.ts";
import { RelayConnection } from "./relay.ts";
import type { RelayDial } from "./relay.ts";
import { bearerToken, connectRouteHandler, refused, tokenDigest } from "./routes.ts";
import type { AuthorizingRequest, RouteAnswer } from "./routes.ts";
import { CONSUMED_LIMIT, REVOCATION_LIMIT } from "./store.ts";
import type { StoredDevice, StoredLink } from "./store.ts";
import { refusedCode } from "./tokens.ts";
import type { BrokerKeyring, LinkTrust } from "./tokens.ts";

/**
 * Who a relayed request is, decided here on every request. The embedding
 * turns an allowed device into its own principal; `principal` is a stable
 * name for a server that takes the decision as it is.
 */
export type DeviceDecision =
  | {
      readonly kind: "allow";
      readonly principal: string;
      readonly device: { readonly id: string; readonly name: string; readonly role: DeviceRole };
    }
  | { readonly kind: "deny"; readonly reason: "unauthorized" | "forbidden" };

/** What the host binds for account remote access. */
export interface ConnectListen {
  readonly authorize: (request: AuthorizingRequest) => Promise<DeviceDecision>;
  readonly handle: (request: Request) => Promise<Response | undefined>;
}

export interface ConnectListener {
  /** The ephemeral port it bound on `127.0.0.1`. */
  readonly port: number;
  /** Drop every open connection and keep the port bound. */
  disconnectClients(): void;
  close(): Promise<void>;
}

/** Bind the share on an ephemeral `127.0.0.1` port under the host's folder trust. */
export type ConnectShare = (listen: ConnectListen) => Promise<ConnectListener>;

/** What a serving session asks of the runtime that owns it. */
export interface ServingOwner {
  /** Whether `session` is still the one the runtime serves through. */
  current(session: ServingSession): boolean;
  changed(): void;
  /** The broker answered `revoked` for the environment. */
  environmentRevoked(environmentId: string): void;
  /** Close every stream on the live listener, after `dropDelayMs` when `defer`. */
  dropStreams(defer: boolean): void;
  /** The store failed under a request: refuse everything and stop, after that request answers. */
  failClosed(): void;
  /** A device asked to be forgotten through its own token. */
  release(deviceId: string): Promise<void>;
}

export interface ServingSessionOptions {
  readonly epoch: number;
  readonly environmentId: string;
  readonly files: ConnectFiles;
  readonly broker: DesktopBroker;
  readonly keyring: BrokerKeyring;
  readonly trust: LinkTrust;
  readonly outbox: ConnectOutbox;
  readonly timing: ConnectTiming;
  readonly owner: ServingOwner;
}

const READINESS_WINDOW_MS = (ENROLLMENT_LIFETIME_SECONDS + ENROLLMENT_READINESS_SECONDS) * 1_000;

interface HeldLease {
  readonly devices: ReadonlySet<string>;
  readonly expiresAt: number;
  readonly sentAt: number;
}

interface Refresh {
  readonly at: number;
  state: "pending" | "renewed" | "failed";
  done: Promise<void>;
}

type BeatOutcome = "renewed" | "lapsed" | "failed";

function within(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * One run of serving the linked environment: the loopback listener, the relay
 * socket, and the device lease that decides every request. The lease is
 * renewed on a heartbeat; a device the lease does not list is refused, except
 * one that just enrolled, which waits briefly for a lease that lists it.
 */
export class ServingSession {
  readonly epoch: number;
  readonly environmentId: string;
  private readonly options: ServingSessionOptions;
  private readonly controller = new AbortController();
  private local: ConnectListener | undefined;
  private relay: RelayConnection | undefined;
  private lease: HeldLease | undefined;
  private lapsed: "offline" | "owner_disabled" | undefined;
  private resetAt = Date.now();
  private beatTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly refreshes = new Map<string, Refresh>();

  constructor(options: ServingSessionOptions) {
    this.options = options;
    this.epoch = options.epoch;
    this.environmentId = options.environmentId;
  }

  /** Whether `halt` ran: this session refuses everything from then on. */
  get halted(): boolean {
    return this.controller.signal.aborted;
  }

  /** The relay socket's state; connecting until `attach`. */
  connection(): ConnectRelay {
    return this.relay?.status() ?? { kind: "connecting" };
  }

  /** End every relayed exchange and drop every local connection; the port stays bound. */
  disconnectClients(): void {
    this.relay?.dropStreams();
    this.local?.disconnectClients();
  }

  /** Close the relay socket and the listener for good. */
  async close(): Promise<void> {
    this.relay?.close();
    await this.local?.close();
  }

  /** What the share binds: every request is authorized, and enrollment routed, here. */
  listen(): ConnectListen {
    return {
      authorize: (request) => this.authorize(request),
      handle: connectRouteHandler({
        host: () => (this.local === undefined ? undefined : `127.0.0.1:${String(this.local.port)}`),
        enroll: (authorization) => this.enroll(authorization),
        forget: (digest) => this.forgetPresented(digest),
      }),
    };
  }

  /** Serve the bound listener through a relay socket to `url`. Nothing dials until `start`. */
  attach(local: ConnectListener, url: string, dial: RelayDial | undefined): void {
    const { broker, files, owner, timing } = this.options;

    const relay = new RelayConnection({
      url,
      port: local.port,
      proof: async () => {
        const current = files.currentLink(this.environmentId);

        if (current === undefined || !this.live()) throw new Error("Not serving");

        return broker.relayProof({ key: current.key, environmentId: this.environmentId });
      },
      dial,
      onChange: () => owner.changed(),
      onRevoked: () => {
        if (this.live()) void this.beat();
      },
      timing: timing.relay,
    });

    this.local = local;
    this.relay = relay;
  }

  /** Ask for the first lease and dial the relay. */
  start(): void {
    void this.beat();
    this.relay?.start();
  }

  /** Refuse everything from now on and stop renewing. The listener stays until closed. */
  halt(): void {
    this.lease = undefined;
    this.controller.abort();
    clearTimeout(this.beatTimer);
    clearTimeout(this.expiryTimer);
  }

  /**
   * After sleep the held lease says nothing about now: refuse every device and
   * close their streams until a fresh lease arrives. The relay socket is
   * likely dead too, so it dials again now.
   */
  resume(): void {
    this.lease = undefined;
    this.lapsed = undefined;
    this.resetAt = Date.now();
    clearTimeout(this.expiryTimer);
    this.disconnectClients();
    this.relay?.reconnect();
    this.options.owner.changed();
    void this.beat();
  }

  /** Whether the current lease lists the device. */
  listed(deviceId: string): boolean {
    const lease = this.lease;

    return (
      this.live() &&
      lease !== undefined &&
      this.lapsed === undefined &&
      Date.now() < lease.expiresAt &&
      lease.devices.has(deviceId)
    );
  }

  leaseView(): ConnectLease {
    if (this.lapsed !== undefined) return { kind: "lapsed", reason: this.lapsed };
    const lease = this.lease;

    if (lease === undefined) return { kind: "pending" };

    return Date.now() < lease.expiresAt
      ? { kind: "current", expiresAt: lease.expiresAt }
      : { kind: "lapsed", reason: "offline" };
  }

  private live(): boolean {
    return this.options.owner.current(this);
  }

  private async beat(): Promise<BeatOutcome> {
    const outcome = await this.renew();

    if (this.live()) {
      clearTimeout(this.beatTimer);
      this.beatTimer = setTimeout(
        () => void this.beat(),
        outcome === "failed" ? this.options.timing.retryMs : this.options.timing.heartbeatMs,
      );
    }

    return outcome;
  }

  private async renew(): Promise<BeatOutcome> {
    const { broker, files, owner } = this.options;
    const link = files.currentLink(this.environmentId);

    if (link === undefined) return "failed";

    try {
      const answer = await broker.lease({
        key: link.key,
        environmentId: this.environmentId,
        signal: this.controller.signal,
      });

      return (await this.applyLease(link, answer)) ? "renewed" : "failed";
    } catch (cause) {
      if (!this.live()) return "failed";
      const code = refusedCode(cause);

      if (code === "revoked") {
        owner.environmentRevoked(this.environmentId);

        return "failed";
      }

      if (code === "owner_disabled") {
        this.lapse("owner_disabled");

        return "lapsed";
      }

      return "failed";
    }
  }

  private async applyLease(link: StoredLink, answer: LeaseAnswer): Promise<boolean> {
    const { keyring, trust, outbox, owner } = this.options;

    const claims = await keyring.verify(link, answer.lease, {
      typ: TOKEN_TYPES.lease,
      schema: LeaseClaims,
      lifetime: LEASE_LIFETIME_SECONDS,
    });

    if (
      claims === undefined ||
      claims.sub !== link.owner.id ||
      claims.req !== answer.request ||
      !this.live() ||
      answer.sentAt < this.resetAt ||
      trust.behindLease(this.environmentId, claims)
    )
      return false;
    const now = Date.now();
    const expiresAt = Math.min(claims.exp * 1_000, answer.sentAt + LEASE_LIFETIME_SECONDS * 1_000);

    if (expiresAt <= now) return false;
    trust.accept(this.environmentId, claims);

    const previous =
      this.lease !== undefined && this.lapsed === undefined && now < this.lease.expiresAt
        ? this.lease
        : undefined;

    const devices = new Set(claims.devices);
    const lease: HeldLease = { devices, expiresAt, sentAt: answer.sentAt };
    this.lease = lease;
    this.lapsed = undefined;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.expire(lease), expiresAt - now);
    const dropped = previous !== undefined && [...previous.devices].some((id) => !devices.has(id));

    if (dropped) this.disconnectClients();

    if (previous === undefined || dropped || [...devices].some((id) => !previous.devices.has(id)))
      owner.changed();

    this.pruneInactive(lease);

    if (link.revocations.length > 0) void outbox.sendRevocations(false);

    return true;
  }

  /** Forget devices the broker stopped listing once their enrollment could no longer be in flight. */
  private pruneInactive(lease: HeldLease): void {
    const { files, owner } = this.options;
    const link = files.currentLink(this.environmentId);
    const settled = lease.sentAt - (ENROLLMENT_LIFETIME_SECONDS + CLOCK_TOLERANCE_SECONDS) * 1_000;

    const inactive = new Set(
      (link?.devices ?? [])
        .filter((device) => !lease.devices.has(device.id) && device.createdAt < settled)
        .map((device) => device.id),
    );

    if (inactive.size === 0) return;
    this.disconnectClients();
    void files
      .change((file) =>
        file.link?.environment.id === this.environmentId
          ? {
              ...file,
              link: {
                ...file.link,
                devices: file.link.devices.filter((device) => !inactive.has(device.id)),
              },
            }
          : file,
      )
      .then(() => owner.changed())
      .catch(() => undefined);
  }

  private expire(lease: HeldLease): void {
    if (this.lease !== lease) return;
    this.lease = undefined;
    this.lapsed = "offline";
    this.disconnectClients();
    this.options.owner.changed();
  }

  private lapse(reason: "offline" | "owner_disabled"): void {
    const had = this.lease !== undefined || this.lapsed !== reason;
    this.lease = undefined;
    this.lapsed = reason;
    clearTimeout(this.expiryTimer);
    this.disconnectClients();

    if (had) this.options.owner.changed();
  }

  private async authorize(request: AuthorizingRequest): Promise<DeviceDecision> {
    const token = bearerToken(request);

    if (token === undefined) return { kind: "deny", reason: "unauthorized" };
    const digest = tokenDigest(token);
    const device = this.deviceFor(digest);

    if (device === undefined) return { kind: "deny", reason: "forbidden" };

    const allowed = (): DeviceDecision => ({
      kind: "allow",
      principal: `device:${device.id}`,
      device: { id: device.id, name: device.name, role: device.role },
    });

    if (this.listed(device.id)) return allowed();

    if (!this.awaitsLease(device)) return { kind: "deny", reason: "forbidden" };
    await this.refreshFor(device);

    return this.deviceFor(digest)?.id === device.id && this.listed(device.id)
      ? allowed()
      : { kind: "deny", reason: "forbidden" };
  }

  /** The stored device whose bearer digest is `digest`, compared in constant time; none once refused here. */
  private deviceFor(digest: Buffer): StoredDevice | undefined {
    if (!this.live()) return undefined;
    const link = this.options.files.currentLink(this.environmentId);

    if (link === undefined) return undefined;
    let match: StoredDevice | undefined;

    for (const device of link.devices) {
      const stored = Buffer.from(device.digest, "base64url");

      if (stored.length === digest.length && timingSafeEqual(stored, digest)) match = device;
    }

    return match === undefined || this.options.trust.denied.has(match.id) ? undefined : match;
  }

  /** Whether the device may be newer than the held lease, so one more renewal could list it. */
  private awaitsLease(device: StoredDevice): boolean {
    const lease = this.lease;
    const now = Date.now();

    return (
      lease !== undefined &&
      this.lapsed === undefined &&
      now < lease.expiresAt &&
      (device.createdAt >= lease.sentAt || now - device.createdAt <= READINESS_WINDOW_MS)
    );
  }

  private refreshFor(device: StoredDevice): Promise<void> {
    const { timing } = this.options;
    const now = Date.now();
    const previous = this.refreshes.get(device.id);

    if (previous?.state === "pending") return previous.done;

    if (
      previous !== undefined &&
      now <
        previous.at +
          (previous.state === "renewed" ? timing.readinessThrottleMs : timing.readinessRetryMs)
    )
      return Promise.resolve();
    const refresh: Refresh = { at: now, state: "pending", done: Promise.resolve() };

    const answered = this.beat().then((outcome) => {
      refresh.state = outcome === "renewed" ? "renewed" : "failed";
    });

    refresh.done = within(answered, timing.readinessWaitMs).then(() => {
      if (refresh.state === "pending") refresh.state = "failed";
    });
    this.refreshes.set(device.id, refresh);

    return refresh.done;
  }

  private async enroll(authorization: string): Promise<RouteAnswer> {
    const { broker, files, keyring, trust, owner } = this.options;

    if (!this.live()) return refused(403, "forbidden");
    const link = files.currentLink(this.environmentId);

    if (link === undefined) return refused(404, "not_found");

    const claims = await keyring.verify(link, authorization, {
      typ: TOKEN_TYPES.enrollment,
      schema: EnrollmentClaims,
      lifetime: ENROLLMENT_LIFETIME_SECONDS,
    });

    if (claims === undefined) return refused(401, "unauthorized");

    if (
      claims.sub !== link.owner.id ||
      trust.behindGeneration(this.environmentId, claims.generation)
    )
      return refused(403, "forbidden");
    let outcome: "recorded" | "replaced" | "gone" | "conflict" | "limit";

    try {
      outcome = await files.store.update((file) => {
        const current = file.link;

        if (current === null || current.environment.id !== this.environmentId)
          return { file, result: "gone" };
        const now = Date.now();

        const consumed = current.consumed.filter(
          (entry) => (entry.exp + CLOCK_TOLERANCE_SECONDS) * 1_000 > now,
        );

        const existing = current.devices.find((device) => device.id === claims.deviceId);

        if (consumed.some((entry) => entry.jti === claims.jti))
          return {
            file,
            result: existing?.digest === claims.digest ? "recorded" : "conflict",
          };

        if (
          existing !== undefined ||
          current.revocations.some((entry) => entry.deviceId === claims.deviceId) ||
          current.devices.some((device) => device.digest === claims.digest)
        )
          return { file, result: "conflict" };
        const kept = current.devices.filter((device) => device.clientId !== claims.clientId);

        if (
          kept.length >= DEVICE_LIMIT ||
          kept.length + current.revocations.length >= REVOCATION_LIMIT ||
          consumed.length >= CONSUMED_LIMIT
        )
          return { file, result: "limit" };

        const device: StoredDevice = {
          id: claims.deviceId,
          clientId: claims.clientId,
          name: claims.clientName,
          digest: claims.digest,
          createdAt: now,
          role: claims.role ?? "controller",
        };

        return {
          file: {
            ...file,
            link: {
              ...current,
              devices: [...kept, device],
              consumed: [...consumed, { jti: claims.jti, exp: claims.exp }],
            },
          },
          result: kept.length === current.devices.length ? "recorded" : "replaced",
        };
      });
    } catch {
      owner.failClosed();

      return refused(500, "internal");
    }

    switch (outcome) {
      case "gone":
        return refused(404, "not_found");
      case "conflict":
        return refused(409, "conflict");
      case "limit":
        return refused(429, "limit");
      case "replaced":
        owner.dropStreams(true);
        break;
      case "recorded":
        break;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }

    owner.changed();
    const iat = nowSeconds();

    const receipt: ReceiptClaims = {
      iss: this.environmentId,
      aud: broker.origin,
      iat,
      exp: iat + PROOF_LIFETIME_SECONDS,
      req: claims.jti,
      nonce: claims.nonce,
      deviceId: claims.deviceId,
      digest: claims.digest,
    };

    return {
      kind: "json",
      status: 200,
      body: {
        receipt: await signClaims({ key: link.key, typ: TOKEN_TYPES.receipt, claims: receipt }),
      },
    };
  }

  private async forgetPresented(digest: Buffer): Promise<RouteAnswer> {
    const device = this.deviceFor(digest);

    if (device === undefined) return refused(403, "forbidden");

    try {
      await this.options.owner.release(device.id);
    } catch {
      return refused(500, "internal");
    }

    return { kind: "empty" };
  }
}
