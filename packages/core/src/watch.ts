import { asSeq } from "@nyte-ai/schema";
import type {
  CommitId,
  Disposer,
  HeadName,
  PatchEvent,
  PrincipalId,
  RefUpdate,
  Seq,
  SessionEvent,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import { publishSet } from "./bus.ts";
import { emptyFold, fold, project, withRevision } from "./fold.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { envelope } from "./records.ts";
import type { SeenRecord } from "./records.ts";
import { headRef, seenRef } from "./refs.ts";

/** Holds one shared fold per session per principal: built on first acquire, dropped on last release. */
export interface FoldCache {
  /** Returns a hold on the session's fold for a principal, building it from `refs.log` and the bus on first acquire. */
  acquire(
    session: SessionId,
    principal: PrincipalId,
  ): {
    /** Resolves once the log is folded and the bus subscribed; rejects when the build failed. */
    ready(): Promise<void>;
    /** Returns the current state. */
    state(): FoldState;
    /** Calls the listener after every fold step; the disposer stops it. */
    subscribe(listener: (state: FoldState) => void): Disposer;
    /** Releases this hold; the last release drops the fold. */
    release(): void;
  };
}

type Entry = {
  state: FoldState;
  holders: number;
  ready: Promise<void>;
  dispose: Disposer;
  readonly listeners: Set<(state: FoldState) => void>;
};

const LOG_PAGE = 512;

const DONE = { done: true, value: undefined } as const;

/** Returns a fold cache over the kernel's store and bus: one fold per session per principal, shared by every holder, built from `sessionEvents`' feed (the log, then the seeds, then live; §40a). A cold fold's seeds are the session's in-memory activation, catalog, and the background items of its jobs and held pages; their seq-0 events pass at any seq (§35b, §37c). */
export function createFoldCache(
  kernel: Pick<Kernel, "store" | "bus" | "revisions" | "activation" | "catalog" | "jobs" | "pages">,
): FoldCache {
  const entries = new Map<string, Entry>();

  const build = (session: SessionId, principal: PrincipalId): Entry => {
    const entry: Entry = {
      state: emptyFold({ session, principal }),
      holders: 0,
      ready: Promise.resolve(),
      dispose: () => {},
      listeners: new Set(),
    };

    const step = (state: FoldState, event: SessionEvent | PatchEvent): FoldState => {
      if (event.kind !== "patch" && !isSeed(event) && event.seq <= state.seq) return state;
      const next = fold(state, event);

      if (event.kind === "patch") return next;

      return [...next.heads.keys()].reduce((current, head) => {
        const revision = kernel.revisions.get(headRef(session, head));

        return revision === undefined ? current : withRevision(current, head, revision);
      }, next);
    };

    const feed = openFeed(kernel, session, asSeq(0), (event) => {
      const next = step(entry.state, event);

      if (next === entry.state) return;
      entry.state = next;

      for (const listener of entry.listeners) listener(next);
    });

    entry.dispose = feed.dispose;

    entry.ready = feed.ready.then(async () => {
      for (const head of entry.state.heads.keys()) {
        const name = headRef(session, head);
        const ref = await kernel.store.refs.get(name);

        if (ref !== null && !kernel.revisions.has(name))
          entry.state = withRevision(entry.state, head, ref.revision);
      }
    });

    return entry;
  };

  return {
    acquire(session, principal) {
      const key = JSON.stringify([session, principal]);
      const entry = entries.get(key) ?? build(session, principal);
      const own = new Set<(state: FoldState) => void>();
      let released = false;
      entries.set(key, entry);
      entry.holders += 1;

      return {
        ready: () => entry.ready,
        state: () => entry.state,
        subscribe(listener) {
          const relay = (state: FoldState) => listener(state);
          entry.listeners.add(relay);
          own.add(relay);

          return () => {
            entry.listeners.delete(relay);
            own.delete(relay);
          };
        },
        release() {
          if (released) return;
          released = true;

          for (const relay of own) entry.listeners.delete(relay);
          entry.holders -= 1;

          if (entry.holders > 0) return;
          entry.dispose();

          if (entries.get(key) === entry) entries.delete(key);
        },
      };
    },
  };
}

/** Yields a session's events after `after`: its log, then the unlogged seq-0 seeds (activation, catalog, and the background items of its jobs and held pages), then every event as it is published, live events arriving during the build buffered and a logged one at or below the last seq yielded dropped. What the fold cache and the server's `head.watch` consume (§40a); `return()` unsubscribes at once. */
export function sessionEvents(
  kernel: Pick<Kernel, "store" | "bus" | "activation" | "catalog" | "jobs" | "pages">,
  session: SessionId,
  after: Seq,
): AsyncIterable<SessionEvent | PatchEvent> {
  return closable<SessionEvent | PatchEvent>(() => {
    const queue: (SessionEvent | PatchEvent)[] = [];
    let waiting: (() => void) | null = null;
    let failure: { readonly error: unknown } | null = null;

    const wake = (): void => {
      const resolve = waiting;
      waiting = null;
      resolve?.();
    };

    const feed = openFeed(kernel, session, after, (event) => {
      queue.push(event);
      wake();
    });

    feed.ready.catch((error: unknown) => {
      failure = { error };
      wake();
    });

    return {
      async pull() {
        for (;;) {
          const event = queue.shift();

          if (event !== undefined) return { done: false, value: event };

          if (failure !== null) throw failure.error;
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
        }
      },
      close() {
        feed.dispose();
        wake();
      },
    };
  });
}

/** Writes a principal's seen mark for a head (`sessions/<id>/seen/<principal>/<head>`) and publishes its `seen` event: what a watch does for each tip it shows, and what the server does for each tip change it forwards to a watching principal (§40a). */
export async function advanceSeen(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
    readonly commit: CommitId | null;
  },
): Promise<void> {
  const record: SeenRecord = { commit: input.commit };
  const target = await kernel.store.objects.put(envelope("seen", record, Date.now()));

  const updates: readonly RefUpdate[] = [
    {
      name: seenRef(input.session, input.principal, input.head),
      target,
      event: {
        head: input.head,
        kind: "seen",
        principal: input.principal,
        commit: input.commit,
      },
    },
  ];

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));
}

