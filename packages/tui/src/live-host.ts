import type { PartId, PartView, SessionId, SessionInfo } from "@nyte-ai/schema";
import { errorMessage } from "./lib/format.ts";
import type { RefusedSend } from "./effects/ports.ts";
import type {
  Chat,
  ClientConnection,
  Freshness,
  HeadView,
  Health,
  SessionsWindow,
} from "@nyte-ai/sdk/client";

interface Opened<T> {
  read(): T | null;
  freshness?(): Freshness;
  close(): void;
}

export function chatViews(chat: Chat): AsyncIterable<HeadView> {
  return liveValues((changed) => ({
    read: () => chat.snapshot().view,
    freshness: () => chat.snapshot().freshness,
    close: chat.subscribe(changed),
  }));
}

export async function readPart(
  connection: ClientConnection,
  session: SessionId,
  part: PartId,
  signal: AbortSignal,
): Promise<PartView | null> {
  const snapshots = liveValues((changed) => {
    const store = connection.part(session, part);
    const stop = store.subscribe(changed);

    return {
      read: () => store.snapshot(),
      close() {
        stop();
        store.close();
      },
    };
  });

  if (signal.aborted) return null;
  const iterator = snapshots[Symbol.asyncIterator]();
  const aborted = new Promise<null>((resolve) => {
    signal.addEventListener("abort", () => resolve(null), { once: true });
  });

  try {
    const step = await Promise.race([iterator.next(), aborted]);

    return step === null || step.done === true ? null : step.value.part;
  } finally {
    void iterator.return?.();
  }
}

export function sessionLists(
  connection: ClientConnection,
  window: SessionsWindow,
): AsyncIterable<readonly SessionInfo[]> {
  return liveValues((changed) => {
    const store = connection.sessions.open(window);
    const stop = store.subscribe(changed);

    return {
      read() {
        const snapshot = store.snapshot();

        return snapshot === null
          ? null
          : snapshot.ids.flatMap((id) => {
              const info = snapshot.rows.get(id);

              return info === undefined ? [] : [info];
            });
      },
      close() {
        stop();
        store.close();
      },
    };
  });
}

export function healthUpdates(connection: ClientConnection): AsyncIterable<Health> {
  return liveValues((changed) => ({
    read: () => connection.health.snapshot(),
    close: connection.health.subscribe(changed),
  }));
}

export function refusedSends(connection: ClientConnection): AsyncIterable<readonly RefusedSend[]> {
  return liveValues((changed) => ({
    read() {
      const listed = connection.refused.snapshot();

      if (listed.length === 0) return null;

      for (const send of listed) connection.refused.take(send.id);

      return listed.map((send) => ({
        session: send.session,
        content: send.content,
        reason: errorMessage(send.error),
      }));
    },
    close: connection.refused.subscribe(changed),
  }));
}

export async function whenOpen<T>(connection: ClientConnection, ask: () => Promise<T>): Promise<T> {
  for (;;) {
    const since = await openSince(connection);

    const answer = await ask().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    if ("value" in answer) return answer.value;
    const health = connection.health.snapshot();

    if (health.kind === "open" && health.since === since) throw answer.error;
  }
}

function openSince(connection: ClientConnection): Promise<number> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const health = connection.health.snapshot();

      if (health.kind === "open") resolve(health.since);
      else if (health.kind === "blocked") reject(health.error);
      else return false;

      return true;
    };

    if (check()) return;

    const stop = connection.health.subscribe(() => {
      if (check()) stop();
    });
  });
}

function liveValues<T>(open: (changed: () => void) => Opened<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let dirty = true;
      let closed = false;
      let last: T | null = null;
      let lastFreshness: Freshness | undefined;
      let wake: (() => void) | null = null;

      const resume = (): void => {
        const waiting = wake;
        wake = null;
        waiting?.();
      };

      const opened = open(() => {
        dirty = true;
        resume();
      });

      return {
        async next(): Promise<IteratorResult<T>> {
          for (;;) {
            if (closed) return { done: true, value: undefined };

            if (dirty) {
              dirty = false;
              const value = opened.read();
              const freshness = opened.freshness?.();

              if (value === null || (value === last && freshness === lastFreshness)) continue;
              last = value;
              lastFreshness = freshness;

              return { done: false, value };
            }

            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
        async return(): Promise<IteratorResult<T>> {
          if (!closed) {
            closed = true;
            opened.close();
          }

          resume();

          return { done: true, value: undefined };
        },
      };
    },
  };
}
