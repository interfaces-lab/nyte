/**
 * Account remote access: this Mac linked to the user's Nyte account, reached
 * through the broker's relay over a WebSocket this Mac opens, by the phones
 * the user enrolls through the same account.
 *
 * Who may use the listener is decided here on every request. A device needs
 * both its token's digest on disk here and its id in the current lease: a
 * broker-signed, unexpired list of active devices, asked for every 20 seconds
 * with a proof from the machine key and kept only in memory. No lease since
 * start or wake, an expired one, or a broker that says the owner is disabled
 * refuses every device and closes their streams; the listener and the relay
 * stay up so access returns with the next lease. Leases are ordered by
 * `policy` and bound to the proof that asked for them, so an older or
 * replayed answer never restores a device a newer one dropped.
 *
 * Starts, stops, links, unlinks, and unlink retries run one at a time.
 * Anything that takes access away does so synchronously before it queues, and
 * advances an epoch that every later async completion checks, so nothing
 * still in flight can grant access again.
 *
 * Clerk session JWTs come from the sign-in dialog only for `link`, are sent
 * once to the broker, and are never kept. Everything after that, the lease
 * heartbeat and the relay's proof included, signs with the machine key.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { scheduler } from "node:timers/promises";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  BrokerError,
  CLOCK_TOLERANCE_SECONDS,
  DEVICE_LIMIT,
  ENROLLMENT_LIFETIME_SECONDS,
  ENROLLMENT_READINESS_SECONDS,
  EnrollmentClaims,
  HEARTBEAT_INTERVAL_SECONDS,
  LEASE_LIFETIME_SECONDS,
  LINK_POLL_INTERVAL_SECONDS,
  LeaseClaims,
  PROOF_LIFETIME_SECONDS,
  TOKEN_TYPES,
  keyFingerprint,
  randomUserCode,
} from "../index.ts";
import type {
  BrokerKeys,
  DeviceRole,
  LinkResponse,
  LinkTransactionState,
  PublicJwk,
  ReceiptClaims,
} from "../index.ts";
import { machineName } from "./machine-name.ts";
import {
  brokerKey,
  generateMachineKey,
  keyThumbprint,
  nowSeconds,
  publicKeyOf,
  randomId,
  signClaims,
  verifyClaims,
} from "../signing.ts";
import type { PrivateJwk } from "../signing.ts";
import type {
  ConnectLease,
  ConnectLinkFailure,
  ConnectLinking,
  ConnectNotice,
  ConnectUnavailable,
  ConnectView,
} from "../view.ts";
import { AccountCancelled } from "./account.ts";
import type { AccountSession } from "./account.ts";
import { DesktopBroker } from "./broker.ts";
import type { BrokerFetch, LeaseAnswer } from "./broker.ts";
import { RelayConnection } from "./relay.ts";
import type { RelayDial, RelayTiming } from "./relay.ts";
import { bearerToken, connectRouteHandler, refused, tokenDigest } from "./routes.ts";
import type { AuthorizingRequest, RouteAnswer } from "./routes.ts";
import {
  CONSUMED_LIMIT,
  ConnectStore,
  ConnectStoreFailed,
  REVOCATION_LIMIT,
  UNLINK_LIMIT,
} from "./store.ts";
import type { ConnectFile, LinkKey, StoredDevice, StoredLink } from "./store.ts";
import { ConnectError } from "./errors.ts";

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

export interface ConnectTiming {
  readonly heartbeatMs: number;
  /** After a failed lease request, how soon to ask again. */
  readonly retryMs: number;
  readonly unlinkRetryMs: number;
  /** Longest a request from a just-enrolled device waits for a fresh lease. */
  readonly readinessWaitMs: number;
  /** Least time between two such refreshes for one device once one came back. */
  readonly readinessThrottleMs: number;
  /** After one that failed or timed out, least time before the device's next request may try again. */
  readonly readinessRetryMs: number;
  /** Least time between two reads of the broker's key set. */
  readonly keysMs: number;
  /** How long a self-revocation's own response has before every stream is dropped. */
  readonly dropDelayMs: number;
  /** How often a linking host asks the broker whether the owner approved. */
  readonly linkPollMs: number;
  readonly relay?: Partial<RelayTiming>;
}

/**
 * How long after recording a device a request may still find it missing from
 * the held lease for no worse reason than timing: the broker activates it
 * after the receipt, and the phone retries for `ENROLLMENT_READINESS_SECONDS`
 * after it hears back.
 */
const READINESS_WINDOW_MS = (ENROLLMENT_LIFETIME_SECONDS + ENROLLMENT_READINESS_SECONDS) * 1_000;

const DEFAULT_TIMING: ConnectTiming = {
  heartbeatMs: HEARTBEAT_INTERVAL_SECONDS * 1_000,
  retryMs: 5_000,
  unlinkRetryMs: 300_000,
  readinessWaitMs: 5_000,
  readinessThrottleMs: 30_000,
  readinessRetryMs: 2_000,
  keysMs: 300_000,
  dropDelayMs: 250,
  linkPollMs: LINK_POLL_INTERVAL_SECONDS * 1_000,
};

/** The broker this runtime talks to. A desktop build adds its Clerk configuration beside it. */
export interface HostConnectConfig {
  /** A canonical `https://` origin: the broker and its relay. */
  readonly origin: string;
}

/**
 * How this host gets an owner's approval to link. A desktop asks its own
 * sign-in for a session JWT; a headless host opens a broker transaction and
 * shows the code and fingerprint for the owner to approve elsewhere.
 */
export type LinkAuthorizer =
  | { readonly kind: "session"; readonly account: AccountSession }
  | {
      readonly kind: "transaction";
      /** The transaction is open: show where to approve, the code and the fingerprint to compare. */
      readonly onOpened: (opened: Extract<ConnectLinking, { kind: "awaiting_approval" }>) => void;
    };

export interface ConnectRuntimeOptions {
  /** Absent in a build without the public connect configuration. */
  readonly config: HostConnectConfig | undefined;
  /** `~/.nyte`, where the store lives unless `storePath` says otherwise. */
  readonly home: string;
  /** The Connect state file; default `<home>/connect.json`. A host profile passes its own. */
  readonly storePath?: string;
  readonly authorizer: LinkAuthorizer | undefined;
  /** Something Settings shows has changed. Carries nothing itself. */
  readonly onChange: () => void;
  /** This Mac's name at the broker; defaults to the host name. */
  readonly name?: string;
  readonly fetch?: BrokerFetch;
  readonly dial?: RelayDial;
  readonly timing?: Partial<ConnectTiming>;
}

interface HeldLease {
  readonly devices: ReadonlySet<string>;
  readonly expiresAt: number;
  /** When the request that brought it was sent, by this Mac's clock. */
  readonly sentAt: number;
}

interface Serving {
  readonly epoch: number;
  readonly environmentId: string;
  readonly controller: AbortController;
  /** The bound loopback port; undefined until the share answers. */
  port: number | undefined;
  /** The relay and the loopback listener as one: drops reach both, and the relay closes first. */
  listener: ConnectListener | undefined;
  relay: RelayConnection | undefined;
  stopping: boolean;
  lease: HeldLease | undefined;
  lapse: "offline" | "owner_disabled" | undefined;
  /** Leases asked for before this are discarded: start and wake. */
  resetAt: number;
  beatTimer: ReturnType<typeof setTimeout> | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly refreshes: Map<string, Refresh>;
}

/** A readiness lease for one device: shared while pending, throttled once it came back. */
interface Refresh {
  readonly at: number;
  state: "pending" | "renewed" | "failed";
  done: Promise<void>;
}

