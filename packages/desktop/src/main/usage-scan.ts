/**
 * The Usage page's reads, off the main process. The main process brokers
 * every renderer call, so the app runs the host's usage scan on a worker
 * thread and stays responsive while it works.
 */
import { Worker } from "node:worker_threads";
import type { UsageScan, UsageScanReader, UsageScanRequest } from "@nyte-ai/host/store-usage";

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
    worker.on("message", (reply: UsageWorkerReply) => {
      const request = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      request?.resolve(reply.scan);
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
