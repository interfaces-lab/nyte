import { setTimeout as sleep } from "node:timers/promises";
import type { Lease } from "./model.ts";
import type { Session } from "./store.ts";

export class LeaseLost extends Error {
  constructor(lease: Lease) {
    super(`Lease ${lease.name} was taken by another owner`);
    this.name = "LeaseLost";
  }
}

/** Keep ownership during a slow provider or tool call, and stop work if ownership is lost. */
export async function withLeaseRenewal<T>(
  input: {
    readonly session: Session;
    readonly lease: Lease;
    readonly ttlMs: number;
    readonly signal?: AbortSignal;
  },
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const stop = new AbortController();
  const lost = new AbortController();
  const signal =
    input.signal === undefined ? lost.signal : AbortSignal.any([input.signal, lost.signal]);
  const renewal = (async () => {
    while (!stop.signal.aborted) {
      try {
        await sleep(Math.max(1, Math.floor(input.ttlMs / 3)), undefined, { signal: stop.signal });
      } catch (cause) {
        if (stop.signal.aborted) return;
        throw cause;
      }
      if (!(await input.session.leases.renew(input.lease, input.ttlMs))) {
        throw new LeaseLost(input.lease);
      }
    }
  })().catch((cause: unknown) => lost.abort(cause));
  try {
    const result = await run(signal);
    lost.signal.throwIfAborted();
    return result;
  } catch (cause) {
    lost.signal.throwIfAborted();
    throw cause;
  } finally {
    stop.abort();
    await renewal;
  }
}
