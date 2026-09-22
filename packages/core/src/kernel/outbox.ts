import type { EventBody, Lease } from "./model.ts";
import type { Session } from "./store.ts";

const FLUSH_INTERVAL_MS = 25;

const MAX_BATCH_SIZE = 64;

type EmitResult = Promise<void> | void;

export interface Outbox {
  readonly emit: (event: EventBody) => EmitResult;
  readonly flush: () => Promise<void>;
}

function sameProgress(
  left: EventBody,
  right: Extract<EventBody, { readonly kind: "progress" }>,
): boolean {
  return left.kind === "progress" && left.runId === right.runId && left.callId === right.callId;
}

export function createOutbox(
  session: Session,
  options: { readonly lease: Lease; readonly onFenced: () => void },
): Outbox {
  let buffered: EventBody[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let pressure: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let failure: unknown;
  let fenced = false;

  const releasePressure = (): void => {
    if (buffered.length >= MAX_BATCH_SIZE || pressure === undefined) return;
    pressure.resolve();
    pressure = undefined;
  };

  const schedule = (delay = FLUSH_INTERVAL_MS): void => {
    if (timer !== undefined || inFlight !== undefined || buffered.length === 0 || fenced) return;
    timer = setTimeout(() => {
      timer = undefined;
      void start()?.catch(() => undefined);
    }, delay);
    timer.unref();
  };

  const start = (): Promise<void> | undefined => {
    if (inFlight !== undefined || buffered.length === 0 || fenced) return inFlight;

    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const batch = buffered.slice(0, MAX_BATCH_SIZE);
    buffered = buffered.slice(batch.length);
    releasePressure();

    const write = (async (): Promise<void> => {
      try {
        const outcome = await session.events.append(batch, { lease: options.lease });

        if (!outcome.ok && !fenced) {
          fenced = true;
          buffered = [];
          releasePressure();

          try {
            options.onFenced();
          } catch {}
        }
      } catch (error) {
        failure = error;
        buffered = [];
        releasePressure();
        throw error;
      }
    })();

    const tracked = write.finally(() => {
      if (inFlight === tracked) inFlight = undefined;

      if (fenced || failure !== undefined) return;

      if (buffered.length >= MAX_BATCH_SIZE) void start()?.catch(() => undefined);
      else schedule();
    });

    inFlight = tracked;

    return tracked;
  };

  const backpressure = (): Promise<void> => {
    pressure ??= Promise.withResolvers<void>();

    return pressure.promise;
  };

  return {
    emit: (event) => {
      if (fenced || failure !== undefined) return;

      if (event.kind === "progress") {
        const existing = buffered.findIndex((candidate) => sameProgress(candidate, event));

        if (existing !== -1) buffered.splice(existing, 1);

        if (buffered.length >= MAX_BATCH_SIZE) {
          const oldestProgress = buffered.findIndex((candidate) => candidate.kind === "progress");

          if (oldestProgress !== -1) buffered.splice(oldestProgress, 1);
          else return;
        }
      }

      if (buffered.length >= MAX_BATCH_SIZE) {
        throw new Error("Outbox capacity exceeded; await emit before producing more events");
      }

      buffered.push(event);

      if (buffered.length < MAX_BATCH_SIZE) {
        schedule();

        return;
      }

      if (inFlight === undefined) return start();

      return backpressure();
    },
    flush: async () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;

      for (;;) {
        const current = inFlight ?? start();

        if (current === undefined) {
          if (failure !== undefined) throw failure;

          return;
        }

        await current;
      }
    },
  };
}
