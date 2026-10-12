import { asId, asSeq } from "@nyte-ai/schema";
import type {
  CommitId,
  Disposer,
  HeadName,
  Json,
  PartId,
  PatchEvent,
  PrincipalId,
  Ref,
  RefUpdate,
  RunId,
  Seq,
  SessionEvent,
  SessionId,
  SessionView,
  SetOutcome,
  ToolProgress,
  ViewOptions,
} from "@nyte-ai/schema";
import type { FeedItem, HeadPair, SessionBus } from "./bus.ts";
import { dev } from "./dev-log.ts";
import { emptyFold, fold, project, withPair } from "./fold.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { settleAnswersFrom } from "./part-table.ts";
import { decodeRunRecord, envelope } from "./records.ts";
import type { SeenRecord } from "./records.ts";
import { headOf, headRef, runRef, seenRef, sessionOf } from "./refs.ts";
import { EMPTY_REVISION, isJsonObject, load } from "./session-state.ts";

/** Holds one shared fold per session per principal: built on first acquire, dropped on last release. */
export interface FoldCache {
  acquire(
    session: SessionId,
    principal: PrincipalId,
  ): {
    /** Resolves once the fold holds the session's log through its tail. */
    ready(): Promise<void>;
    state(): FoldState;
    subscribe(listener: (state: FoldState) => void): Disposer;
    release(): void;
  };
}

/** One session this kernel's bus carries: how many feeds follow it, the seq the first read the log through, and the seq through which its log was published here. */
export interface Follow {
  feeds: number;
  from: Seq | null;
  published: Seq | null;
}

/** One live part's streamed state as this process published it: its run, its text so far (text and thinking parts) and its last tool progress. */
export interface LiveStream {
  readonly run: RunId | null;
  readonly markdown: string | null;
  readonly progress: ToolProgress | null;
}

type Entry = {
  state: FoldState;
  holders: number;
  ready: Promise<void>;
  catchUp: () => Promise<void>;
  dispose: Disposer;
  readonly listeners: Set<(state: FoldState) => void>;
};

type Feeds = Pick<
  Kernel,
  "store" | "bus" | "follows" | "streams" | "activation" | "catalog" | "jobs" | "pages"
>;

const LOG_PAGE = 512;

const DONE = { done: true, value: undefined } as const;

