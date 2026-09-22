/**
 * The Usage page's reads, off the main process.
 *
 * Three histories feed the page: Nyte's own session stores, Claude Code's
 * transcripts, and Codex's rollouts. All three are seconds of CPU cold, and
 * the main process brokers every renderer call, so the app runs the scan on a
 * worker thread and stays responsive while it works. The scanner itself is
 * plain code, so tests and the worker run the same read.
 *
 * Names are the one thing the scan does not return: the host reads them
 * through the SDK, which owns how a session's facts are stored.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Models } from "@nyte-ai/ai";
import { sessionId, type SessionId } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import {
  createUsageScanCaches,
  decodeUsageScanCaches,
  encodeUsageScanCaches,
  readLocalUsage,
  type LocalUsage,
  type UsageScanCaches,
} from "@nyte-ai/host/usage";
import type { Api, Model } from "@nyte-ai/schema";
import { usageCommit, type UsageCommit } from "./usage.ts";

/** A Nyte store to read: the folder it belongs to and where its database is. */
export interface StoreLocation {
  readonly workspacePath: string | null;
  readonly path: string;
}

/** One store's spend per session, or why it could not be read. */
interface StoreScan {
  readonly workspacePath: string | null;
  readonly sessions: readonly {
    readonly sessionId: SessionId;
    readonly commits: readonly UsageCommit[];
  }[];
  readonly failure: string | null;
}

/** The catalog rows the readers price against; plain data, so they cross a thread. */
type CatalogModels = readonly Model<Api>[];

export function catalogForUsage(models: Pick<Models, "getModels">): CatalogModels {
  return [...models.getModels("anthropic"), ...models.getModels("openai-codex")];
}

interface UsageScanRequest {
  readonly stores: readonly StoreLocation[];
  readonly catalog: CatalogModels;
}

export interface UsageScan extends LocalUsage {
  readonly stores: readonly StoreScan[];
}

export interface UsageScanReader {
  scan(request: UsageScanRequest): Promise<UsageScan>;
  close(): Promise<void>;
}

type SessionScan = StoreScan["sessions"][number];

/**
 * A session's spend, keyed by a fingerprint of its object rows. Objects are
 * immutable and content-addressed, so a session whose rows have not changed
 * cannot have different spend; only a session that grew is read again.
 */
type SessionScanCache = Map<string, { readonly fingerprint: string; readonly scan: SessionScan }>;

async function scanStore(location: StoreLocation, cache: SessionScanCache): Promise<StoreScan> {
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(location.path);
    const sessions: SessionScan[] = [];
    const seen = new Set<string>();

    for (const info of await store.list()) {
      seen.add(info.id);
      const session = await store.open(info.id);

      try {
        const listed = await session.objects.list();
        const fingerprint = `${String(listed.length)}:${String(listed.reduce((latest, row) => Math.max(latest, row.at), 0))}`;
        const hit = cache.get(info.id);

        if (hit !== undefined && hit.fingerprint === fingerprint) {
          sessions.push(hit.scan);
          continue;
        }

        const commits = await session.objects.commits();

        const scan: SessionScan = {
          sessionId: sessionId(info.id),
          commits: commits.flatMap(({ commit }) => usageCommit(commit) ?? []),
        };

        cache.set(info.id, { fingerprint, scan });
        sessions.push(scan);
      } finally {
        await session.close();
      }
    }

    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);

    return { workspacePath: location.workspacePath, sessions, failure: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    return { workspacePath: location.workspacePath, sessions: [], failure: message };
  } finally {
    await store?.close();
  }
}

/**
 * The read itself. Stores are read independently, so one that fails is a
 * row on the page rather than an error over the folders that answered. The
 * transcript readers keep a per-file cache for the life of the process,
 * persisted under the Nyte home so a restart pays stat calls rather than a
 * cold parse; a cache that cannot be loaded or saved costs time, never numbers.
 */
export class UsageScanner implements UsageScanReader {
  private readonly cachePath: string;
  private loaded: Promise<UsageScanCaches> | undefined;
  /** Per store path; a store read in this process keeps its sessions' spend. */
  private readonly sessions = new Map<string, SessionScanCache>();
  /** The text last written, so an unchanged cache is not rewritten. */
  private persisted: string | undefined;

  constructor(home: string) {
    this.cachePath = join(home, "usage-scan-cache.json");
  }

  async scan(request: UsageScanRequest): Promise<UsageScan> {
    const caches = await this.load();
    const models: Pick<Models, "getModels"> = { getModels: () => request.catalog };

    const [stores, local] = await Promise.all([
      Promise.all(
        request.stores.map((location) => {
          const cache = this.sessions.get(location.path) ?? new Map();
          this.sessions.set(location.path, cache);

          return scanStore(location, cache);
        }),
      ),
      readLocalUsage({ models, caches }),
    ]);

    await this.save(caches);

    return { stores, ...local };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private load(): Promise<UsageScanCaches> {
    // One load per process, shared by concurrent first readers, so neither
    // parses cold against an empty cache while the other is still decoding.
    this.loaded ??= readFile(this.cachePath, "utf8").then(
      (text) => {
        this.persisted = text;

        return decodeUsageScanCaches(text);
      },
      () => createUsageScanCaches(),
    );

    return this.loaded;
  }

  private async save(caches: UsageScanCaches): Promise<void> {
    const text = encodeUsageScanCaches(caches);

    if (text === this.persisted) return;

    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      // A crash mid-write leaves the previous cache, not half of this one.
      const staging = `${this.cachePath}.tmp`;
      await writeFile(staging, text, "utf8");
      await rename(staging, this.cachePath);
      this.persisted = text;
    } catch {
      // Left unset: the next read tries to persist again.
    }
  }
}

/** What the main process posts to the worker. */
export interface UsageWorkerRequest extends UsageScanRequest {
  readonly id: number;
  readonly home: string;
}

/** What the worker posts back. Every failure inside the scan is a value. */
export interface UsageWorkerReply {
  readonly id: number;
  readonly scan: UsageScan;
}

function isReply(value: unknown): value is UsageWorkerReply {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "scan" in value
  );
}

/**
 * The scanner on a worker thread. The worker starts on the first read and is
 * kept, so its caches stay in memory between visits; it does not hold the
 * process open, and a crash fails the pending reads and starts a fresh
 * worker for the next one.
 */
export class UsageScanWorker implements UsageScanReader {
  private readonly home: string;
  private readonly entry: URL;
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (scan: UsageScan) => void; reject: (cause: unknown) => void }
  >();

  constructor(home: string, entry: URL) {
    this.home = home;
    this.entry = entry;
  }

  scan(request: UsageScanRequest): Promise<UsageScan> {
    const worker = this.spawn();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, home: this.home, ...request } satisfies UsageWorkerRequest);
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;

    if (worker !== undefined) await worker.terminate();
  }

  private spawn(): Worker {
    if (this.worker !== undefined) return this.worker;
    const worker = new Worker(this.entry);
    worker.unref();
    worker.on("message", (value: unknown) => {
      if (!isReply(value)) return;
      const request = this.pending.get(value.id);
      this.pending.delete(value.id);
      request?.resolve(value.scan);
    });

    const fail = (cause: unknown) => {
      if (this.worker === worker) this.worker = undefined;

      for (const request of this.pending.values()) request.reject(cause);
      this.pending.clear();
    };

    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (this.pending.size > 0) fail(new Error(`Usage worker exited with code ${String(code)}.`));
    });
    this.worker = worker;

    return worker;
  }
}
