import type { EventBody, Lease } from "./model.ts";
import type { Session } from "./store.ts";

const FLUSH_INTERVAL_MS = 25;
const MAX_BATCH_SIZE = 64;

export interface Outbox {
  readonly emit: (event: EventBody) => void;
  readonly flush: () => Promise<void>;
}

export function createOutbox(
  session: Session,
  options: { readonly lease: Lease; readonly onFenced: () => void },
): Outbox {
  let buffered: EventBody[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  let fenced = false;
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
    const batch = buffered;
    buffered = [];
    const write = (async (): Promise<void> => {
      try {
        const outcome = await session.events.append(batch, { lease: options.lease });
        if (!outcome.ok && !fenced) {
          fenced = true;
          buffered = [];
          try {
            options.onFenced();
          } catch {}
        }
      } catch (error) {
        failure = error;
        throw error;
      }
    })();
    const tracked = write.finally(() => {
      if (inFlight === tracked) inFlight = undefined;
      if (!fenced && failure === undefined) {
        if (buffered.length >= MAX_BATCH_SIZE) schedule(0);
        else schedule();
      }
    });
    inFlight = tracked;
    return tracked;
  };
  return {
    emit: (event) => {
      if (fenced || failure !== undefined) return;
      buffered.push(event);
      if (buffered.length >= MAX_BATCH_SIZE) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        schedule(0);
      } else {
        schedule();
      }
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
