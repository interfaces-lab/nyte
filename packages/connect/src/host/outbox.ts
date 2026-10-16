import type { DesktopBroker } from "./broker.ts";
import type { ConnectFiles } from "./context.ts";
import { refusedCode } from "./tokens.ts";

/** Least time between two passes over the revocations a lease reminds this host of. */
const REVOCATION_REMINDER_MS = 60_000;

export interface ConnectOutboxOptions {
  readonly files: ConnectFiles;
  readonly broker: DesktopBroker | undefined;
  readonly unlinkRetryMs: number;
  /** Ends with the runtime. */
  readonly signal: AbortSignal;
  readonly closed: () => boolean;
  readonly changed: () => void;
  /** The broker answered `revoked` for the linked environment. */
  readonly environmentRevoked: (environmentId: string) => void;
}

/**
 * What this host owes the broker after deciding it locally: device releases
 * and revocations of the current link, and the removal of environments it
 * unlinked. Each stays in the file until the broker confirms it, and is sent
 * again on a later pass or run.
 */
export class ConnectOutbox {
  private readonly options: ConnectOutboxOptions;
  private revocationsSentAt = Number.NEGATIVE_INFINITY;
  private revoking: Promise<void> | undefined;
  private revokeAgain = false;
  private unlinking: Promise<void> | undefined;
  private unlinkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ConnectOutboxOptions) {
    this.options = options;
  }

  /**
   * Send the link's queued releases and revocations. `now` sends at once,
   * joining a pass in flight with one more; otherwise it is a reminder that
   * waits a minute after the last pass.
   */
  sendRevocations(now: boolean): Promise<void> {
    if (!now && Date.now() < this.revocationsSentAt + REVOCATION_REMINDER_MS)
      return Promise.resolve();

    if (this.revoking !== undefined) {
      this.revokeAgain = true;

      return this.revoking;
    }

    const pass = async (): Promise<void> => {
      do {
        this.revokeAgain = false;
        await this.sendRevocationsOnce();
      } while (this.revokeAgain && !this.options.closed());
    };

    this.revoking = pass().finally(() => {
      this.revoking = undefined;
    });

    return this.revoking;
  }

  /** Remove every unlinked environment the broker has not confirmed, retrying later while any is left. */
  retryUnlinks(): Promise<void> {
    this.unlinking ??= this.sendUnlinks().finally(() => {
      this.unlinking = undefined;
    });

    return this.unlinking;
  }

  /** Stop retrying and settle the sends in flight. */
  async close(): Promise<void> {
    clearTimeout(this.unlinkTimer);
    await Promise.allSettled([this.unlinking, this.revoking]);
  }

  private async sendRevocationsOnce(): Promise<void> {
    const { broker, files } = this.options;

    if (broker === undefined || this.options.closed()) return;
    this.revocationsSentAt = Date.now();
    const stored = files.loaded()?.link ?? null;
    const link = stored === null ? undefined : files.currentLink(stored.environment.id);

    if (link === undefined || link.revocations.length === 0) return;

    for (const sent of link.revocations) {
      const input = {
        key: link.key,
        environmentId: link.environment.id,
        deviceId: sent.deviceId,
        signal: this.options.signal,
      };

      try {
        if (sent.kind === "revoke") await broker.revokeDevice(input);
        else await broker.releaseDevice(input);
      } catch (cause) {
        const code = refusedCode(cause);

        if (code === "revoked") {
          this.options.environmentRevoked(link.environment.id);

          return;
        }

        if (code !== "not_found") return;
      }

      await files
        .change((file) =>
          file.link?.environment.id === link.environment.id
            ? {
                ...file,
                link: {
                  ...file.link,
                  revocations: file.link.revocations.filter(
                    (entry) =>
                      entry.deviceId !== sent.deviceId ||
                      entry.kind !== sent.kind ||
                      entry.at !== sent.at,
                  ),
                },
              }
            : file,
        )
        .catch(() => undefined);
    }
  }

  private async sendUnlinks(): Promise<void> {
    const { broker, files } = this.options;

    if (broker === undefined || this.options.closed()) return;
    const read = await files.read();

    if (read.kind === "failed" || read.file.unlinks.length === 0) return;
    let remaining = 0;

    for (const pending of read.file.unlinks) {
      if (pending.origin !== broker.origin) continue;
      let sent: boolean;

      try {
        await broker.removeEnvironment({
          key: pending.key,
          environmentId: pending.environmentId,
          signal: this.options.signal,
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

      await files
        .change((file) => ({
          ...file,
          unlinks: file.unlinks.filter((entry) => entry.environmentId !== pending.environmentId),
        }))
        .catch(() => undefined);
    }

    clearTimeout(this.unlinkTimer);

    if (remaining > 0 && !this.options.closed())
      this.unlinkTimer = setTimeout(() => void this.retryUnlinks(), this.options.unlinkRetryMs);
    this.options.changed();
  }
}