/** Returns a fold cache over the kernel's store and bus, fed by `sessionEvents`' feed (§40a). Each item is folded with its head pair in one step: a head's revision is the pair's when the pair's tip is the head's tip, else null (§54a). */
export function createFoldCache(kernel: Feeds): FoldCache {
  const entries = new Map<string, Entry>();

  const build = (session: SessionId, principal: PrincipalId): Entry => {
    const entry: Entry = {
      state: emptyFold({ session, principal }),
      holders: 0,
      ready: Promise.resolve(),
      catchUp: async () => {},
      dispose: () => {},
      listeners: new Set(),
    };

    const feed = openFeed(kernel, session, asSeq(0), ({ event, head }) => {
      const folded = fold(entry.state, event);
      const name = movedHead(event);

      const next = head === null || name === null ? folded : withPair(folded, name, head);

      if (next === entry.state) return;
      entry.state = next;

      for (const listener of entry.listeners) listener(next);
    });

    entry.dispose = feed.dispose;
    entry.catchUp = feed.catchUp;
    entry.ready = feed.ready;

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
        async ready() {
          await entry.ready;
          await entry.catchUp();
        },
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

/** Yields a session's feed items after `after`: its log, then the unlogged seq-0 seeds (activation, catalog, the background items of its jobs and held pages), then the items published meanwhile, then each live part's streamed state, then every item as it is published, a logged one at or below the last seq yielded dropped. What the fold cache and the server's `head.watch` consume (§40a); `return()` unsubscribes at once. */
export function sessionEvents(kernel: Feeds, session: SessionId, after: Seq): AsyncIterable<FeedItem> {
  return closable<FeedItem>(() => {
    const queue: FeedItem[] = [];
    let waiting: (() => void) | null = null;
    let failure: { readonly error: unknown } | null = null;

    const wake = (): void => {
      const resolve = waiting;
      waiting = null;
      resolve?.();
    };

    const feed = openFeed(kernel, session, after, (item) => {
      queue.push(item);
      wake();
    });

    feed.ready.catch((error: unknown) => {
      failure = { error };
      wake();
    });

    return {
      async pull() {
        for (;;) {
          const item = queue.shift();

          if (item !== undefined) return { done: false, value: item };

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

/** Publishes a successful set's events on the bus through `followLog`, each event that moved a head written in this set paired with the tip and revision the `SetOutcome` gave it (§54a). A session's first mark is where the set's own events start, or where a feed following it finished reading the log, whichever is earlier. */
export async function publishSet(
  kernel: Pick<Kernel, "store" | "bus" | "follows">,
  updates: readonly RefUpdate[],
  outcome: SetOutcome,
): Promise<void> {
  if (outcome.kind !== "set") return;
  const counts = new Map<SessionId, number>();

  for (const update of updates) {
    const session = update.event === undefined ? null : sessionOf(update.name);

    if (session !== null) counts.set(session, (counts.get(session) ?? 0) + 1);
  }

  const last = [...counts.keys()].at(-1);
  const written = new Map<HeadName, HeadPair>();

  for (const [index, update] of updates.entries()) {
    const head = headOf(update.name);
    const revision = outcome.revisions[index];

    if (head === null || head.session !== last || revision === undefined) continue;

    written.set(
      head.head,
      update.target === null
        ? { tip: null, revision: EMPTY_REVISION }
        : { tip: asId<"commit">(update.target), revision },
    );
  }

  for (const [session, count] of counts) {
    const follow = followOf(kernel.follows, session);

    if (follow.published === null) {
      const through = session === last ? outcome.seq : await kernel.store.refs.tail(session);
      const own = Math.max(0, through - count);
      follow.published = asSeq(Math.min(follow.from ?? own, own));
    }

    await followLog(
      kernel,
      session,
      follow.published,
      session === last ? { through: outcome.seq, heads: written } : null,
    );
  }
}

/** Publishes on the bus what a session's log holds after this kernel's mark (`from` when it has none), each event once and in seq order (§42h), paired with its head ref: from `known` up to its seq, else read once per page after the log (§54a). */
export async function followLog(
  kernel: Pick<Kernel, "store" | "bus" | "follows">,
  session: SessionId,
  from: Seq,
  known: { readonly through: Seq; readonly heads: ReadonlyMap<HeadName, HeadPair> } | null = null,
): Promise<void> {
  const follow = followOf(kernel.follows, session);

  for (;;) {
    const events = await kernel.store.refs.log(session, follow.published ?? from, LOG_PAGE);
    const items = await paired(kernel, session, events, known);

    for (const { event, head } of items) {
      if (event.seq <= (follow.published ?? from)) continue;
      follow.published = event.seq;
      kernel.bus.publish(session, event, head);
    }

    if (events.length < LOG_PAGE) return;
  }
}

/** Writes a principal's seen mark for a head and publishes its `seen` event (§40a). */
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

/** Keeps `streams` current from what the bus carries: a part's text from its creation, durable updates and appends, its tool progress, dropped when it settles, fails or closes or its run ends (§54b). */
export function trackStreams(bus: SessionBus): Map<SessionId, Map<PartId, LiveStream>> {
  const streams = new Map<SessionId, Map<PartId, LiveStream>>();

  bus.subscribeAll((session, event) => {
    const parts = streams.get(session) ?? new Map<PartId, LiveStream>();
    streams.set(session, parts);

    if (event.kind === "patch") {
      const current = parts.get(event.part);

      if (current === undefined) return;

      if ("progress" in event) parts.set(event.part, { ...current, progress: event.progress });
      else if (current.markdown !== null)
        parts.set(event.part, {
          ...current,
          markdown: "append" in event ? current.markdown + event.append : event.markdown,
        });

      return;
    }

    const current = event.kind === "part" || event.kind === "call" ? parts.get(event.part) : undefined;

    if (event.kind === "part" && event.change === "created")
      parts.set(event.part, { run: event.run, markdown: markdownOf(event.state), progress: null });
    else if (event.kind === "part" && event.change === "updated" && current !== undefined)
      parts.set(event.part, { ...current, markdown: markdownOf(event.state), progress: null });
    else if (event.kind === "call" && event.change === "intent" && current !== undefined)
      parts.set(event.part, { ...current, markdown: null, progress: null });
    else if (
      (event.kind === "part" && event.change !== "updated" && event.change !== "waiting") ||
      (event.kind === "call" && event.change === "settled")
    )
      parts.delete(event.part);
    else if (event.kind === "commit" && event.body.kind === "part") parts.delete(event.body.part);
    else if (event.kind === "run" && event.change === "ended")
      for (const [part, live] of parts) if (live.run === event.run) parts.delete(part);

    if (parts.size === 0) streams.delete(session);
  });

  return streams;
}

/** Subscribes to a session's bus, then pushes its log after `after`, its seeds, the items buffered meanwhile, each live part's streamed state read in the same synchronous step that goes live, and every later item, each logged event once; `catchUp` pushes what the log holds past the last event pushed, to this feed alone. */
function openFeed(
  kernel: Feeds,
  session: SessionId,
  after: Seq,
  push: (item: FeedItem) => void,
): {
  readonly ready: Promise<void>;
  readonly catchUp: () => Promise<void>;
  readonly dispose: Disposer;
} {
  const buffered: FeedItem[] = [];
  const follow = followOf(kernel.follows, session);
  let building = true;
  let open = true;
  let through: number = after;

  const deliver = (item: FeedItem): void => {
    const event = item.event;

    if (event.kind !== "patch" && event.seq !== 0) {
      if (event.seq <= through) return;
      through = event.seq;
    }

    push(item);
  };

  const unsubscribe = kernel.bus.subscribe(session, (event, head) => {
    if (building) buffered.push({ event, head });
    else deliver({ event, head });
  });

  follow.feeds += 1;

  const dispose = (): void => {
    if (!open) return;
    open = false;
    unsubscribe();
    follow.feeds -= 1;

    if (follow.feeds === 0) follow.from = null;
  };

  const catchUp = async (): Promise<void> => {
    for (;;) {
      const events = await kernel.store.refs.log(session, asSeq(through), LOG_PAGE);

      for (const item of await paired(kernel, session, events, null)) deliver(item);

      if (events.length < LOG_PAGE) return;
    }
  };

  const ready = (async () => {
    try {
      await catchUp();

      if (open) follow.from ??= asSeq(through);

      const seed = { seq: asSeq(0), at: Date.now() };
      const events: SessionEvent[] = [
        { ...seed, head: null, kind: "activation", activation: kernel.activation(session) },
        { ...seed, head: null, kind: "catalog", catalog: kernel.catalog(session) },
        ...[...kernel.jobs.background(session), ...kernel.pages.background(session)].map(
          ({ head, item }): SessionEvent => ({ ...seed, head, kind: "background", item }),
        ),
      ];

      for (const event of events) deliver({ event, head: null });
    } finally {
      building = false;

      for (const item of buffered.splice(0)) deliver(item);

      for (const [part, live] of kernel.streams.get(session) ?? []) {
        if (live.markdown !== null && live.markdown !== "")
          push({ event: { kind: "patch", part, markdown: live.markdown }, head: null });

        if (live.progress !== null)
          push({ event: { kind: "patch", part, progress: live.progress }, head: null });
      }
    }
  })();

  return { ready, catchUp, dispose };
}

/** Returns each event with the head pair a read of its head ref gives, read once per head after the log, or the known pair for an event up to the known seq. */
async function paired(
  kernel: Pick<Kernel, "store">,
  session: SessionId,
  events: readonly SessionEvent[],
  known: { readonly through: Seq; readonly heads: ReadonlyMap<HeadName, HeadPair> } | null,
): Promise<readonly { readonly event: SessionEvent; readonly head: HeadPair | null }[]> {
  const knownFor = (event: SessionEvent, head: HeadName): HeadPair | undefined =>
    known !== null && event.seq <= known.through ? known.heads.get(head) : undefined;

  const unknown = new Set(
    events.flatMap((event) => {
      const head = movedHead(event);

      return head === null || knownFor(event, head) !== undefined ? [] : [head];
    }),
  );

  const read = new Map(
    await Promise.all(
      [...unknown].map(
        async (head) => [head, pairOf(await kernel.store.refs.get(headRef(session, head)))] as const,
      ),
    ),
  );

  return events.map((event) => {
    const head = movedHead(event);

    return {
      event,
      head: head === null ? null : (knownFor(event, head) ?? read.get(head) ?? null),
    };
  });
}

function pairOf(ref: Ref | null): HeadPair {
  return ref === null || ref.target === null
    ? { tip: null, revision: EMPTY_REVISION }
    : { tip: asId<"commit">(ref.target), revision: ref.revision };
}

function markdownOf(state: Json): string | null {
  return isJsonObject(state) && typeof state.markdown === "string" ? state.markdown : null;
}

function movedHead(event: SessionEvent | PatchEvent): HeadName | null {
  return event.kind === "commit" || event.kind === "head" ? event.head : null;
}

function followOf(follows: Map<SessionId, Follow>, session: SessionId): Follow {
  const follow = follows.get(session) ?? { feeds: 0, from: null, published: null };
  follows.set(session, follow);

  return follow;
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

/** Re-reads the store a kernel shares with other instances every `kernel.poll` ms, one pass at a time (§42h, §42u): the log of each session a feed follows here (`followLog`), the parked waits (`kernel.waits.settleFromStore`), the modal parts with a pending local `answer()` (`settleAnswersFrom`, §42ac), then the stop fence of every run a turn drives here (`rereadFences`). A pass that throws is dropped and the next one tries again; without `poll` nothing runs. */
export function pollStore(kernel: Kernel): Disposer {
  const every = kernel.poll;

  if (every === null) return () => undefined;
  let running = false;
  let stopped = false;

  const pass = async (): Promise<void> => {
    const followed = [...kernel.follows];
    dev("poll", "pass", { sessions: followed.length });

    for (const [session, follow] of followed) {
      if (follow.feeds === 0 || follow.from === null || stopped) continue;
      await followLog(kernel, session, follow.from);
    }

    if (stopped) return;
    const woke = await kernel.waits.settleFromStore();
    dev("poll", "waits", { woke });
    await settleAnswersFrom(kernel);
    await rereadFences(kernel);
  };

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    pass()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, every);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Aborts each run a turn drives here whose stop fence another instance wrote: marks it stopping, aborts its signal and wakes its parked waits with `stopped` (§30, §42u). */
export async function rereadFences(kernel: Kernel): Promise<void> {
  dev("poll", "fences", { runs: kernel.driving.size });

  for (const [run, session] of Array.from(kernel.driving)) {
    if (kernel.runs.isStopping(run)) continue;

    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || !found.record.stopping) continue;
    dev("poll", "fenced", { session, run });
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
  }
}
