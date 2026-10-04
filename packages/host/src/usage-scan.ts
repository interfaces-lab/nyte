import { Worker } from "node:worker_threads";
import type { UsageScan, UsageScanReader, UsageScanRequest } from "./store-usage.ts";

export interface UsageWorkerRequest extends UsageScanRequest {
  readonly id: number;
  readonly home: string;
}

export type UsageWorkerReply =
  | { readonly id: number; readonly scan: UsageScan }
  | { readonly id: number; readonly error: string };

export class UsageScanWorker implements UsageScanReader {
  private readonly home: string;
  private readonly entry: string | URL;
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (scan: UsageScan) => void; reject: (cause: unknown) => void }
  >();

  constructor(home: string, entry: string | URL) {
    this.home = home;
    this.entry = entry;
  }

  async scan(request: UsageScanRequest): Promise<UsageScan> {
    const worker = this.spawn();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      try {
        worker.postMessage({ id, home: this.home, ...request } satisfies UsageWorkerRequest);
      } catch (cause) {
        this.pending.delete(id);
        reject(cause);
      }
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;

    if (worker === undefined) return;

    this.fail(worker, new Error("Usage worker closed."));
    await worker.terminate();
  }

  private spawn(): Worker {
    if (this.worker !== undefined) return this.worker;
    const worker = new Worker(this.entry);
    worker.unref();
    worker.on("message", (reply: UsageWorkerReply) => {
      const request = this.pending.get(reply.id);
      this.pending.delete(reply.id);

      if ("scan" in reply) request?.resolve(reply.scan);
      else request?.reject(new Error(reply.error));
    });

    worker.on("error", (cause) => this.fail(worker, cause));
    worker.on("exit", (code) => {
      this.fail(worker, new Error(`Usage worker exited with code ${String(code)}.`));
    });
    this.worker = worker;

    return worker;
  }

  private fail(worker: Worker, cause: unknown): void {
    if (this.worker !== worker) return;
    this.worker = undefined;

    for (const request of this.pending.values()) request.reject(cause);
    this.pending.clear();
  }
}
