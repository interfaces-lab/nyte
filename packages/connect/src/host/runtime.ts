import { join } from "node:path";
import { serial } from "@nyte-ai/schema/serial";
import type { ConnectNotice, ConnectUnavailable, ConnectView } from "../view.ts";
import { AccountCancelled } from "./account.ts";
import type { AccountSession } from "./account.ts";
import { DesktopBroker } from "./broker.ts";
import type { BrokerFetch } from "./broker.ts";
import { DEFAULT_TIMING } from "./context.ts";
import type { ConnectTiming } from "./context.ts";
import { closed, notLinked, originChanged, unavailable } from "./errors.ts";
import { LinkFlow } from "./link-flow.ts";
import type { LinkAuthorizer } from "./link-flow.ts";
import { ConnectOutbox } from "./outbox.ts";
import type { RelayDial } from "./relay.ts";
import { ServingSession } from "./serving.ts";
import type { ConnectShare, ServingOwner } from "./serving.ts";
import { ConnectStore } from "./store.ts";
import { BrokerKeyring, LinkTrust } from "./tokens.ts";

export interface HostConnectConfig {
  readonly origin: string;
}

interface ConnectRuntimeOptions {
  readonly config: HostConnectConfig | undefined;
  readonly home: string;
  readonly storePath?: string;
  readonly authorizer: LinkAuthorizer | undefined;
  readonly onChange: () => void;
  readonly name?: string;
  readonly fetch?: BrokerFetch;
  readonly dial?: RelayDial;
  readonly timing?: Partial<ConnectTiming>;
}

