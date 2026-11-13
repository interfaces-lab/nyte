import { asId } from "@nyte-ai/schema";
import type { PartId, PartView, SessionId, SessionInfo } from "@nyte-ai/schema";
import { openHost, unsentSends } from "@nyte-ai/sdk/client";
import type {
  ChatStore,
  Freshness,
  HeadView,
  Health,
  HostConnection,
  SessionsWindow,
} from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import type { LocalEndpoint } from "@nyte-ai/service";
import { VERSION } from "./version.ts";

const MAIN = asId<"head">("main");

const TAIL = 200;

interface Opened<T> {
  read(): T | null;
  /** Read after `read`; a change here alone yields the same value again. */
  freshness?(): Freshness;
  close(): void;
}

export function openLiveHost(endpoint: LocalEndpoint, kind: "tui" | "cli"): HostConnection {
  return openHost(endpoint.url, {
    credentials: { kind: "token", token: endpoint.token },
    client: { kind, name: "nyte", version: VERSION },
  });
}

/** The chat of `session`'s main head; with `sends`, its journaled sends are laid in until the host has them. */
export function openChat(live: HostConnection, session: SessionId, sends?: Connection): ChatStore {
  return live.chat(session, MAIN, {
    tail: TAIL,
    unsent: sends === undefined ? undefined : unsentSends(sends, session, MAIN),
  });
}

export function chatViews(chat: ChatStore): AsyncIterable<HeadView> {
  return liveValues((changed) => ({
    read: () => chat.snapshot().view,
    freshness: () => chat.snapshot().freshness,
    close: chat.subscribe(changed),
  }));
}

export async function readPart(
  live: HostConnection,
  session: SessionId,
  part: PartId,
  signal: AbortSignal,
): Promise<PartView | null> {
  const snapshots = liveValues((changed) => {
    const store = live.part(session, part);
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
  live: HostConnection,
  window: SessionsWindow,
): AsyncIterable<readonly SessionInfo[]> {
  return liveValues((changed) => {
    const store = live.directory(window);
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

export function healthUpdates(live: HostConnection): AsyncIterable<Health> {
  return liveValues((changed) => ({
    read: () => live.health.snapshot(),
    close: live.health.subscribe(changed),
  }));
}

export async function whenOpen<T>(live: HostConnection, ask: () => Promise<T>): Promise<T> {
  for (;;) {
    const since = await openSince(live);

    const answer = await ask().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    if ("value" in answer) return answer.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const health = live.health.snapshot();

    if (health.kind === "open" && health.since === since) throw answer.error;
  }
}

function openSince(live: HostConnection): Promise<number> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const health = live.health.snapshot();

      if (health.kind === "open") resolve(health.since);
      else if (health.kind === "blocked") reject(health.error);
      else return false;

      return true;
    };

    if (check()) return;

    const stop = live.health.subscribe(() => {
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
