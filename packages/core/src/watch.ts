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
import { SdkError } from "./error.ts";
import { emptyFold, fold, project, readSeenCommit, withPair } from "./fold.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { settleAnswersFrom } from "./parts.ts";
import { decodeRunRecord, decodeSeenRecord, isJsonObject } from "./records.ts";
import type { SeenRecord } from "./records.ts";
import { parseHeadRef, headRef, runRef, seenRef, parseSessionRef } from "./refs.ts";
import {
  EMPTY_REVISION,
  STALE,
  START,
  attempt,
  commit,
  readRefExpectation,
  load,
  walkCommitPath,
  put,
  readPositionCommit,
  withFold,
} from "./session-state.ts";

export interface FoldCache {
  acquire(
    session: SessionId,
    principal: PrincipalId,
  ): {
    ready(): Promise<void>;

    state(): FoldState;
    subscribe(listener: (state: FoldState) => void): Disposer;
    release(): void;
  };
}

export interface Follow {
  feeds: number;
  from: Seq | null;
  published: Seq | null;
  publishing: number;
}

export interface LiveStream {
  readonly run: RunId | null;
  readonly markdown: string | null;
  readonly progress: ToolProgress | null;
}

type Entry = {
  state: FoldState;
  holders: number;
  linger: ReturnType<typeof setTimeout> | undefined;
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

const LIVE_PENDING_LIMIT = 1024;

const LIVE_APPEND_LIMIT = 16 * 1024;

const FOLD_LINGER = 30_000;

const SEEN_DELAY = 16;

const DONE = { done: true, value: undefined } as const;

export function createFoldCache(kernel: Feeds): FoldCache {
  const entries = new Map<SessionId, Entry>();

  const build = (session: SessionId, principal: PrincipalId): Entry => {
    const entry: Entry = {
      state: emptyFold({ session, principal }),
      holders: 0,
      linger: undefined,
      ready: Promise.resolve(),
      catchUp: async () => {},
      dispose: () => {},
      listeners: new Set(),
    };

    const feed = openFoldFeed(kernel, session, asSeq(0), ({ event, head }) => {
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
      const entry = entries.get(session) ?? build(session, principal);
      const own = new Set<(state: FoldState) => void>();
      let released = false;
      let mine: { readonly shared: FoldState; readonly state: FoldState } | null = null;
      entries.set(session, entry);
      entry.holders += 1;
      clearTimeout(entry.linger);
      entry.linger = undefined;

      const as = (shared: FoldState): FoldState => {
        if (shared.principal === principal) return shared;

        if (mine?.shared !== shared) mine = { shared, state: { ...shared, principal } };

        return mine.state;
      };

      return {
        async ready() {
          await entry.ready;
          await entry.catchUp();
        },
        state: () => as(entry.state),
        subscribe(listener) {
          const relay = (state: FoldState) => listener(as(state));
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

          entry.linger = setTimeout(() => {
            if (entry.holders > 0) return;
            entry.dispose();

            if (entries.get(session) === entry) entries.delete(session);
          }, FOLD_LINGER);

          if (typeof entry.linger === "object") entry.linger.unref();
        },
      };
    },
  };
}

export function sessionEvents(
  kernel: Feeds,
  session: SessionId,
  after: Seq,
): AsyncIterable<FeedItem> {
  return closable<FeedItem>(() => {
    const pending = new Map<string, FeedItem>();

    const patches = new Map<
      string,
      PatchEvent | { readonly kind: "stream"; readonly part: PartId }
    >();

    const follow = ensureSessionFollow(kernel.follows, session);
    let cursor = after;
    let through: number = after;
    let page: readonly FeedItem[] = [];
    let offset = 0;
    let initialized = false;
    let seeded = false;
    let closed = false;
    let waiting: (() => void) | null = null;
    let failure: SdkError | null = null;

    const wake = (): void => {
      const resolve = waiting;
      waiting = null;
      resolve?.();
    };

    const retainPatch = (event: PatchEvent): void => {
      const key = `${"progress" in event ? "progress" : "text"}:${event.part}`;
      const previous = patches.get(key);

      const next =
        "append" in event && previous?.kind === "stream"
          ? previous
          : "append" in event && previous !== undefined && "append" in previous
            ? { ...event, append: previous.append + event.append }
            : "append" in event && previous !== undefined && "markdown" in previous
              ? { ...previous, markdown: previous.markdown + event.append }
              : event;

      patches.set(
        key,
        ("append" in next && next.append.length > LIVE_APPEND_LIMIT) ||
          ("markdown" in next && next.markdown.length > LIVE_APPEND_LIMIT)
          ? { kind: "stream", part: event.part }
          : next,
      );
    };

    const forgetPatch = (part: PartId): void => {
      patches.delete(`text:${part}`);
      patches.delete(`progress:${part}`);
    };

    const unsubscribe = kernel.bus.subscribe(session, (event, head) => {
      if (event.kind === "patch") {
        if (seeded) retainPatch(event);
      } else if (event.seq !== 0) {
        through = Math.max(through, event.seq);

        if (
          (event.kind === "part" && event.change !== "waiting" && event.change !== "answered") ||
          (event.kind === "call" && event.change === "settled")
        )
          forgetPatch(event.part);
        else if (event.kind === "commit" && event.body.kind === "part")
          forgetPatch(event.body.part);
      } else
        pending.set(
          event.kind === "background"
            ? JSON.stringify([event.kind, event.head, event.item.kind, event.item.id])
            : JSON.stringify([event.kind, event.head]),
          { event, head },
        );

      if (pending.size + patches.size > LIVE_PENDING_LIMIT) {
        failure = new SdkError("unavailable", "The session stream must resume from its cursor.");
        close();
      }

      wake();
    });

    follow.feeds += 1;

    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      follow.feeds -= 1;
      unfollow(kernel.follows, session, follow);
      page = [];
      pending.clear();
      patches.clear();
      wake();
    };

    return {
      async pull() {
        if (!initialized) {
          const tail = await kernel.store.refs.tail(session);

          if (closed) return DONE;
          through = Math.max(through, tail);
          follow.from ??= tail;
          initialized = true;
        }

        for (;;) {
          if (failure !== null) throw failure;

          if (closed) return DONE;
          const item = page[offset];

          if (item !== undefined) {
            offset += 1;

            if (item.event.kind !== "patch") cursor = item.event.seq;

            return { done: false, value: item };
          }

          page = [];
          offset = 0;

          if (cursor < through) {
            const events = await kernel.store.refs.log(
              session,
              cursor,
              Math.min(LOG_PAGE, through - cursor),
            );

            if (closed) return DONE;

            if (events.length === 0)
              throw new SdkError("internal", "The session log is missing events after its cursor.");
            page = await paired(kernel, session, events, null);

            if (closed) return DONE;
            continue;
          }

          if (!seeded) {
            seeded = true;
            const seed = { seq: asSeq(0), at: Date.now(), head: null };
            pending.set(JSON.stringify(["activation", null]), {
              event: { ...seed, kind: "activation", activation: kernel.activation(session) },
              head: null,
            });
            pending.set(JSON.stringify(["catalog", null]), {
              event: { ...seed, kind: "catalog", catalog: kernel.catalog(session) },
              head: null,
            });

            for (const { head, item } of [
              ...kernel.jobs.background(session),
              ...kernel.pages.background(session),
            ])
              pending.set(JSON.stringify(["background", head, item.kind, item.id]), {
                event: { ...seed, head, kind: "background", item },
                head: null,
              });

            for (const [part, live] of kernel.streams.get(session) ?? []) {
              if (live.markdown !== null)
                retainPatch({ kind: "patch", part, markdown: live.markdown });

              if (live.progress !== null)
                retainPatch({ kind: "patch", part, progress: live.progress });
            }

            if (pending.size + patches.size > LIVE_PENDING_LIMIT) {
              failure = new SdkError(
                "unavailable",
                "The session stream must resume from its cursor.",
              );
              close();
              continue;
            }
          }

          const next = pending.entries().next();

          if (!next.done) {
            pending.delete(next.value[0]);

            return { done: false, value: next.value[1] };
          }

          const patch = patches.entries().next();

          if (!patch.done) {
            patches.delete(patch.value[0]);
            const event = patch.value[1];

            if (event.kind === "stream") {
              const live = kernel.streams.get(session)?.get(event.part);

              if (live?.markdown === null || live?.markdown === undefined) continue;

              return {
                done: false,
                value: {
                  event: { kind: "patch", part: event.part, markdown: live.markdown },
                  head: null,
                },
              };
            }

            return { done: false, value: { event, head: null } };
          }

          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
        }
      },
      close,
    };
  });
}

export async function publishSet(
  kernel: Pick<Kernel, "store" | "bus" | "follows">,
  updates: readonly RefUpdate[],
  outcome: SetOutcome,
): Promise<void> {
  if (outcome.kind !== "set") return;
  const counts = new Map<SessionId, number>();
  let last: SessionId | null = null;

  for (const update of updates) {
    const session = update.event === undefined ? null : parseSessionRef(update.name);

    if (session === null) continue;
    counts.set(session, (counts.get(session) ?? 0) + 1);
    last = session;
  }

  const written = new Map<HeadName, HeadPair>();

  for (const [index, update] of updates.entries()) {
    const head = parseHeadRef(update.name);
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
    const follow = ensureSessionFollow(kernel.follows, session);
    follow.publishing += 1;

    try {
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
    } finally {
      follow.publishing -= 1;
      unfollow(kernel.follows, session, follow);
    }
  }
}

export async function followLog(
  kernel: Pick<Kernel, "store" | "bus" | "follows">,
  session: SessionId,
  from: Seq,
  known: { readonly through: Seq; readonly heads: ReadonlyMap<HeadName, HeadPair> } | null = null,
): Promise<void> {
  const follow = ensureSessionFollow(kernel.follows, session);
  follow.publishing += 1;

  try {
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
  } finally {
    follow.publishing -= 1;
    unfollow(kernel.follows, session, follow);
  }
}

export async function advanceSeen(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
    readonly commit: CommitId | null;
  },
): Promise<void> {
  const name = seenRef(input.session, input.principal, input.head);
  const record: SeenRecord = { commit: input.commit };

  await attempt(`Marking ${input.head} seen`, async () => {
    const ref = await kernel.store.refs.get(name);
    const mark = (await load(kernel, ref, decodeSeenRecord))?.record.commit ?? null;

    if (ref !== null && mark === input.commit) return true;

    if (
      mark !== null &&
      (await withFold(kernel, input.session, (state) => {
        const tip = state.heads.get(input.head)?.info.tip ?? START;

        return (
          walkCommitPath(state.commits, readPositionCommit(tip)).includes(mark) &&
          (input.commit === null || walkCommitPath(state.commits, mark).includes(input.commit))
        );
      }))
    )
      return true;

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel, "seen", record),
        expect: readRefExpectation(ref),
        event: {
          head: input.head,
          kind: "seen",
          principal: input.principal,
          commit: input.commit,
        },
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });
}