interface HighWater {
  readonly environmentId: string;
  readonly generation: number;
  readonly policy: number;
  readonly iat: number;
}

function storeFailed(): ConnectError {
  return new ConnectError({
    code: "internal",
    message: "Nyte can't use ~/.nyte/connect.json. Remote access is off.",
  });
}

function unavailable(): ConnectError {
  return new ConnectError({
    code: "forbidden",
    message: "Account remote access isn't available in this build or on this Mac.",
  });
}

function notLinked(): ConnectError {
  return new ConnectError({
    code: "not_found",
    message: "Link this Mac to your account first.",
  });
}

function closed(): ConnectError {
  return new ConnectError({ code: "closed", message: "Nyte is quitting." });
}

function originChanged(): ConnectError {
  return new ConnectError({
    code: "forbidden",
    message: "This host is linked through another broker. Unlink it before linking here.",
  });
}

/** The owner, the clock or this host ended the transaction before it was completed. */
class LinkStopped extends Error {
  readonly state: "pending" | "approved" | "denied" | "expired" | "cancelled";

  constructor(state: "pending" | "approved" | "denied" | "expired" | "cancelled") {
    super(`Link transaction ${state}`);
    this.name = "LinkStopped";
    this.state = state;
  }
}

type TransactionLinkKey = Extract<LinkKey, { kind: "transaction" }>;

/** One `link()` run, from its first broker call to its last word on disk. */
interface LinkAttempt {
  readonly controller: AbortController;
  done: Promise<void>;
  /** The user gave the link up; a transaction then ends at the broker too. Closing alone keeps it. */
  cancelled: boolean;
  /** The environment this attempt put on disk as the link, once it has. */
  persisted: string | undefined;
}

function refusedCode(cause: unknown): string | undefined {
  return cause instanceof BrokerError && cause.failure.kind === "refused"
    ? cause.failure.code
    : undefined;
}

/** Resolve when `promise` does or `ms` passes, whichever is first. */
function within(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const SessionClaims = Type.Object({ sub: Type.String({ minLength: 1, maxLength: 128 }) });

/** The `sub` of a session JWT, read without verifying it: bookkeeping, never authority. */
function sessionSubject(token: string): string | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );

    return Value.Check(SessionClaims, payload) ? payload.sub : null;
  } catch {
    return null;
  }
}

function linkFailure(cause: unknown, signal: AbortSignal): ConnectLinkFailure {
  if (signal.aborted || cause instanceof AccountCancelled) return "cancelled";

  if (cause instanceof LinkStopped) {
    switch (cause.state) {
      case "denied":
      case "expired":
      case "cancelled":
        return cause.state;
      default:
        return "refused";
    }
  }

  if (!(cause instanceof BrokerError)) return "refused";

  switch (cause.failure.kind) {
    case "network":
      return "network";
    case "refused":
      switch (cause.failure.code) {
        case "limit":
          return "limit";
        case "owner_disabled":
          return "owner_disabled";
        case "session_revoked":
          return "session_revoked";
        default:
          return "refused";
      }

    default:
      return "refused";
  }
}

export class ConnectRuntime {
  private readonly options: ConnectRuntimeOptions;
  private readonly timing: ConnectTiming;
  private readonly store: ConnectStore;
  private readonly broker: DesktopBroker | undefined;
  /** Aborts background broker calls when Nyte quits. */
  private readonly lifetime = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  /** Advanced by everything that takes access away; a serving from an older epoch grants nothing. */
  private epoch = 0;
  private serving: Serving | undefined;
  private linking: ConnectLinking = { kind: "idle" };
  private linkAttempt: LinkAttempt | undefined;
  private readonly accountOpens = new Set<AbortController>();
  private notice: ConnectNotice = { kind: "none" };
  /** Refused here before the store has caught up. */
  private readonly denied = new Set<string>();
  private highWater: HighWater | undefined;
  private keysReadAt = Number.NEGATIVE_INFINITY;
  private revocationsSentAt = Number.NEGATIVE_INFINITY;
  private revoking: Promise<void> | undefined;
  private revokeAgain = false;
  private unlinking: Promise<void> | undefined;
  private unlinkTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** The one teardown every `close()` caller waits on. */
  private closing: Promise<void> | undefined;

  constructor(options: ConnectRuntimeOptions) {
    this.options = options;
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.store = new ConnectStore(options.storePath ?? join(options.home, "connect.json"));
    this.broker =
      options.config === undefined
        ? undefined
        : new DesktopBroker({ origin: options.config.origin, fetch: options.fetch });
  }