export class ConnectRuntime {
  private readonly options: ConnectRuntimeOptions;
  private readonly timing: ConnectTiming;
  private readonly store: ConnectStore;
  private readonly broker: DesktopBroker | undefined;
  private readonly keyring: BrokerKeyring | undefined;
  private readonly lifetime = new AbortController();
  private readonly trust = new LinkTrust();
  private readonly outbox: ConnectOutbox;
  private readonly links: LinkFlow;
  private readonly servingOwner: ServingOwner;
  private readonly operations = serial();
  private epoch = 0;
  private serving: ServingSession | undefined;
  private readonly accountOpens = new Set<AbortController>();
  private notice: ConnectNotice = { kind: "none" };
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(options: ConnectRuntimeOptions) {
    this.options = options;
    this.timing = { ...DEFAULT_TIMING, ...options.timing };

    const broker =
      options.config === undefined
        ? undefined
        : new DesktopBroker({ origin: options.config.origin, fetch: options.fetch });

    this.broker = broker;

    this.store = new ConnectStore(options.storePath ?? join(options.home, "connect.json"), {
      origin: broker?.origin,
      onFailed: () => this.failClosed(),
    });

    this.keyring =
      broker === undefined
        ? undefined
        : new BrokerKeyring(broker, this.store, this.timing.keysMs, this.lifetime.signal);

    this.outbox = new ConnectOutbox({
      store: this.store,
      broker,
      unlinkRetryMs: this.timing.unlinkRetryMs,
      signal: this.lifetime.signal,
      closed: () => this.closed,
      changed: () => this.changed(),
      environmentRevoked: (environmentId) => void this.environmentRevoked(environmentId),
    });

    this.links = new LinkFlow({
      store: this.store,
      broker,
      authorizer: options.authorizer,
      name: options.name,
      linkPollMs: this.timing.linkPollMs,
      signal: this.lifetime.signal,
      closed: () => this.closed,
      serial: (operation) => this.operations.run(operation),
      changed: () => this.changed(),
      outbox: this.outbox,
      unlink: (environmentId) => this.queueUnlink(environmentId),
      linked: () => this.forgetLink(),
    });

    this.servingOwner = {
      current: (session) => this.current(session),
      changed: () => this.changed(),
      environmentRevoked: (environmentId) => void this.environmentRevoked(environmentId),
      dropStreams: (defer) => this.dropStreams(defer),
      failClosed: () => this.failClosed(true),
      release: (deviceId) => this.forgetDevice(deviceId, "release"),
    };
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
        linking: this.links.state,
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
      connection: serving === undefined ? { kind: "stopped" } : serving.connection(),
      lease: serving === undefined ? { kind: "stopped" } : serving.leaseView(),
      devices: link.devices
        .filter((device) => !this.trust.denied.has(device.id))
        .map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          authorized: serving !== undefined && serving.listed(device.id),
        })),
    };
  }

  async link(): Promise<ConnectView> {
    await this.requireUsable();

    if (this.options.authorizer === undefined) throw unavailable();
    await this.links.link();

    return this.view();
  }

  cancel(): Promise<void> {
    return this.links.cancel();
  }

  async setEnabled(input: {
    readonly enabled: boolean;
    readonly share: ConnectShare | null;
  }): Promise<ConnectView> {
    await this.requireUsable();

    if (!input.enabled) {
      this.denyAll();
      await this.operations.run(async () => {
        await this.stopServing();
        await this.store.change((file) => (file.enabled ? { ...file, enabled: false } : file));
      });
    } else {
      await this.operations.run(async () => {
        if (this.closed) throw closed();

        const file = await this.store.ready();

        if (file.link === null) throw notLinked();
        await this.store.change((current) =>
          current.enabled ? current : { ...current, enabled: true },
        );

        try {
          if (input.share !== null) await this.startServing(input.share);
        } catch (cause) {
          await this.store
            .change((current) => ({ ...current, enabled: false }))
            .catch(() => undefined);
          throw cause;
        }
      });
    }

    this.changed();

    return this.view();
  }

  async serve(share: ConnectShare): Promise<ConnectView> {
    await this.requireUsable();
    await this.operations.run(async () => {
      if (this.closed) throw closed();
      await this.startServing(share);
    });
    this.changed();

    return this.view();
  }

  async stop(): Promise<ConnectView> {
    this.denyAll();
    await this.operations.run(() => this.stopServing());
    this.changed();

    return this.view();
  }

  retryUnlinks(): Promise<void> {
    return this.outbox.retryUnlinks();
  }

  async autostart(share: ConnectShare): Promise<void> {
    void this.outbox.retryUnlinks();

    if (this.unavailableReason() !== undefined) return;
    await this.operations.run(async () => {
      const read = await this.store.read();

      if (read.kind === "failed" || !read.file.enabled || read.file.link === null) return;

      await this.startServing(share).catch(() => undefined);
    });
    this.changed();
  }

  async unlink(): Promise<void> {
    await this.cancel();
    await this.queueUnlink(undefined);
    this.changed();
    await this.outbox.retryUnlinks();
  }

  async revokeDevice(input: { readonly deviceId: string }): Promise<void> {
    await this.requireUsable();
    await this.forgetDevice(input.deviceId, "revoke");
  }

  async openAccount(): Promise<void> {
    const { account } = this;

    if (account === undefined) throw unavailable();

    if (this.links.running || this.accountOpens.size > 0) {
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

  async signOut(): Promise<void> {
    const { account } = this;

    if (account === undefined) throw unavailable();
    await this.cancel();
    await account.signOut();
    this.changed();
  }

  accountChanged(): void {
    this.changed();
  }

  resume(): void {
    const serving = this.serving;

    if (serving === undefined || !this.current(serving)) return;
    serving.resume();
  }

  close(): Promise<void> {
    this.closing ??= this.shutDown();

    return this.closing;
  }

  private async shutDown(): Promise<void> {
    this.closed = true;
    this.denyAll();
    const linking = this.links.abort();

    for (const controller of this.accountOpens) controller.abort();
    await linking;
    this.lifetime.abort();
    await this.operations.run(() => this.stopServing());
    await this.outbox.close();
    await this.store.idle();
    await this.account?.close();
  }

  private async queueUnlink(expected: string | undefined): Promise<void> {
    this.denyAll();
    await this.operations.run(async () => {
      const file = await this.store.ready();
      const { link } = file;

      if (link === null || (expected !== undefined && link.environment.id !== expected)) return;
      await this.stopServing();
      await this.store.change((current) =>
        current.link === null
          ? current
          : {
              ...current,
              enabled: false,
              link: null,
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
    });
  }

  private async startServing(share: ConnectShare): Promise<void> {
    if (this.closed) throw closed();

    if (this.serving !== undefined) return;
    const { broker, keyring } = this;
    const { link } = await this.store.ready();

    if (broker === undefined || keyring === undefined) throw unavailable();

    if (link === null) throw notLinked();

    if (link.origin !== broker.origin) throw originChanged();
    const { epoch } = this;

    const session = new ServingSession({
      epoch,
      environmentId: link.environment.id,
      store: this.store,
      broker,
      keyring,
      trust: this.trust,
      outbox: this.outbox,
      timing: this.timing,
      owner: this.servingOwner,
    });

    const local = await share(session.listen());

    if (epoch !== this.epoch || this.closed) {
      await local.close();

      return;
    }

    session.attach(local, broker.relayUrl(link.environment.id), this.options.dial);
    this.serving = session;
    this.changed();
    session.start();
  }

  private async stopServing(): Promise<void> {
    const serving = this.serving;

    if (serving === undefined) return;
    this.serving = undefined;
    serving.halt();
    await serving.close();
    this.changed();
  }

  private denyAll(dropAfterMs = 0): void {
    this.epoch += 1;
    const serving = this.serving;

    if (serving === undefined) return;
    serving.halt();

    if (dropAfterMs > 0) setTimeout(() => serving.disconnectClients(), dropAfterMs);
    else serving.disconnectClients();
  }

  private current(serving: ServingSession): boolean {
    return (
      this.serving === serving &&
      !serving.halted &&
      serving.epoch === this.epoch &&
      this.store.loadedFile() !== undefined
    );
  }

  private liveServing(environmentId: string): ServingSession | undefined {
    const serving = this.serving;

    return serving !== undefined && serving.environmentId === environmentId && this.current(serving)
      ? serving
      : undefined;
  }

  private async forgetDevice(deviceId: string, kind: "release" | "revoke"): Promise<void> {
    const serving = this.serving;
    this.trust.denied.add(deviceId);

    if (kind === "revoke") this.dropStreams(false);
    this.changed();
    let recorded = false;

    try {
      await this.recordRemoval(deviceId, kind);
      recorded = true;
    } finally {
      if (kind === "release")
        setTimeout(() => {
          serving?.disconnectClients();

          if (recorded) void this.outbox.sendRevocations(true);
        }, this.timing.dropDelayMs);
    }

    this.changed();

    if (kind === "revoke") void this.outbox.sendRevocations(true);
  }

  private async recordRemoval(deviceId: string, kind: "release" | "revoke"): Promise<void> {
    await this.store.ready();
    await this.store.change((file) => {
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
          revocations: [
            ...link.revocations.filter((entry) => entry.deviceId !== deviceId),
            { deviceId, kind: queued?.kind === "revoke" ? "revoke" : kind, at: Date.now() },
          ],
        },
      };
    });
  }

  private dropStreams(defer: boolean): void {
    const serving = this.serving;

    if (serving === undefined) return;

    if (defer) setTimeout(() => serving.disconnectClients(), this.timing.dropDelayMs);
    else serving.disconnectClients();
  }

  private environmentRevoked(environmentId: string): Promise<void> {
    if (this.serving?.environmentId === environmentId) this.denyAll();

    return this.operations
      .run(async () => {
        const read = await this.store.read();

        if (read.kind === "failed" || read.file.link?.environment.id !== environmentId) return;
        await this.stopServing();
        await this.store.change((file) =>
          file.link?.environment.id === environmentId
            ? { ...file, enabled: false, link: null }
            : file,
        );
        this.forgetLink();
        this.notice = { kind: "revoked" };
        this.changed();
      })
      .catch(() => undefined);
  }

  private forgetLink(): void {
    this.trust.forget();
    this.notice = { kind: "none" };
  }

  private failClosed(defer = false): void {
    this.denyAll(defer ? this.timing.dropDelayMs : 0);

    const stop = (): void =>
      void this.operations.run(() => this.stopServing()).catch(() => undefined);

    if (defer) setTimeout(stop, this.timing.dropDelayMs);
    else stop();
    this.changed();
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
    const file = await this.store.ready();

    if (file.link !== null && file.link.origin !== this.broker.origin) throw originChanged();

    if (file.linkKey !== null && file.linkKey.origin !== this.broker.origin) throw originChanged();
  }

  private get account(): AccountSession | undefined {
    const { authorizer } = this.options;

    return authorizer?.kind === "session" ? authorizer.account : undefined;
  }
}
