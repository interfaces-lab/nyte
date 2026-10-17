import { randomBytes } from "node:crypto";
import { scheduler } from "node:timers/promises";
import { keyFingerprint, randomUserCode } from "../index.ts";
import type { LinkResponse, LinkTransactionState } from "../index.ts";
import { generateMachineKey, keyThumbprint, toPublicJwk, randomId } from "../signing.ts";
import type { PrivateJwk } from "../signing.ts";
import type { ConnectLinking } from "../view.ts";
import { AccountCancelled } from "./account.ts";
import type { AccountSession } from "./account.ts";
import type { DesktopBroker } from "./broker.ts";
import { originChanged, unavailable } from "./errors.ts";
import { machineName } from "./machine-name.ts";
import type { ConnectOutbox } from "./outbox.ts";
import { UNLINK_LIMIT } from "./store.ts";
import type { ConnectStore, LinkKey } from "./store.ts";
import { LinkStopped, linkFailure, refusedCode, sessionSubject } from "./tokens.ts";

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

interface LinkFlowOptions {
  readonly store: ConnectStore;
  readonly broker: DesktopBroker | undefined;
  readonly authorizer: LinkAuthorizer | undefined;
  /** This host's name at the broker; defaults to the machine's. */
  readonly name: string | undefined;
  readonly linkPollMs: number;
  /** Ends with the runtime. */
  readonly signal: AbortSignal;
  readonly closed: () => boolean;
  /** Run after every earlier change to the link or serving state. */
  readonly serial: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly changed: () => void;
  readonly outbox: ConnectOutbox;
  /** Unlink `environmentId` as the user would, if it is still the link. */
  readonly unlink: (environmentId: string) => Promise<void>;
  /** A new link landed: forget what the last one taught. */
  readonly linked: () => void;
}

type TransactionLinkKey = Extract<LinkKey, { kind: "transaction" }>;

interface LinkAttempt {
  readonly controller: AbortController;
  done: Promise<void>;
  cancelled: boolean;
  persisted: string | undefined;
}

/**
 * One link attempt at a time, by session JWT or by broker transaction. The
 * machine key and the transaction are written down before each broker call,
 * so a crash or a cancel resumes or retires the same operation instead of
 * leaving an orphan environment at the broker.
 */
export class LinkFlow {
  private readonly options: LinkFlowOptions;
  private linking: ConnectLinking = { kind: "idle" };
  private attempt: LinkAttempt | undefined;

  constructor(options: LinkFlowOptions) {
    this.options = options;
  }

  /** Where the current or last attempt stands. */
  get state(): ConnectLinking {
    return this.linking;
  }

  /** Whether an attempt is running. */
  get running(): boolean {
    return this.attempt !== undefined;
  }

  /** Run one attempt, or wait for the running one. The outcome is in `state`, not thrown. */
  async link(): Promise<void> {
    const pending = this.attempt;

    if (pending !== undefined) {
      await pending.done;

      return;
    }

    const { store, outbox } = this.options;

    if ((await store.ready()).unlinks.length >= UNLINK_LIMIT) await outbox.retryUnlinks();

    if ((await store.ready()).unlinks.length >= UNLINK_LIMIT) {
      this.setLinking({ kind: "failed", reason: "refused" });

      return;
    }

    const attempt: LinkAttempt = {
      controller: new AbortController(),
      done: Promise.resolve(),
      cancelled: false,
      persisted: undefined,
    };

    this.attempt = attempt;
    attempt.done = this.run(attempt);
    await attempt.done;
  }

  /** The user gives the link up: the attempt ends and an open transaction is cancelled at the broker. */
  async cancel(): Promise<void> {
    const pending = this.attempt;

    if (pending === undefined) return;
    pending.cancelled = true;
    pending.controller.abort();
    await pending.done;
  }

  /** End the attempt for shutdown; settles once it has. */
  abort(): Promise<void> {
    const pending = this.attempt;
    pending?.controller.abort();

    return pending?.done ?? Promise.resolve();
  }

  private async run(attempt: LinkAttempt): Promise<void> {
    const { authorizer, broker } = this.options;
    const { controller } = attempt;

    try {
      if (authorizer === undefined || broker === undefined) throw unavailable();

      if (authorizer.kind === "session")
        await this.linkWithSession(authorizer.account, broker, attempt);
      else await this.linkWithTransaction(authorizer, broker, attempt);

      if (attempt.cancelled && attempt.persisted !== undefined) {
        await this.options.unlink(attempt.persisted);
        void this.options.outbox.retryUnlinks();
        this.setLinking({ kind: "failed", reason: "cancelled" });
      } else this.setLinking({ kind: "idle" });
    } catch (cause) {
      if (refusedCode(cause) === "revoked") {
        await this.options.store
          .change((file) => ({ ...file, linkKey: null }))
          .catch(() => undefined);
      } else if (authorizer?.kind === "transaction") {
        if (attempt.cancelled) await this.abandonTransaction(broker);
        else if (cause instanceof LinkStopped) await this.clearEndedTransaction();
      }

      this.setLinking({ kind: "failed", reason: linkFailure(cause, controller.signal) });
    } finally {
      if (this.attempt?.controller === controller) this.attempt = undefined;
    }
  }