  async view(): Promise<ConnectView> {
    const { broker } = this;
    const reason = this.unavailableReason();

    if (broker === undefined || reason !== undefined)
      return { kind: "unavailable", reason: reason ?? "not_configured" };
    const read = await this.store.read();

    if (read.kind === "failed") return { kind: "unavailable", reason: "store_failed" };
    const account = this.account?.state() ?? { kind: "unavailable" };
    const { link } = read.file;

    if (
      (link !== null && link.origin !== broker.origin) ||
      (read.file.linkKey !== null && read.file.linkKey.origin !== broker.origin)
    )
      return { kind: "unavailable", reason: "origin_changed" };

    if (link === null) {
      return {
        kind: "unlinked",
        account,
        linking: this.linking,
        notice:
          this.notice.kind === "none" && read.file.unlinks.length > 0
            ? { kind: "unlink_pending" }
            : this.notice,
      };
    }

    const serving = this.liveServing(link.environment.id);

    return {
      kind: "linked",
      account,
      owner: link.owner,
      environment: {
        id: link.environment.id,
        name: link.environment.name,
        address: broker.address(link.environment.id),
      },
      enabled: read.file.enabled,
      connection:
        serving === undefined
          ? { kind: "stopped" }
          : (serving.relay?.status() ?? { kind: "connecting" }),
      lease: this.leaseView(serving),
      devices: link.devices
        .filter((device) => !this.denied.has(device.id))
        .map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          authorized: serving !== undefined && this.listed(serving, device.id),
        })),
    };
  }

  /**
   * Open the sign-in dialog, then register this Mac with the broker. The
   * answer says how it ended; a failure is in `linking`, not thrown.
   */
  async link(): Promise<ConnectView> {
    await this.requireUsable();

    if (this.options.authorizer === undefined) throw unavailable();
    const pending = this.linkAttempt;

    if (pending !== undefined) {
      await pending.done;

      return this.view();
    }

    // Every link may become a pending unlink; none of those is ever dropped.
    if ((await this.readyFile()).unlinks.length >= UNLINK_LIMIT) await this.retryUnlinks();

    if ((await this.readyFile()).unlinks.length >= UNLINK_LIMIT) {
      this.setLinking({ kind: "failed", reason: "refused" });

      return this.view();
    }

    const controller = new AbortController();

    const attempt: LinkAttempt = {
      controller,
      done: Promise.resolve(),
      cancelled: false,
      persisted: undefined,
    };

    this.linkAttempt = attempt;
    attempt.done = this.runLink(attempt);
    await attempt.done;

    return this.view();
  }

  /** The user gives the link up: the attempt ends and an open transaction is cancelled at the broker. */
  async cancel(): Promise<void> {
    const pending = this.linkAttempt;

    if (pending === undefined) return;
    pending.cancelled = true;
    pending.controller.abort();
    await pending.done;
  }

  /** Persist the toggle. On serves through `share`; off stops at once. */
  async setEnabled(input: {
    readonly enabled: boolean;
    readonly share: ConnectShare;
  }): Promise<ConnectView> {
    await this.requireUsable();

    if (!input.enabled) {
      this.denyAll();
      await this.serial(async () => {
        await this.stopServing();
        await this.change((file) => (file.enabled ? { ...file, enabled: false } : file));
      });
    } else {
      await this.serial(async () => {
        if (this.closed) throw closed();

        const file = await this.readyFile();

        if (file.link === null) throw notLinked();
        await this.change((current) => (current.enabled ? current : { ...current, enabled: true }));

        try {
          await this.startServing(input.share);
        } catch (cause) {
          await this.change((current) => ({ ...current, enabled: false })).catch(() => undefined);
          throw cause;
        }
      });
    }

    this.changed();

    return this.view();
  }

  /**
   * Serve if the user left it on, after the first window prepared its target.
   * A target that is not trusted, or anything else in the way, leaves it off
   * for this run without asking.
   */
  async autostart(share: ConnectShare): Promise<void> {
    void this.retryUnlinks();

    if (this.unavailableReason() !== undefined) return;
    await this.serial(async () => {
      const read = await this.store.read();

      if (read.kind === "failed" || !read.file.enabled || read.file.link === null) return;

      await this.startServing(share).catch(() => undefined);
    });
    this.changed();
  }

  /**
   * Refuse every account device and stop serving, forget the link and its
   * devices here, then remove the environment at the broker. A broker that
   * cannot be reached is retried on later runs with the key kept for it.
   */
  async unlink(): Promise<void> {
    await this.cancel();
    await this.queueUnlink(undefined);
    this.changed();
    await this.retryUnlinks();
  }

  /**
   * Refuse every account device, stop serving, and move the link (`expected`
   * when given, whichever is on disk otherwise) into the unlink queue, keeping
   * its key for the broker call.
   */
  private async queueUnlink(expected: string | undefined): Promise<void> {
    this.denyAll();
    await this.serial(async () => {
      const file = await this.readyFile();
      const { link } = file;

      if (link === null || (expected !== undefined && link.environment.id !== expected)) return;
      await this.stopServing();
      await this.change((current) =>
        current.link === null
          ? current
          : {
              ...current,
              enabled: false,
              link: null,
              // Linking waits while the queue is full, so this never drops a key a cleanup needs.
              unlinks: [
                ...current.unlinks.filter(
                  (pending) => pending.environmentId !== link.environment.id,
                ),
                {
                  origin: link.origin,
                  environmentId: link.environment.id,
                  key: link.key,
                  at: Date.now(),
                },
              ],
            },
      );
      this.forgetLink();
      this.notice = { kind: "none" };
    });
  }

  /** Refuse the device here at once and close every stream, then revoke it at the broker. */
  async revokeDevice(input: { readonly deviceId: string }): Promise<void> {
    await this.requireUsable();
    await this.forgetDevice(input.deviceId, "revoke");
  }

  /**
   * Show the sign-in dialog. While a link or another open is waiting on it,
   * only bring its window forward: a new token request would cancel theirs.
   * Signed in, there is nothing to show; signed out, ask for a token so the
   * user can sign in, and drop it unused.
   */
  async openAccount(): Promise<void> {
    const { account } = this;

    if (account === undefined) throw unavailable();

    if (this.linkAttempt !== undefined || this.accountOpens.size > 0) {
      account.focus();

      return;
    }

    if (account.state().kind === "signed_in") return;

    const controller = new AbortController();
    this.accountOpens.add(controller);

    try {
      await account.requestSessionToken({ signal: controller.signal });
    } catch (cause) {
      if (!(cause instanceof AccountCancelled) && !controller.signal.aborted) throw cause;
    } finally {
      this.accountOpens.delete(controller);
      this.changed();
    }
  }

  /** Sign out of the account here. The link and remote access are unchanged. */
  async signOut(): Promise<void> {
    const { account } = this;

    if (account === undefined) throw unavailable();
    // A link waiting on this session would otherwise finish under the signed-out account.
    await this.cancel();
    await account.signOut();
    this.changed();
  }

  /** Tell Settings the account state changed. */
  accountChanged(): void {
    this.changed();
  }

  /**
   * After sleep the held lease says nothing about now: refuse every device and
   * close their streams until a fresh lease arrives. The relay socket is
   * likely dead too, so it dials again now.
   */
  resume(): void {
    const serving = this.serving;

    if (serving === undefined || !this.isLive(serving)) return;
    serving.lease = undefined;
    serving.lapse = undefined;
    serving.resetAt = Date.now();
    clearTimeout(serving.expiryTimer);
    serving.listener?.disconnectClients();
    serving.relay?.reconnect();
    this.changed();
    void this.beat(serving);
  }

  /**
   * Stop serving for this run. The link, devices, and toggle stay as they are.
   * Every caller waits on the same teardown: access is refused at once, the
   * link attempt and the cleanup it started settle, and the last write lands
   * before any caller hears it is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.shutDown();

    return this.closing;
  }

  private async shutDown(): Promise<void> {
    this.closed = true;
    this.denyAll();
    const attempt = this.linkAttempt;
    attempt?.controller.abort();

    for (const controller of this.accountOpens) controller.abort();
    clearTimeout(this.unlinkTimer);
    // The attempt's last word on disk lands before anything it depends on goes.
    await attempt?.done;
    this.lifetime.abort();
    await this.serial(() => this.stopServing());
    // Broker calls are aborted; acknowledgements already being written still land.
    await Promise.allSettled([this.unlinking, this.revoking]);
    await this.store.idle();
    await this.account?.close();
  }

  // -------------------------------------------------------------------------
  // Linking
  // -------------------------------------------------------------------------

  /**
   * One attempt. How it ends decides what the pending intent becomes: a
   * tombstoned key is dropped; the user's cancellation abandons an open
   * transaction at the broker; a transaction the broker ended is cleared so
   * the next attempt opens a new one on the same key; anything else, a lost
   * answer or a close, leaves the intent exactly as it is for the next attempt
   * to settle. A cancel that arrives while the link is being written is still
   * the user's answer: the link goes into the unlink queue before the attempt
   * resolves.
   */
  private async runLink(attempt: LinkAttempt): Promise<void> {
    const { authorizer } = this.options;
    const broker = this.broker;
    const { controller } = attempt;

    try {
      if (authorizer === undefined || broker === undefined) throw unavailable();

      if (authorizer.kind === "session")
        await this.linkWithSession(authorizer.account, broker, attempt);
      else await this.linkWithTransaction(authorizer, broker, attempt);

      if (attempt.cancelled && attempt.persisted !== undefined) {
        await this.queueUnlink(attempt.persisted);
        void this.retryUnlinks();
        this.setLinking({ kind: "failed", reason: "cancelled" });
      } else this.setLinking({ kind: "idle" });
    } catch (cause) {
      if (refusedCode(cause) === "revoked") {
        await this.change((file) => ({ ...file, linkKey: null })).catch(() => undefined);
      } else if (authorizer?.kind === "transaction") {
        if (attempt.cancelled) await this.abandonTransaction(broker);
        else if (cause instanceof LinkStopped) await this.clearEndedTransaction();
      }

      this.setLinking({ kind: "failed", reason: linkFailure(cause, controller.signal) });
    } finally {
      if (this.linkAttempt?.controller === controller) this.linkAttempt = undefined;
    }
  }

  /** The broker ended the transaction: its id is gone from the intent, the key stays for the next one. */
  private async clearEndedTransaction(): Promise<void> {
    await this.change((current) =>
      current.linkKey?.kind === "transaction"
        ? {
            ...current,
            linkKey: this.nextOperation(current.linkKey),
          }
        : current,
    ).catch(() => undefined);
  }

  /** A new operation on the same key, after the broker ended the last one; it carries the name the host has now. */
  private nextOperation(ended: TransactionLinkKey): TransactionLinkKey {
    return {
      ...ended,
      name: this.options.name ?? machineName(),
      transaction: null,
      abandoned: false,
      ...this.mintOperation(),
    };
  }

  /** A fresh operation id and code; the broker knows this pair only once an open is answered. */
  private mintOperation(): { readonly operationId: string; readonly userCode: string } {
    return {
      operationId: randomId(),
      userCode: randomUserCode((count) => new Uint8Array(randomBytes(count))),
    };
  }

  /** The desktop's link: one fresh session JWT, sent once with the key's proof. */
  private async linkWithSession(
    account: AccountSession,
    broker: DesktopBroker,
    attempt: LinkAttempt,
  ): Promise<void> {
    const { controller } = attempt;
    this.setLinking({ kind: "waiting_for_account" });
    const sessionToken = await account.requestSessionToken({ signal: controller.signal });

    if (controller.signal.aborted) throw new AccountCancelled();
    await this.serial(async () => {
      if (controller.signal.aborted || this.closed) throw new AccountCancelled();
      const file = await this.readyFile();

      if (file.link !== null) return;
      this.setLinking({ kind: "linking" });
      const owner = sessionSubject(sessionToken);
      const pending = file.linkKey;

      // A key the broker may already hold resumes that link instead of leaving it orphaned,
      // unless another account or another broker began it.
      const resumable =
        pending !== null &&
        pending.kind === "session" &&
        pending.origin === broker.origin &&
        (pending.owner === null || owner === null || pending.owner === owner);

      const key = resumable ? pending.key : await generateMachineKey();

      if (!resumable)
        await this.change((current) => ({
          ...current,
          linkKey: { kind: "session", origin: broker.origin, key, owner },
        }));

      const linked = await broker.link({
        key,
        name: this.options.name ?? machineName(),
        sessionToken,
        signal: controller.signal,
      });

      // An answer that lands after cancel links nothing; the kept key resumes it next time.
      if (controller.signal.aborted || this.closed) throw new AccountCancelled();
      await this.persistLink(linked, key, broker.origin, attempt);
    });
  }

  /**
   * A headless host's link: the key, operation id and code are on disk before
   * the broker hears of them, the transaction's answer lands beside them, and
   * the owner approves from a browser elsewhere while this host polls with
   * fresh proofs. A transaction left from an earlier run is asked about first:
   * one the owner already approved and this host completed is recovered, not
   * reopened.
   */
  private async linkWithTransaction(
    authorizer: Extract<LinkAuthorizer, { kind: "transaction" }>,
    broker: DesktopBroker,
    attempt: LinkAttempt,
  ): Promise<void> {
    this.setLinking({ kind: "linking" });
    const { signal } = attempt.controller;

    const prepared = await this.serial(async (): Promise<TransactionLinkKey | undefined> => {
      if (signal.aborted || this.closed) throw new AccountCancelled();
      const file = await this.readyFile();

      if (file.link !== null) return undefined;
      let pending = file.linkKey;

      if (pending !== null && pending.origin !== broker.origin) throw originChanged();

      // An exact replay may answer a transaction that already ended or was approved;
      // it is settled like any other before a new one opens. A fresh open is pending.
      for (;;) {
        let intent: TransactionLinkKey;

        if (pending === null || pending.kind !== "transaction") {
          intent = this.freshTransaction(broker.origin, await generateMachineKey());
        } else {
          const settled = await this.settleTransaction(pending, broker, signal, attempt);

          switch (settled.kind) {
            case "linked":
              return undefined;
            case "open":
              return pending;
            case "opening":
              intent = pending;
              break;
            case "ended":
              intent = this.nextOperation(pending);
              break;
            case "retired":
              intent = this.freshTransaction(broker.origin, await generateMachineKey());
              break;
            default: {
              const _exhaustive: never = settled.kind;

              return _exhaustive;
            }
          }
        }

        // The immutable open is on disk before the broker hears it; a lost answer replays this exact input.
        if (intent !== pending) await this.change((current) => ({ ...current, linkKey: intent }));
        const { kept, state } = await this.open(intent, broker, signal);

        if (state === "pending") return kept;
        pending = kept;
      }
    });

    if (prepared?.transaction === null || prepared?.transaction === undefined) return;
    const { key, userCode } = prepared;
    const { transaction } = prepared;

    const awaiting: ConnectLinking = {
      kind: "awaiting_approval",
      verifyUrl: transaction.verifyUrl,
      userCode,
      fingerprint: keyFingerprint(await keyThumbprint(publicKeyOf(key))),
      expiresAt: transaction.expiresAt,
    };
    this.setLinking(awaiting);
    authorizer.onOpened(awaiting);

    for (;;) {
      await scheduler.wait(this.timing.linkPollMs, { signal }).catch(() => {
        throw new AccountCancelled();
      });
      let state: LinkTransactionState;

      try {
        state = (await broker.pollLinkTransaction({ key, transactionId: transaction.id, signal }))
          .state;
      } catch (cause) {
        if (signal.aborted) throw new AccountCancelled();

        if (Date.now() >= transaction.expiresAt) throw new LinkStopped("expired");

        if (refusedCode(cause) !== undefined) throw cause;
        continue;
      }

      if (state === "approved" || state === "consumed") break;

      if (state !== "pending") throw new LinkStopped(state);
    }

    this.setLinking({ kind: "linking" });
    await this.serial(async () => {
      if (signal.aborted || this.closed) throw new AccountCancelled();
      const file = await this.readyFile();

      if (file.link !== null) return;

      if (file.linkKey?.kind !== "transaction" || file.linkKey.transaction?.id !== transaction.id)
        throw new AccountCancelled();
      const completion = await broker.completeLinkTransaction({
        key,
        transactionId: transaction.id,
        signal,
      });

      if (completion.state !== "consumed") throw new LinkStopped(completion.state);

      if (signal.aborted || this.closed) throw new AccountCancelled();
      await this.persistLink(completion.link, key, broker.origin, attempt);
    });
  }

  /**
   * Send the intent's open exactly as it is on disk and keep the answer beside
   * it. The broker answers an operation it already holds as it stands now.
   */
  private async open(
    intent: TransactionLinkKey,
    broker: DesktopBroker,
    signal: AbortSignal,
  ): Promise<{ readonly kept: TransactionLinkKey; readonly state: LinkTransactionState }> {
    const opened = await broker.openLinkTransaction({
      key: intent.key,
      name: intent.name,
      operationId: intent.operationId,
      userCode: intent.userCode,
      signal,
    });

    const transaction = {
      id: opened.transactionId,
      verifyUrl: opened.verifyUrl,
      expiresAt: opened.expiresAt,
    };

    const kept: TransactionLinkKey = { ...intent, transaction };
    await this.change((current) =>
      current.linkKey?.kind === "transaction" &&
      current.linkKey.operationId === intent.operationId &&
      current.linkKey.key.x === intent.key.x
        ? { ...current, linkKey: { ...kept, abandoned: current.linkKey.abandoned } }
        : current,
    );

    return { kept, state: opened.state };
  }

  /** A new intent on `key`: operation id, code and the name the broker will be told, nothing opened yet. */
  private freshTransaction(origin: string, key: PrivateJwk): TransactionLinkKey {
    return {
      kind: "transaction",
      origin,
      key,
      name: this.options.name ?? machineName(),
      ...this.mintOperation(),
      abandoned: false,
      transaction: null,
    };
  }

  /**
   * What a transaction left on disk is now. `opening`: the broker never
   * answered the open, so the same input is sent again. Consumed means an
   * earlier run completed it and lost the answer, or the owner approved while
   * this host was away: the same key gets the same link back. One this host
   * meant to cancel is cancelled now, its id first learned by replaying the
   * exact open if that answer was lost; if completion had won, its environment
   * is queued for unlinking and the key goes with it (`retired`), never
   * silently kept. `open` means keep waiting on it; `ended` means the broker
   * closed it and the key may open another.
   */
  private async settleTransaction(
    pending: TransactionLinkKey,
    broker: DesktopBroker,
    signal: AbortSignal,
    attempt: LinkAttempt | undefined,
  ): Promise<{ readonly kind: "linked" | "open" | "opening" | "ended" | "retired" }> {
    if (pending.abandoned) {
      const known =
        pending.transaction === null ? (await this.open(pending, broker, signal)).kept : pending;

      const cancelled = await this.cancelTransaction(known, broker, signal);

      return { kind: cancelled === "unlinked" ? "retired" : "ended" };
    }

    const { transaction, key } = pending;

    if (transaction === null) return { kind: "opening" };

    const status = await broker.pollLinkTransaction({ key, transactionId: transaction.id, signal });

    switch (status.state) {
      case "pending":
      case "approved":
        return { kind: "open" };
      case "consumed": {
        const completion = await broker.completeLinkTransaction({
          key,
          transactionId: transaction.id,
          signal,
        });

        if (completion.state !== "consumed") return { kind: "ended" };

        if (signal.aborted || this.closed) throw new AccountCancelled();
        await this.persistLink(completion.link, key, broker.origin, attempt);

        return { kind: "linked" };
      }
      case "denied":
      case "expired":
      case "cancelled":
        return { kind: "ended" };
      default: {
        const _exhaustive: never = status.state;

        return _exhaustive;
      }
    }
  }

  /**
   * This host gives its intent up: that is on disk first, whether or not the
   * broker ever answered the open, so a cancel the broker never hears of is
   * settled before any new link. If completion won meanwhile, the environment
   * is recovered and queued for unlinking, since the user wanted no link.
   */
  private async abandonTransaction(broker: DesktopBroker | undefined): Promise<void> {
    if (broker === undefined) return;
    const read = this.store.snapshot();
    const pending = read?.kind === "ready" ? read.file.linkKey : null;

    if (pending === null || pending?.kind !== "transaction" || pending.origin !== broker.origin)
      return;
    const abandoned: TransactionLinkKey = { ...pending, abandoned: true };

    try {
      await this.change((current) =>
        current.linkKey?.kind === "transaction" &&
        current.linkKey.operationId === pending.operationId &&
        current.linkKey.key.x === pending.key.x
          ? { ...current, linkKey: { ...current.linkKey, abandoned: true } }
          : current,
      );
      await this.settleTransaction(abandoned, broker, this.lifetime.signal, undefined);
    } catch {
      // The intent stays on disk; the next link settles it first.
    }
  }

  /**
   * Cancel at the broker. `cancelled` leaves the key free; `unlinked` means
   * completion had won, the environment it made is queued for unlinking and
   * the key is retired with it, since the broker tombstones it on removal.
   */
  private async cancelTransaction(
    pending: TransactionLinkKey,
    broker: DesktopBroker,
    signal: AbortSignal,
  ): Promise<"cancelled" | "unlinked"> {
    const { transaction, key } = pending;

    if (transaction === null) return "cancelled";
    const status = await broker.cancelLinkTransaction({
      key,
      transactionId: transaction.id,
      signal,
    });

    if (status.state === "consumed") {
      const completion = await broker.completeLinkTransaction({
        key,
        transactionId: transaction.id,
        signal,
      });

      if (completion.state === "consumed") {
        const { environment } = completion.link;
        await this.change((current) => ({
          ...current,
          linkKey: null,
          unlinks: [
            ...current.unlinks.filter((entry) => entry.environmentId !== environment.id),
            { origin: broker.origin, environmentId: environment.id, key, at: Date.now() },
          ],
        }));
        void this.retryUnlinks();

        return "unlinked";
      }
    }

    await this.change((current) =>
      current.linkKey?.kind === "transaction" && current.linkKey.transaction?.id === transaction.id
        ? { ...current, linkKey: null }
        : current,
    );

    return "cancelled";
  }

  /** The link is on disk before anyone hears of it; the pending key becomes the link's. */
  private async persistLink(
    linked: LinkResponse,
    key: PrivateJwk,
    origin: string,
    attempt: LinkAttempt | undefined,
  ): Promise<void> {
    await this.change((current) => {
      if (current.linkKey === null) throw new AccountCancelled();

      return {
        ...current,
        enabled: false,
        linkKey: null,
        link: {
          origin,
          environment: { id: linked.environment.id, name: linked.environment.name },
          owner: { id: linked.owner.id, label: linked.owner.label },
          key,
          brokerKeys: linked.brokerKeys,
          devices: [],
          revocations: [],
          consumed: [],
        },
      };
    });

    if (attempt !== undefined) attempt.persisted = linked.environment.id;
    this.forgetLink();
    this.notice = { kind: "none" };
  }

  private setLinking(linking: ConnectLinking): void {
    this.linking = linking;
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Serving
  // -------------------------------------------------------------------------

  /** Runs in the queue. Binds the share, then starts the heartbeat and the relay. */
  private async startServing(share: ConnectShare): Promise<void> {
    if (this.closed) throw closed();

    if (this.serving !== undefined) return;
    const broker = this.broker;
    const { link } = await this.readyFile();

    if (broker === undefined) throw unavailable();

    if (link === null) throw notLinked();

    if (link.origin !== broker.origin) throw originChanged();
    const url = broker.relayUrl(link.environment.id);
    const epoch = this.epoch;

    const serving: Serving = {
      epoch,
      environmentId: link.environment.id,
      controller: new AbortController(),
      port: undefined,
      listener: undefined,
      relay: undefined,
      stopping: false,
      lease: undefined,
      lapse: undefined,
      resetAt: Date.now(),
      beatTimer: undefined,
      expiryTimer: undefined,
      refreshes: new Map(),
    };

    const local = await share({
      authorize: (request) => this.authorize(serving, request),
      handle: connectRouteHandler({
        host: () => (serving.port === undefined ? undefined : `127.0.0.1:${String(serving.port)}`),
        enroll: (authorization) => this.enroll(serving, authorization),
        forget: (digest) => this.forgetPresented(serving, digest),
      }),
    });

    // Turned off, unlinked, or quitting while binding: let go without serving.
    if (epoch !== this.epoch || this.closed) {
      await local.close();

      return;
    }

    const relay = new RelayConnection({
      url,
      port: local.port,
      proof: async () => {
        const current = this.currentLink(serving.environmentId);

        if (current === undefined || !this.isLive(serving)) throw new Error("Not serving");

        return broker.relayProof({
          key: current.key,
          environmentId: serving.environmentId,
        });
      },
      dial: this.options.dial,
      onChange: () => this.changed(),
      // Only a lease answer may forget the link.
      onRevoked: () => {
        if (this.isLive(serving)) void this.beat(serving);
      },
      timing: this.timing.relay,
    });

    serving.port = local.port;
    serving.relay = relay;
    serving.listener = {
      port: local.port,
      disconnectClients: () => {
        relay.dropStreams();
        local.disconnectClients();
      },
      close: async () => {
        relay.close();
        await local.close();
      },
    };
    this.serving = serving;
    this.changed();
    void this.beat(serving);
    relay.start();
  }

  /** Runs in the queue. The relay closes before the port is released. */
  private async stopServing(): Promise<void> {
    const serving = this.serving;

    if (serving === undefined) return;
    this.serving = undefined;
    this.halt(serving);
    await serving.listener?.close();
    this.changed();
  }

  /** Refuse everyone now and end every stream; the queued stop releases the rest. */
  private denyAll(dropAfterMs = 0): void {
    this.epoch += 1;
    const serving = this.serving;

    if (serving === undefined) return;
    this.halt(serving);
    const listener = serving.listener;

    if (dropAfterMs > 0) setTimeout(() => listener?.disconnectClients(), dropAfterMs);
    else listener?.disconnectClients();
  }

  private halt(serving: Serving): void {
    serving.stopping = true;
    serving.lease = undefined;
    serving.controller.abort();
    clearTimeout(serving.beatTimer);
    clearTimeout(serving.expiryTimer);
  }

  private isLive(serving: Serving): boolean {
    return (
      this.serving === serving &&
      !serving.stopping &&
      serving.epoch === this.epoch &&
      this.store.snapshot()?.kind === "ready"
    );
  }

  private liveServing(environmentId: string): Serving | undefined {
    const serving = this.serving;

    return serving !== undefined && serving.environmentId === environmentId && this.isLive(serving)
      ? serving
      : undefined;
  }

  // -------------------------------------------------------------------------
  // Leases
  // -------------------------------------------------------------------------

  private scheduleBeat(serving: Serving, delay: number): void {
    clearTimeout(serving.beatTimer);
    serving.beatTimer = setTimeout(() => void this.beat(serving), delay);
  }

  /** Ask for a lease now. Never rejects; the next beat is scheduled when it settles. */
  private async beat(serving: Serving): Promise<"renewed" | "lapsed" | "failed"> {
    const outcome = await this.renew(serving);

    if (this.isLive(serving))
      this.scheduleBeat(
        serving,
        outcome === "failed" ? this.timing.retryMs : this.timing.heartbeatMs,
      );

    return outcome;
  }

  private async renew(serving: Serving): Promise<"renewed" | "lapsed" | "failed"> {
    const link = this.currentLink(serving.environmentId);

    if (link === undefined || this.broker === undefined) return "failed";

    try {
      const answer = await this.broker.lease({
        key: link.key,
        environmentId: serving.environmentId,
        signal: serving.controller.signal,
      });

      return (await this.applyLease(serving, link, answer)) ? "renewed" : "failed";
    } catch (cause) {
      if (!this.isLive(serving)) return "failed";
      const code = refusedCode(cause);

      if (code === "revoked") {
        void this.environmentRevoked(serving.environmentId);

        return "failed";
      }

      if (code === "owner_disabled") {
        this.lapse(serving, "owner_disabled");

        return "lapsed";
      }

      return "failed";
    }
  }

  private async applyLease(
    serving: Serving,
    link: StoredLink,
    answer: LeaseAnswer,
  ): Promise<boolean> {
    const config = this.options.config;

    const key =
      brokerKey(link.brokerKeys, answer.lease) ??
      (await this.readBrokerKeys(serving.environmentId, answer.lease));

    if (config === undefined || key === undefined) return false;
    let claims: LeaseClaims;

    try {
      claims = await verifyClaims({
        token: answer.lease,
        key,
        typ: TOKEN_TYPES.lease,
        issuer: config.origin,
        audience: serving.environmentId,
        schema: LeaseClaims,
        lifetime: LEASE_LIFETIME_SECONDS,
      });
    } catch {
      return false;
    }

    if (
      claims.sub !== link.owner.id ||
      claims.req !== answer.request ||
      !this.isLive(serving) ||
      answer.sentAt < serving.resetAt
    )
      return false;
    const high = this.highWater;

    if (
      high !== undefined &&
      high.environmentId === serving.environmentId &&
      (claims.generation < high.generation ||
        claims.policy < high.policy ||
        (claims.policy === high.policy && claims.iat < high.iat))
    )
      return false;
    const now = Date.now();
    const expiresAt = Math.min(claims.exp * 1_000, answer.sentAt + LEASE_LIFETIME_SECONDS * 1_000);

    if (expiresAt <= now) return false;
    this.highWater = {
      environmentId: serving.environmentId,
      generation: claims.generation,
      policy: claims.policy,
      iat: claims.iat,
    };

    const previous =
      serving.lease !== undefined && serving.lapse === undefined && now < serving.lease.expiresAt
        ? serving.lease
        : undefined;

    const devices = new Set(claims.devices);
    const lease: HeldLease = { devices, expiresAt, sentAt: answer.sentAt };
    serving.lease = lease;
    serving.lapse = undefined;
    clearTimeout(serving.expiryTimer);
    serving.expiryTimer = setTimeout(() => this.expire(serving, lease), expiresAt - now);
    const dropped = previous !== undefined && [...previous.devices].some((id) => !devices.has(id));

    // A stream outlives the check that opened it.
    if (dropped) serving.listener?.disconnectClients();

    if (previous === undefined || dropped || [...devices].some((id) => !previous.devices.has(id)))
      this.changed();

    this.pruneInactive(serving, lease);

    if (link.revocations.length > 0) void this.sendRevocations(false);

    return true;
  }

  /**
   * Forget recorded devices the broker no longer has active: absent from a
   * verified lease that was asked for after their enrollment grant could
   * still have been activated. Fresh and pending devices stay.
   */
  private pruneInactive(serving: Serving, lease: HeldLease): void {
    const link = this.currentLink(serving.environmentId);
    const settled = lease.sentAt - (ENROLLMENT_LIFETIME_SECONDS + CLOCK_TOLERANCE_SECONDS) * 1_000;

    const inactive = new Set(
      (link?.devices ?? [])
        .filter((device) => !lease.devices.has(device.id) && device.createdAt < settled)
        .map((device) => device.id),
    );

    if (inactive.size === 0) return;
    serving.listener?.disconnectClients();
    void this.change((file) =>
      file.link?.environment.id === serving.environmentId
        ? {
            ...file,
            link: {
              ...file.link,
              devices: file.link.devices.filter((device) => !inactive.has(device.id)),
            },
          }
        : file,
    )
      .then(() => this.changed())
      .catch(() => undefined);
  }

  private expire(serving: Serving, lease: HeldLease): void {
    if (serving.lease !== lease) return;
    serving.lease = undefined;
    serving.lapse = "offline";
    serving.listener?.disconnectClients();
    this.changed();
  }

  private lapse(serving: Serving, reason: "offline" | "owner_disabled"): void {
    const had = serving.lease !== undefined || serving.lapse !== reason;
    serving.lease = undefined;
    serving.lapse = reason;
    clearTimeout(serving.expiryTimer);
    serving.listener?.disconnectClients();

    if (had) this.changed();
  }

  private listed(serving: Serving, deviceId: string): boolean {
    const lease = serving.lease;

    return (
      this.isLive(serving) &&
      lease !== undefined &&
      serving.lapse === undefined &&
      Date.now() < lease.expiresAt &&
      lease.devices.has(deviceId)
    );
  }

  private leaseView(serving: Serving | undefined): ConnectLease {
    if (serving === undefined) return { kind: "stopped" };

    if (serving.lapse !== undefined) return { kind: "lapsed", reason: serving.lapse };
    const lease = serving.lease;

    if (lease === undefined) return { kind: "pending" };

    return Date.now() < lease.expiresAt
      ? { kind: "current", expiresAt: lease.expiresAt }
      : { kind: "lapsed", reason: "offline" };
  }

  /** A token naming a key this Mac does not hold: read the published set, at most every `keysMs`. */
  private async readBrokerKeys(
    environmentId: string,
    token: string,
  ): Promise<PublicJwk | undefined> {
    if (this.broker === undefined || Date.now() < this.keysReadAt + this.timing.keysMs)
      return undefined;
    this.keysReadAt = Date.now();
    let keys: BrokerKeys;

    try {
      keys = await this.broker.keys({ signal: this.lifetime.signal });
    } catch {
      return undefined;
    }

    const key = brokerKey(keys, token);

    if (key === undefined) return undefined;
    await this.change((file) =>
      file.link?.environment.id === environmentId
        ? { ...file, link: { ...file.link, brokerKeys: keys } }
        : file,
    ).catch(() => undefined);

    return key;
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  private async authorize(serving: Serving, request: AuthorizingRequest): Promise<DeviceDecision> {
    const token = bearerToken(request);

    if (token === undefined) return { kind: "deny", reason: "unauthorized" };
    const digest = tokenDigest(token);
    const device = this.deviceFor(serving, digest);

    if (device === undefined) return { kind: "deny", reason: "forbidden" };
    const allowed = (): DeviceDecision => ({
      kind: "allow",
      principal: `device:${device.id}`,
      device: { id: device.id, name: device.name, role: device.role },
    });

    if (this.listed(serving, device.id)) return allowed();

    if (!this.awaitsLease(serving, device)) return { kind: "deny", reason: "forbidden" };
    await this.refreshFor(serving, device);

    return this.deviceFor(serving, digest)?.id === device.id && this.listed(serving, device.id)
      ? allowed()
      : { kind: "deny", reason: "forbidden" };
  }

  /** The recorded device a token digest names, compared against every digest. */
  private deviceFor(serving: Serving, digest: Buffer): StoredDevice | undefined {
    if (!this.isLive(serving)) return undefined;
    const link = this.currentLink(serving.environmentId);

    if (link === undefined) return undefined;
    let match: StoredDevice | undefined;

    for (const device of link.devices) {
      const stored = Buffer.from(device.digest, "base64url");

      if (stored.length === digest.length && timingSafeEqual(stored, digest)) match = device;
    }

    return match === undefined || this.denied.has(match.id) ? undefined : match;
  }

  /**
   * A device the held lease does not list may have been activated at the
   * broker since: it was recorded after that lease was asked for, or so
   * recently that the broker may have activated it after answering. The
   * phone's first requests should not be refused for that.
   */
  private awaitsLease(serving: Serving, device: StoredDevice): boolean {
    const lease = serving.lease;
    const now = Date.now();

    return (
      lease !== undefined &&
      serving.lapse === undefined &&
      now < lease.expiresAt &&
      (device.createdAt >= lease.sentAt || now - device.createdAt <= READINESS_WINDOW_MS)
    );
  }

  /**
   * A lease asked for after this request arrived, so after the broker
   * activated the device if it ever will. Requests from one device share it
   * while it is out. Once a lease came back the device waits
   * `readinessThrottleMs` for another; a refresh that failed or timed out may
   * be tried again after `readinessRetryMs`, inside the phone's own retry window.
   */
  private refreshFor(serving: Serving, device: StoredDevice): Promise<void> {
    const now = Date.now();
    const previous = serving.refreshes.get(device.id);

    if (previous?.state === "pending") return previous.done;

    if (
      previous !== undefined &&
      now <
        previous.at +
          (previous.state === "renewed"
            ? this.timing.readinessThrottleMs
            : this.timing.readinessRetryMs)
    )
      return Promise.resolve();
    const refresh: Refresh = { at: now, state: "pending", done: Promise.resolve() };

    const answered = this.beat(serving).then((outcome) => {
      refresh.state = outcome === "renewed" ? "renewed" : "failed";
    });

    refresh.done = within(answered, this.timing.readinessWaitMs).then(() => {
      if (refresh.state === "pending") refresh.state = "failed";
    });
    serving.refreshes.set(device.id, refresh);

    return refresh.done;
  }

  /**
   * `POST /_nyte/connect/enroll`: a broker-signed enrollment. The device is on
   * disk before the receipt is signed, and the enrollment id is kept until it
   * expires so a replay records nothing.
   */
  private async enroll(serving: Serving, authorization: string): Promise<RouteAnswer> {
    const config = this.options.config;

    if (config === undefined || !this.isLive(serving)) return refused(403, "forbidden");
    const link = this.currentLink(serving.environmentId);

    if (link === undefined) return refused(404, "not_found");

    const key =
      brokerKey(link.brokerKeys, authorization) ??
      (await this.readBrokerKeys(serving.environmentId, authorization));

    if (key === undefined) return refused(401, "unauthorized");
    let claims: EnrollmentClaims;

    try {
      claims = await verifyClaims({
        token: authorization,
        key,
        typ: TOKEN_TYPES.enrollment,
        issuer: config.origin,
        audience: serving.environmentId,
        schema: EnrollmentClaims,
        lifetime: ENROLLMENT_LIFETIME_SECONDS,
      });
    } catch {
      return refused(401, "unauthorized");
    }

    const high = this.highWater;

    if (
      claims.sub !== link.owner.id ||
      (high?.environmentId === serving.environmentId && claims.generation < high.generation)
    )
      return refused(403, "forbidden");
    let outcome: "recorded" | "replaced" | "gone" | "conflict" | "limit";

    try {
      outcome = await this.store.update((file) => {
        const current = file.link;

        if (current === null || current.environment.id !== serving.environmentId)
          return { file, result: "gone" };
        const now = Date.now();

        const consumed = current.consumed.filter(
          (entry) => (entry.exp + CLOCK_TOLERANCE_SECONDS) * 1_000 > now,
        );

        const existing = current.devices.find((device) => device.id === claims.deviceId);

        // The broker retrying an answered enrollment gets the same receipt; nothing is recorded.
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
        // The broker revoked the earlier install of this phone.
        const kept = current.devices.filter((device) => device.clientId !== claims.clientId);

        // Every recorded device may become a queued revoke, and none of those is ever dropped.
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
      this.failClosed(true);

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
        this.dropStreams(true);
        break;
      case "recorded":
        break;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }

    this.changed();
    const iat = nowSeconds();

    const receipt: ReceiptClaims = {
      iss: serving.environmentId,
      aud: config.origin,
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
        receipt: await signClaims({
          key: link.key,
          typ: TOKEN_TYPES.receipt,
          claims: receipt,
        }),
      },
    };
  }

  /** `DELETE /_nyte/connect/device`: the presenting device, and only it. */
  private async forgetPresented(serving: Serving, digest: Buffer): Promise<RouteAnswer> {
    const device = this.deviceFor(serving, digest);

    if (device === undefined) return refused(403, "forbidden");

    try {
      await this.forgetDevice(device.id, "release");
    } catch {
      return refused(500, "internal");
    }

    return { kind: "empty" };
  }

  /**
   * Refuse the device now, end every stream, record the removal, and queue
   * the broker call. A device dropping its own token is a `release`, which
   * leaves its Clerk session signed in; its streams drop and the broker hears
   * of it only `dropDelayMs` after the removal is on disk, so the release's
   * own answer leaves first. This Mac's user removing it is a `revoke`, which
   * drops every stream at once and also replaces a release still queued for it.
   */
  private async forgetDevice(deviceId: string, kind: "release" | "revoke"): Promise<void> {
    const listener = this.serving?.listener;
    this.denied.add(deviceId);

    if (kind === "revoke") this.dropStreams(false);
    this.changed();
    let recorded = false;

    try {
      await this.recordRemoval(deviceId, kind);
      recorded = true;
    } finally {
      if (kind === "release")
        setTimeout(() => {
          listener?.disconnectClients();

          if (recorded) void this.sendRevocations(true);
        }, this.timing.dropDelayMs);
    }

    this.changed();

    if (kind === "revoke") void this.sendRevocations(true);
  }

  /** Take the device off the link and queue its broker call, durably. */
  private async recordRemoval(deviceId: string, kind: "release" | "revoke"): Promise<void> {
    const read = await this.store.read();

    if (read.kind === "failed") throw storeFailed();
    await this.change((file) => {
      const link = file.link;

      if (link === null) return file;
      const queued = link.revocations.find((entry) => entry.deviceId === deviceId);

      if (
        !link.devices.some((device) => device.id === deviceId) &&
        (queued === undefined || queued.kind === "revoke" || kind === "release")
      )
        return file;

      return {
        ...file,
        link: {
          ...link,
          devices: link.devices.filter((device) => device.id !== deviceId),
          // Moving a device into the queue never grows devices plus queue, which enrollment bounds.
          revocations: [
            ...link.revocations.filter((entry) => entry.deviceId !== deviceId),
            { deviceId, kind: queued?.kind === "revoke" ? "revoke" : kind, at: Date.now() },
          ],
        },
      };
    });
  }

  private dropStreams(defer: boolean): void {
    const listener = this.serving?.listener;

    if (listener === undefined) return;

    if (defer) setTimeout(() => listener.disconnectClients(), this.timing.dropDelayMs);
    else listener.disconnectClients();
  }

  /** Tell the broker about removed devices, one pass at a time; a request during a pass runs another. */
  private sendRevocations(now: boolean): Promise<void> {
    if (!now && Date.now() < this.revocationsSentAt + 60_000) return Promise.resolve();

    if (this.revoking !== undefined) {
      this.revokeAgain = true;

      return this.revoking;
    }

    const pass = async (): Promise<void> => {
      do {
        this.revokeAgain = false;
        await this.sendRevocationsOnce();
      } while (this.revokeAgain && !this.closed);
    };

    this.revoking = pass().finally(() => {
      this.revoking = undefined;
    });

    return this.revoking;
  }

  /** Each queued removal the broker confirms leaves the queue. */
  private async sendRevocationsOnce(): Promise<void> {
    const broker = this.broker;

    if (broker === undefined || this.closed) return;
    this.revocationsSentAt = Date.now();
    const read = this.store.snapshot();
    const stored = read?.kind === "ready" ? read.file.link : null;
    // Only this broker's link signs for this broker; another origin's queue waits for its build.
    const link = stored === null ? undefined : this.currentLink(stored.environment.id);

    if (link === undefined || link.revocations.length === 0) return;

    for (const sent of link.revocations) {
      const input = {
        key: link.key,
        environmentId: link.environment.id,
        deviceId: sent.deviceId,
        signal: this.lifetime.signal,
      };

      try {
        if (sent.kind === "revoke") await broker.revokeDevice(input);
        else await broker.releaseDevice(input);
      } catch (cause) {
        const code = refusedCode(cause);

        if (code === "revoked") {
          void this.environmentRevoked(link.environment.id);

          return;
        }

        if (code !== "not_found") return;
      }

      await this.change((file) =>
        file.link?.environment.id === link.environment.id
          ? {
              ...file,
              link: {
                ...file.link,
                // Only the entry sent: a revoke queued meanwhile still goes out.
                revocations: file.link.revocations.filter(
                  (entry) =>
                    entry.deviceId !== sent.deviceId ||
                    entry.kind !== sent.kind ||
                    entry.at !== sent.at,
                ),
              },
            }
          : file,
      ).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** The broker removed this environment: forget it and stop. Nothing is retried at the broker. */
  private environmentRevoked(environmentId: string): Promise<void> {
    if (this.serving?.environmentId === environmentId) this.denyAll();

    return this.serial(async () => {
      const read = await this.store.read();

      if (read.kind === "failed" || read.file.link?.environment.id !== environmentId) return;
      await this.stopServing();
      await this.change((file) =>
        file.link?.environment.id === environmentId
          ? { ...file, enabled: false, link: null }
          : file,
      );
      this.forgetLink();
      this.notice = { kind: "revoked" };
      this.changed();
    }).catch(() => undefined);
  }

  /** Send every pending unlink once; whatever fails is tried again later. */
  private retryUnlinks(): Promise<void> {
    this.unlinking ??= this.sendUnlinks().finally(() => {
      this.unlinking = undefined;
    });

    return this.unlinking;
  }

  private async sendUnlinks(): Promise<void> {
    const broker = this.broker;

    if (broker === undefined || this.closed) return;
    const read = await this.store.read();

    if (read.kind === "failed" || read.file.unlinks.length === 0) return;
    let remaining = 0;

    for (const pending of read.file.unlinks) {
      // Another broker's cleanup waits for a build that names that broker.
      if (pending.origin !== broker.origin) continue;
      let sent: boolean;

      try {
        await broker.removeEnvironment({
          key: pending.key,
          environmentId: pending.environmentId,
          signal: this.lifetime.signal,
        });
        sent = true;
      } catch (cause) {
        const code = refusedCode(cause);
        sent = code === "revoked" || code === "not_found";
      }

      if (!sent) {
        remaining += 1;
        continue;
      }

      await this.change((file) => ({
        ...file,
        unlinks: file.unlinks.filter((entry) => entry.environmentId !== pending.environmentId),
      })).catch(() => undefined);
    }

    clearTimeout(this.unlinkTimer);

    if (remaining > 0 && !this.closed)
      this.unlinkTimer = setTimeout(() => void this.retryUnlinks(), this.timing.unlinkRetryMs);
    this.changed();
  }

  private forgetLink(): void {
    this.highWater = undefined;
    this.denied.clear();
  }

  /**
   * The store failed: nothing is authorized again this run. `defer` lets a
   * route's own answer leave before its connection is dropped; no request is
   * authorized in between.
   */
  private failClosed(defer = false): void {
    this.denyAll(defer ? this.timing.dropDelayMs : 0);
    const stop = (): void => void this.serial(() => this.stopServing()).catch(() => undefined);

    if (defer) setTimeout(stop, this.timing.dropDelayMs);
    else stop();
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private changed(): void {
    this.options.onChange();
  }

  private unavailableReason(): ConnectUnavailable | undefined {
    return this.broker === undefined ? "not_configured" : undefined;
  }

  private async requireUsable(): Promise<void> {
    if (this.closed) throw closed();

    if (this.broker === undefined) throw unavailable();
    const read = await this.store.read();

    if (read.kind === "failed") throw storeFailed();

    if (read.file.link !== null && read.file.link.origin !== this.broker.origin)
      throw originChanged();

    if (read.file.linkKey !== null && read.file.linkKey.origin !== this.broker.origin)
      throw originChanged();
  }

  private get account(): AccountSession | undefined {
    const { authorizer } = this.options;

    return authorizer?.kind === "session" ? authorizer.account : undefined;
  }

  private async readyFile(): Promise<ConnectFile> {
    const read = await this.store.read();

    if (read.kind === "failed") throw storeFailed();

    return read.file;
  }

  private currentLink(environmentId: string): StoredLink | undefined {
    const read = this.store.snapshot();
    const link = read?.kind === "ready" ? read.file.link : null;

    return link !== null &&
      link.environment.id === environmentId &&
      link.origin === this.broker?.origin
      ? link
      : undefined;
  }

  /** Persist a change; a store that cannot be written refuses everything from then on. */
  private async change(change: (file: ConnectFile) => ConnectFile): Promise<void> {
    try {
      await this.store.update((file) => ({ file: change(file), result: undefined }));
    } catch (cause) {
      if (!(cause instanceof ConnectStoreFailed)) throw cause;
      this.failClosed();
      throw storeFailed();
    }
  }
}