/** Returns whether an event is an unlogged seed that passes at any seq: activation, catalog, and a seq-0 background item. */
function isSeed(event: SessionEvent): boolean {
  return (
    event.kind === "activation" ||
    event.kind === "catalog" ||
    (event.kind === "background" && event.seq === 0)
  );
}

/** Subscribes to a session's bus, then pushes its log after `after`, its seeds, the events buffered meanwhile and every later one, each logged event once; `ready` settles when the buffer is drained. */
function openFeed(
  kernel: Pick<Kernel, "store" | "bus" | "activation" | "catalog" | "jobs" | "pages">,
  session: SessionId,
  after: Seq,
  push: (event: SessionEvent | PatchEvent) => void,
): { readonly ready: Promise<void>; readonly dispose: Disposer } {
  const buffered: (SessionEvent | PatchEvent)[] = [];
  let building = true;
  let through: number = after;

  const deliver = (event: SessionEvent | PatchEvent): void => {
    if (event.kind !== "patch" && event.seq !== 0) {
      if (event.seq <= through) return;
      through = event.seq;
    }

    push(event);
  };

  const dispose = kernel.bus.subscribe(session, (event) => {
    if (building) buffered.push(event);
    else deliver(event);
  });

  const ready = (async () => {
    try {
      for (;;) {
        const events = await kernel.store.refs.log(session, asSeq(through), LOG_PAGE);

        for (const event of events) deliver(event);

        if (events.length < LOG_PAGE) break;
      }

      const at = Date.now();
      const seed = { seq: asSeq(0), at };
      deliver({ ...seed, head: null, kind: "activation", activation: kernel.activation(session) });
      deliver({ ...seed, head: null, kind: "catalog", catalog: kernel.catalog(session) });

      for (const { head, item } of [
        ...kernel.jobs.background(session),
        ...kernel.pages.background(session),
      ])
        deliver({ ...seed, head, kind: "background", item });
    } finally {
      building = false;

      for (const event of buffered.splice(0)) deliver(event);
    }
  })();

  return { ready, dispose };
}

