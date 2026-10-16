import { HEARTBEAT_INTERVAL_SECONDS, LINK_POLL_INTERVAL_SECONDS } from "../index.ts";
import { storeFailed } from "./errors.ts";
import type { RelayTiming } from "./relay.ts";
import { ConnectStoreFailed } from "./store.ts";
import type { ConnectFile, ConnectRead, ConnectStore, StoredLink } from "./store.ts";

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

export const DEFAULT_TIMING: ConnectTiming = {
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

/**
 * The Connect state file as every part of the runtime reads and changes it. A
 * write that fails takes remote access down through `onFailed` before the
 * caller hears `storeFailed`.
 */
export class ConnectFiles {
  readonly store: ConnectStore;
  /** The broker this build talks to; a link through any other is not current. */
  private readonly origin: string | undefined;
  private readonly onFailed: () => void;

  constructor(store: ConnectStore, origin: string | undefined, onFailed: () => void) {
    this.store = store;
    this.origin = origin;
    this.onFailed = onFailed;
  }

  read(): Promise<ConnectRead> {
    return this.store.read();
  }

  /** The file, or `storeFailed` when it cannot be used. */
  async ready(): Promise<ConnectFile> {
    const read = await this.store.read();

    if (read.kind === "failed") throw storeFailed();

    return read.file;
  }

  /** The file as the last read or write left it, without waiting; undefined before the first read or after a failure. */
  loaded(): ConnectFile | undefined {
    const read = this.store.snapshot();

    return read?.kind === "ready" ? read.file : undefined;
  }

  /** The stored link when it is the one for `environmentId` through this build's broker. */
  currentLink(environmentId: string): StoredLink | undefined {
    const link = this.loaded()?.link ?? null;

    return link !== null && link.environment.id === environmentId && link.origin === this.origin
      ? link
      : undefined;
  }

  async change(change: (file: ConnectFile) => ConnectFile): Promise<void> {
    try {
      await this.store.update((file) => ({ file: change(file), result: undefined }));
    } catch (cause) {
      if (!(cause instanceof ConnectStoreFailed)) throw cause;
      this.onFailed();
      throw storeFailed();
    }
  }
}