export function seenWriter(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
  },
) {
  let pending: { readonly tip: CommitId | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const next = pending;
    pending = null;

    if (next === null) return writing;

    writing = writing
      .then(() => advanceSeen(kernel, { ...input, commit: next.tip }))
      .catch((error: unknown) =>
        dev("watch", "seen failed", {
          session: input.session,
          head: input.head,
          error: String(error),
        }),
      );

    return writing;
  };

  return {
    note(tip: CommitId | null) {
      pending = { tip };
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), SEEN_DELAY);
    },
    flush,
  };
}

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

    const current =
      event.kind === "part" || event.kind === "call" ? parts.get(event.part) : undefined;

    if (event.kind === "part" && event.change === "created")
      parts.set(event.part, {
        run: event.run,
        markdown: readStateMarkdown(event.state),
        progress: null,
      });
    else if (event.kind === "part" && event.change === "updated" && current !== undefined)
      parts.set(event.part, {
        ...current,
        markdown: readStateMarkdown(event.state),
        progress: null,
      });
    else if (event.kind === "call" && event.change === "intent" && current !== undefined)
      parts.set(event.part, { ...current, markdown: null, progress: null });
    else if (
      (event.kind === "part" &&
        event.change !== "updated" &&
        event.change !== "waiting" &&
        event.change !== "answered") ||
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

function openFoldFeed(
  kernel: Feeds,
  session: SessionId,
  after: Seq,
  push: (item: FeedItem) => void,
) {
  const buffered: FeedItem[] = [];
  const follow = ensureSessionFollow(kernel.follows, session);
  let building = true;
  let open = true;
  let through: number = after;

  const deliver = (item: FeedItem): void => {
    if (!open) return;
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
    unfollow(kernel.follows, session, follow);
  };

  const catchUp = async (): Promise<void> => {
    while (open) {
      const events = await kernel.store.refs.log(session, asSeq(through), LOG_PAGE);

      if (!open) return;

      for (const item of await paired(kernel, session, events, null)) deliver(item);

      if (events.length < LOG_PAGE) return;
    }
  };

  const ready = (async () => {
    try {
      await catchUp();

      if (!open) return;

      follow.from ??= asSeq(through);

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

      if (open) {
        for (const item of buffered.splice(0)) deliver(item);

        for (const [part, live] of kernel.streams.get(session) ?? []) {
          if (live.markdown !== null)
            push({ event: { kind: "patch", part, markdown: live.markdown }, head: null });

          if (live.progress !== null)
            push({ event: { kind: "patch", part, progress: live.progress }, head: null });
        }
      }
    }
  })();

  return { ready, catchUp, dispose };
}

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
        async (head) =>
          [head, readHeadPair(await kernel.store.refs.get(headRef(session, head)))] as const,
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

function readHeadPair(ref: Ref | null): HeadPair {
  return ref === null || ref.target === null
    ? { tip: null, revision: EMPTY_REVISION }
    : { tip: asId<"commit">(ref.target), revision: ref.revision };
}

function readStateMarkdown(state: Json): string | null {
  return isJsonObject(state) && typeof state.markdown === "string" ? state.markdown : null;
}

function movedHead(event: SessionEvent | PatchEvent): HeadName | null {
  return event.kind === "commit" || event.kind === "head" ? event.head : null;
}

function ensureSessionFollow(follows: Map<SessionId, Follow>, session: SessionId): Follow {
  const follow = follows.get(session) ?? { feeds: 0, from: null, published: null, publishing: 0 };
  follows.set(session, follow);

  return follow;
}

function unfollow(follows: Map<SessionId, Follow>, session: SessionId, follow: Follow): void {
  if (follow.feeds === 0 && follow.publishing === 0 && follows.get(session) === follow)
    follows.delete(session);
}

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
    const seen = seenWriter(kernel, input);
    let states: AsyncIterator<FoldState> | null = null;
    let closed = false;
    let shown: SessionView | null = null;
    let marked: CommitId | null | undefined;

    return {
      async pull() {
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

          if (head !== undefined && tip !== readSeenCommit(state, input.head) && tip !== marked) {
            marked = tip;
            seen.note(tip);
          }

          return { done: false, value: view };
        }
      },
      close() {
        closed = true;
        void states?.return?.();
        hold.release();

        return seen.flush();
      },
    };
  });
}

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

export function pollStore(kernel: Kernel): Disposer {
  const every = kernel.poll;

  if (every === null) return () => undefined;
  let running = false;
  let stopped = false;

  const pass = async (): Promise<void> => {
    for (const [session, follow] of Array.from(kernel.follows)) {
      if (follow.feeds === 0 || follow.from === null || stopped) continue;
      await followLog(kernel, session, follow.from);
    }

    if (stopped) return;
    await kernel.waits.settleFromStore();
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

export async function rereadFences(kernel: Kernel): Promise<void> {
  for (const [run, session] of Array.from(kernel.driving)) {
    if (kernel.runs.isStopping(run)) continue;

    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found !== null && !found.record.stopping) continue;
    dev("poll", "fenced", { session, run });
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
  }
}