/** Yields `initial`, then the newest value pushed since the last pull; `return()` unsubscribes at once, even while a pull waits. */
export function latest<T>(
  initial: T,
  subscribe: (push: (value: T) => void) => Disposer,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let slot: { readonly value: T } | null = { value: initial };
      let waiting: ((result: IteratorResult<T>) => void) | null = null;
      let closed = false;

      const dispose = subscribe((value) => {
        const resolve = waiting;

        if (closed) return;

        if (resolve === null) {
          slot = { value };

          return;
        }

        waiting = null;
        resolve({ done: false, value });
      });

      return {
        next(): Promise<IteratorResult<T>> {
          const held = slot;

          if (closed) return Promise.resolve({ done: true, value: undefined });

          if (held !== null) {
            slot = null;

            return Promise.resolve({ done: false, value: held.value });
          }

          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
        return(): Promise<IteratorResult<T>> {
          const resolve = waiting;
          waiting = null;

          if (!closed) {
            closed = true;
            dispose();
          }

          resolve?.({ done: true, value: undefined });

          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

/** Returns an iterable over `open`'s pulls, opened on the first `next()`. `return()` closes at once: a pending pull settles done and `close` runs before `return()` awaits what it returns. */
export function closable<T>(
  open: () => {
    pull(): Promise<IteratorResult<T>>;
    close(): Promise<void> | void;
  },
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let source: ReturnType<typeof open> | null = null;
      let settle: ((result: IteratorResult<T>) => void) | null = null;
      let closing: Promise<void> | null = null;

      const close = (): Promise<void> => {
        if (closing !== null) return closing;
        const resolve = settle;
        settle = null;
        closing = Promise.resolve(source?.close());
        resolve?.(DONE);

        return closing;
      };

      return {
        next(): Promise<IteratorResult<T>> {
          if (closing !== null) return Promise.resolve(DONE);
          const opened = source ?? open();
          source = opened;
          const pulled = opened.pull();

          const end = (): void => {
            settle = null;
            close().catch(() => undefined);
          };

          pulled.then((result) => {
            if (result.done) end();
          }, end);

          return Promise.race([
            pulled,
            new Promise<IteratorResult<T>>((resolve) => {
              settle = resolve;
            }),
          ]);
        },
        async return(): Promise<IteratorResult<T>> {
          await close();

          return DONE;
        },
      };
    },
  };
}

/** Yields at most one value per frame from a source, newest wins, never more than one pending. `return()` settles a pending pull and stops the source at once. */
export function coalesce<T>(source: AsyncIterable<T>, frameMs = 16): AsyncIterable<T> {
  return closable<T>(() => {
    const iterator = source[Symbol.asyncIterator]();
    let pending: { readonly value: T } | null = null;

    let ending:
      | { readonly kind: "ended" }
      | { readonly kind: "failed"; readonly error: unknown }
      | null = null;

    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let last = Number.NEGATIVE_INFINITY;

    const signal = (): void => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    void (async () => {
      try {
        for (;;) {
          const next = await iterator.next();

          if (next.done || closed) break;
          pending = { value: next.value };
          signal();
        }

        ending = { kind: "ended" };
      } catch (error) {
        ending = { kind: "failed", error };
      }

      signal();
    })();

    return {
      async pull() {
        for (;;) {
          if (pending === null && ending === null) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }

          const wait = last + frameMs - Date.now();

          if (pending !== null && wait > 0) {
            await new Promise<void>((resolve) => {
              timer = setTimeout(resolve, wait);
            });
          }

          if (ending?.kind === "failed") throw ending.error;
          const held = pending;

          if (held !== null) {
            pending = null;
            last = Date.now();

            return { done: false, value: held.value };
          }

          if (ending !== null) return DONE;
        }
      },
      close() {
        closed = true;
        clearTimeout(timer);
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
      },
    };
  });
}

/** Yields the head's view on every change, coalesced; after each yield whose tip moved, writes the principal's seen mark. `return()` releases the fold at once. */
export function watchHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly options?: ViewOptions;
  },
): AsyncIterable<SessionView> {
  return closable<SessionView>(() => {
    const hold = kernel.folds.acquire(input.session, input.principal);
    let states: AsyncIterator<FoldState> | null = null;
    let closed = false;
    let shown: SessionView | null = null;
    let marked: CommitId | null | undefined;
    let seeing: Promise<void> = Promise.resolve();

    return {
      async pull() {
        await seeing;

        if (states === null) {
          await hold.ready();

          if (closed) return DONE;
          states = coalesce(latest(hold.state(), (push) => hold.subscribe(push)))[
            Symbol.asyncIterator
          ]();
        }

        for (;;) {
          const next = await states.next();

          if (next.done || closed) return DONE;
          const state = hold.state();
          const view = project(state, input.head, input.options);

          if (view === shown) continue;
          shown = view;
          const head = state.heads.get(input.head);
          const tip = head?.info.tip.kind === "commit" ? head.info.tip.id : null;

          if (head !== undefined && tip !== head.seen && tip !== marked) {
            marked = tip;
            seeing = advanceSeen(kernel, { ...input, commit: tip });
          }

          return { done: false, value: view };
        }
      },
      close() {
        closed = true;
        void states?.return?.();
        hold.release();

        return seeing;
      },
    };
  });
}

/** Returns one snapshot of the head's view through the shared fold. Moves no seen mark. */
export async function viewHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly options?: ViewOptions;
  },
): Promise<SessionView> {
  const hold = kernel.folds.acquire(input.session, input.principal);

  try {
    await hold.ready();

    return project(hold.state(), input.head, input.options);
  } finally {
    hold.release();
  }
}