  private stopped(signal: AbortSignal): boolean {
    return signal.aborted || this.options.closed();
  }

  private name(): string {
    return this.options.name ?? machineName();
  }

  private async clearEndedTransaction(): Promise<void> {
    await this.options.store
      .change((current) =>
        current.linkKey?.kind === "transaction"
          ? { ...current, linkKey: this.nextOperation(current.linkKey) }
          : current,
      )
      .catch(() => undefined);
  }

  private nextOperation(ended: TransactionLinkKey): TransactionLinkKey {
    return {
      ...ended,
      name: this.name(),
      transaction: null,
      abandoned: false,
      ...mintOperation(),
    };
  }

  private freshTransaction(origin: string, key: PrivateJwk): TransactionLinkKey {
    return {
      kind: "transaction",
      origin,
      key,
      name: this.name(),
      ...mintOperation(),
      abandoned: false,
      transaction: null,
    };
  }

  private async linkWithSession(
    account: AccountSession,
    broker: DesktopBroker,
    attempt: LinkAttempt,
  ): Promise<void> {
    const { controller } = attempt;
    const { store } = this.options;
    this.setLinking({ kind: "waiting_for_account" });
    const sessionToken = await account.requestSessionToken({ signal: controller.signal });

    if (controller.signal.aborted) throw new AccountCancelled();
    await this.options.serial(async () => {
      if (this.stopped(controller.signal)) throw new AccountCancelled();
      const file = await store.ready();

      if (file.link !== null) return;
      this.setLinking({ kind: "linking" });
      const owner = sessionSubject(sessionToken);
      const pending = file.linkKey;

      const resumable =
        pending !== null &&
        pending.kind === "session" &&
        pending.origin === broker.origin &&
        (pending.owner === null || owner === null || pending.owner === owner);

      const key = resumable ? pending.key : await generateMachineKey();

      if (!resumable)
        await store.change((current) => ({
          ...current,
          linkKey: { kind: "session", origin: broker.origin, key, owner },
        }));

      const linked = await broker.link({
        key,
        name: this.name(),
        sessionToken,
        signal: controller.signal,
      });

      if (this.stopped(controller.signal)) throw new AccountCancelled();
      await this.persistLink(linked, key, broker.origin, attempt);
    });
  }

  private async linkWithTransaction(
    authorizer: Extract<LinkAuthorizer, { kind: "transaction" }>,
    broker: DesktopBroker,
    attempt: LinkAttempt,
  ): Promise<void> {
    this.setLinking({ kind: "linking" });
    const { signal } = attempt.controller;
    const { store } = this.options;

    const prepared = await this.options.serial(
      async (): Promise<TransactionLinkKey | undefined> => {
        if (this.stopped(signal)) throw new AccountCancelled();
        const file = await store.ready();

        if (file.link !== null) return undefined;
        let pending = file.linkKey;

        if (pending !== null && pending.origin !== broker.origin) throw originChanged();

        for (;;) {
          let intent: TransactionLinkKey;

          if (pending === null || pending.kind !== "transaction") {
            intent = this.freshTransaction(broker.origin, await generateMachineKey());
          } else {
            const settled = await this.settleTransaction(pending, broker, signal, attempt);

            switch (settled) {
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
                const _exhaustive: never = settled;

                return _exhaustive;
              }
            }
          }

          if (intent !== pending)
            await store.change((current) => ({ ...current, linkKey: intent }));
          const { kept, state } = await this.open(intent, broker, signal);

          if (state === "pending") return kept;
          pending = kept;
        }
      },
    );

    if (prepared?.transaction === null || prepared?.transaction === undefined) return;
    const { key, userCode, transaction } = prepared;

    const awaiting: ConnectLinking = {
      kind: "awaiting_approval",
      verifyUrl: transaction.verifyUrl,
      userCode,
      fingerprint: keyFingerprint(await keyThumbprint(toPublicJwk(key))),
      expiresAt: transaction.expiresAt,
    };

    this.setLinking(awaiting);
    authorizer.onOpened(awaiting);

