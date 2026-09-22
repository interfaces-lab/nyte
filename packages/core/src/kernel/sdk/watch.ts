import type { Event } from "../model.ts";
import type { Session } from "../store.ts";
import type { Notice } from "./activation.ts";
import { projectEvent } from "./events.ts";
import type { Disposer, Nyte, SessionActivationState, SessionEvent } from "./types.ts";

export type HostNotice =
  | Notice
  | { readonly kind: "activation_changed"; readonly activation: SessionActivationState };

export type NoticeListener = (notice: HostNotice) => void | Promise<void>;

interface PendingRead {
  outcome?:
    | { readonly kind: "value"; readonly result: IteratorResult<Event> }
    | { readonly kind: "error"; readonly cause: unknown };
}

function noticeEvent(notice: HostNotice, seq: number): SessionEvent {
  switch (notice.kind) {
    case "activation_changed":
      return { seq, kind: "activation_changed", activation: notice.activation };
    case "diagnostic":
      return {
        seq,
        kind: "diagnostic",
        owner: notice.owner,
        level: notice.level,
        message: notice.message,
      };
    case "plugins_changed":
      return { seq, kind: "plugins_changed", plugins: notice.plugins };
    case "notification": {
      const base = {
        seq,
        kind: "notification",
        owner: notice.owner,
        message: notice.message,
        sound: notice.sound === true,
      } satisfies SessionEvent;

      return notice.title === undefined ? base : { ...base, title: notice.title };
    }

    case "status_changed":
      return { seq, kind: "status_changed", items: notice.items };
    default: {
      const _exhaustive: never = notice;

      return _exhaustive;
    }
  }
}

/** Own replay, host notices, and the lifetime of this watch's durable iterator. */
export async function* watchSession(options: {
  readonly session: Session;
  readonly input: Parameters<Nyte["watch"]>[0];
  readonly subscribe: (listener: NoticeListener) => Disposer;
  readonly activation: () => Promise<SessionActivationState>;
}): AsyncIterable<SessionEvent> {
  const { session, input } = options;
  const source = new AbortController();
  const abort = (): void => source.abort();
  input.signal?.addEventListener("abort", abort, { once: true });

  if (input.signal?.aborted) abort();
  const notices: Promise<SessionEvent>[] = [];
  let wake: (() => void) | undefined;
  let iterator: AsyncIterator<Event> | undefined;
  let activationObserved = false;
  let departed = false;

  const notify = (): void => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };

  const enqueue = (notice: HostNotice): Promise<void> => {
    // Reserve arrival order before reading the cursor. Concurrent notices may
    // finish that read in a different order, or while the consumer is at yield.
    const event = Promise.withResolvers<SessionEvent>();
    notices.push(event.promise);
    void session.events.last().then((seq) => event.resolve(noticeEvent(notice, seq)), event.reject);
    // A queued rejection must be observed even if the consumer leaves before
    // reaching it. The original rejection still propagates when it is drained.
    void event.promise.catch(() => undefined);
    notify();

    return event.promise.then(() => undefined);
  };

  let unsubscribe: Disposer | undefined;

  try {
    unsubscribe = options.subscribe((notice) => {
      if (departed) return;

      if (notice.kind === "activation_changed") activationObserved = true;

      return enqueue(notice);
    });
    const target = await session.events.last();
    const after = "live" in input ? target : (input.afterSeq ?? 0);
    await session.events.read({ afterSeq: after, limit: 0 });
    const activation = await options.activation();

    // Cold resolution announces its state through the subscription. A cached
    // resolution does not, so replay it explicitly. Keep every intervening
    // change, including those arriving during the replay's cursor read.
    if (!activationObserved) await enqueue({ kind: "activation_changed", activation });
    let synced = after >= target;

    if (synced) yield { seq: target, kind: "synced" };

    const durable = session.events
      .watch({ afterSeq: after, signal: source.signal })
      [Symbol.asyncIterator]();

    iterator = durable;
    const pending: PendingRead = {};
    let reading = false;

    const readNext = (): void => {
      // Exactly one completion registration per read, independent of notices.
      // The durable side retains one result and one wake slot, not a race chain.
      if (reading) return;
      reading = true;
      void durable.next().then(
        (result) => {
          pending.outcome = { kind: "value", result };
          reading = false;
          notify();
        },
        (cause: unknown) => {
          pending.outcome = { kind: "error", cause };
          reading = false;
          notify();
        },
      );
    };

    // Live events the backend already delivered are taken together: one publish
    // then reaches the consumer without a task boundary between its events, so
    // nothing it does in between sees the half-applied state. Replay stays
    // page by page, so a slow replay still observes the floor moving.
    const buffered = (): Promise<PendingRead["outcome"]> =>
      new Promise((resolve) => {
        const take = (): PendingRead["outcome"] => {
          const outcome = pending.outcome;
          pending.outcome = undefined;

          return outcome;
        };

        if (pending.outcome !== undefined) {
          resolve(take());

          return;
        }

        readNext();

        const later = setImmediate(() => {
          wake = undefined;
          resolve(undefined);
        });

        wake = () => {
          clearImmediate(later);
          resolve(take());
        };
      });

    readNext();

    for (;;) {
      while (notices.length > 0) {
        const notice = notices.shift();

        if (notice !== undefined) yield await notice;
      }

      if (pending.outcome === undefined) {
        readNext();
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      const outcome = pending.outcome;
      pending.outcome = undefined;

      if (outcome.kind === "error") throw outcome.cause;

      if (outcome.result.done) return;
      const group = [outcome.result.value];

      while (synced) {
        const next = await buffered();

        if (next === undefined || next.kind === "error" || next.result.done) {
          if (next !== undefined) pending.outcome = next;
          break;
        }

        group.push(next.result.value);
      }

      const projected = await Promise.all(
        group.map((event) => projectEvent(event, session.objects)),
      );

      for (const [index, event] of group.entries()) {
        for (const item of projected[index] ?? []) yield item;

        // Equal-seq siblings are all part of this barrier, including every commit
        // expanded from the target ref event.
        if (!synced && event.seq >= target) {
          synced = true;
          yield { seq: target, kind: "synced" };
        }
      }

      readNext();
    }
  } finally {
    departed = true;
    unsubscribe?.();
    notices.length = 0;
    input.signal?.removeEventListener("abort", abort);
    wake = undefined;
    source.abort();
    await iterator?.return?.().catch(() => undefined);
  }
}
