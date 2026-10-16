import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Disposer,
  HeadName,
  Json,
  PartId,
  PatchEvent,
  PrincipalId,
  Ref,
  RefUpdate,
  Seq,
  SessionEvent,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import type {
  FeedItem,
  FoldCache,
  FoldState,
  Follow,
  HeadPair,
  LiveStream,
  SessionBus,
} from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import { settleAnswersFrom } from "../store/parts.ts";
import { headRef, parseHeadRef, parseSessionRef, runRef } from "../store/refs.ts";
import { EMPTY_REVISION, load } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { closable, DONE } from "../util/iterable.ts";
import { isJsonObject } from "../util/json-schema.ts";
import { emptyFold, fold, withPair } from "./fold.ts";

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