    for (;;) {
      await scheduler.wait(this.options.linkPollMs, { signal }).catch(() => {
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
    await this.options.serial(async () => {
      if (this.stopped(signal)) throw new AccountCancelled();
      const file = await store.ready();

      if (file.link !== null) return;

      if (file.linkKey?.kind !== "transaction" || file.linkKey.transaction?.id !== transaction.id)
        throw new AccountCancelled();

      const completion = await broker.completeLinkTransaction({
        key,
        transactionId: transaction.id,
        signal,
      });

      if (completion.state !== "consumed") throw new LinkStopped(completion.state);

      if (this.stopped(signal)) throw new AccountCancelled();
      await this.persistLink(completion.link, key, broker.origin, attempt);
    });
  }

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
    await this.options.store.change((current) =>
      sameOperation(current.linkKey, intent)
        ? { ...current, linkKey: { ...kept, abandoned: current.linkKey.abandoned } }
        : current,
    );

    return { kept, state: opened.state };
  }

  private async settleTransaction(
    pending: TransactionLinkKey,
    broker: DesktopBroker,
    signal: AbortSignal,
    attempt: LinkAttempt | undefined,
  ): Promise<"linked" | "open" | "opening" | "ended" | "retired"> {
    if (pending.abandoned) {
      const known =
        pending.transaction === null ? (await this.open(pending, broker, signal)).kept : pending;

      const cancelled = await this.cancelTransaction(known, broker, signal);

      return cancelled === "unlinked" ? "retired" : "ended";
    }

    const { transaction, key } = pending;

    if (transaction === null) return "opening";

    const status = await broker.pollLinkTransaction({ key, transactionId: transaction.id, signal });

    switch (status.state) {
      case "pending":
      case "approved":
        return "open";
      case "consumed": {
        const completion = await broker.completeLinkTransaction({
          key,
          transactionId: transaction.id,
          signal,
        });

        if (completion.state !== "consumed") return "ended";

        if (this.stopped(signal)) throw new AccountCancelled();
        await this.persistLink(completion.link, key, broker.origin, attempt);

        return "linked";
      }

      case "denied":
      case "expired":
      case "cancelled":
        return "ended";
      default: {
        const _exhaustive: never = status.state;

        return _exhaustive;
      }
    }
  }

  private async abandonTransaction(broker: DesktopBroker | undefined): Promise<void> {
    if (broker === undefined) return;
    const pending = this.options.store.loadedFile()?.linkKey ?? null;

    if (pending === null || pending.kind !== "transaction" || pending.origin !== broker.origin)
      return;
    const abandoned: TransactionLinkKey = { ...pending, abandoned: true };

    try {
      await this.options.store.change((current) =>
        sameOperation(current.linkKey, pending)
          ? { ...current, linkKey: { ...current.linkKey, abandoned: true } }
          : current,
      );
      await this.settleTransaction(abandoned, broker, this.options.signal, undefined);
    } catch {}
  }

  private async cancelTransaction(
    pending: TransactionLinkKey,
    broker: DesktopBroker,
    signal: AbortSignal,
  ): Promise<"cancelled" | "unlinked"> {
    const { transaction, key } = pending;
    const { store } = this.options;

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
        await store.change((current) => ({
          ...current,
          linkKey: null,
          unlinks: [
            ...current.unlinks.filter((entry) => entry.environmentId !== environment.id),
            { origin: broker.origin, environmentId: environment.id, key, at: Date.now() },
          ],
        }));
        void this.options.outbox.retryUnlinks();

        return "unlinked";
      }
    }

    await store.change((current) =>
      current.linkKey?.kind === "transaction" && current.linkKey.transaction?.id === transaction.id
        ? { ...current, linkKey: null }
        : current,
    );

    return "cancelled";
  }

  private async persistLink(
    linked: LinkResponse,
    key: PrivateJwk,
    origin: string,
    attempt: LinkAttempt | undefined,
  ): Promise<void> {
    await this.options.store.change((current) => {
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
    this.options.linked();
  }

  private setLinking(linking: ConnectLinking): void {
    this.linking = linking;
    this.options.changed();
  }
}

function mintOperation() {
  return {
    operationId: randomId(),
    userCode: randomUserCode((count) => new Uint8Array(randomBytes(count))),
  };
}

/** Whether the stored link key is still the transaction operation `intent` names. */
function sameOperation(
  stored: LinkKey | null,
  intent: TransactionLinkKey,
): stored is TransactionLinkKey {
  return (
    stored?.kind === "transaction" &&
    stored.operationId === intent.operationId &&
    stored.key.x === intent.key.x
  );
}
