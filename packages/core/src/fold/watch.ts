import { asId, asSeq, isJsonObject } from "@nyte-ai/schema";
import type {
  Disposer,
  HeadName,
  Json,
  PartId,
  PatchEvent,
  PrincipalId,
  Ref,
  RefUpdate,
  SessionEvent,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import type {
  FeedItem,
  FoldCache,
  FoldState,
  HeadPair,
  LiveStream,
  LoggedItem,
  LogPublisher,
  SessionBus,
} from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import { settleAnswersFrom } from "../store/parts.ts";
import { collectSessionEvents } from "../store/log.ts";
import { headRef, parseHeadRef, runRef } from "../store/refs.ts";
import { EMPTY_REVISION, load } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { serial } from "../util/serial.ts";
import type { Serial } from "../util/serial.ts";
import { emptyFold, fold } from "./fold.ts";
import { withPair } from "./project.ts";

type Entry = {
  state: FoldState;
  holders: number;
  linger: ReturnType<typeof setTimeout> | undefined;
  feed: FoldFeed;
  readonly listeners: Set<(state: FoldState) => void>;
};

/** The log and bus feeding one session's fold, every durable event once and in seq order. */
interface FoldFeed {
  readonly ready: Promise<void>;
  /** Reads what the log holds past the fold into it. */
  sync(): Promise<void>;
  /** Reads what the log holds past the fold and publishes it on the bus, for every subscriber of the session. */
  refresh(): Promise<void>;
  dispose(): void;
}

type Feeds = Pick<
  Kernel,
  "store" | "bus" | "publisher" | "streams" | "sessions" | "jobs" | "pages"
>;

/** One session's publishing: the last seq on the bus, the highest this process logged, and the publishes in line. */
type Sequence = {
  published: number | null;
  logged: number;
  readonly queue: Serial;
  linger: ReturnType<typeof setTimeout> | undefined;
};

const LOG_PAGE = 512;

const FOLD_LINGER = 30_000;

/** How long an unwatched session's publishing sequence outlives its last publish: long past any write of this process still on its way to the bus. */
const PUBLISH_LINGER = 30_000;

const NO_PAIRS: ReadonlyMap<HeadName, HeadPair> = new Map();

export function createFoldCache(kernel: Feeds): FoldCache {
  const entries = new Map<SessionId, Entry>();

  const build = (session: SessionId, principal: PrincipalId): Entry => {
    const entry: Entry = {
      state: emptyFold({ session, principal }),
      holders: 0,
      linger: undefined,
      feed: openFoldFeed(kernel, session, ({ event, head }) => {
        const folded = fold(entry.state, event);
        const name = movedHead(event);
        const next = head === null || name === null ? folded : withPair(folded, name, head);

        if (next === entry.state) return;
        entry.state = next;

        for (const listener of entry.listeners) listener(next);
      }),
      listeners: new Set(),
    };

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
          await entry.feed.ready;
          await entry.feed.sync();
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
            entry.feed.dispose();

            if (entries.get(session) === entry) entries.delete(session);
          }, FOLD_LINGER);

          if (typeof entry.linger === "object") entry.linger.unref();
        },
      };
    },
    folding: (session) => entries.has(session),
    async refresh() {
      await Promise.all(Array.from(entries.values(), (entry) => entry.feed.refresh()));
    },
  };
}

/** Publishes a set's events through the kernel's publisher as the set logged them, from the updates in hand: each event at the seq and time the store gave it, each head-moving event with its head's ref pair (the one this set wrote, else read). */
export async function publishSet(
  kernel: Pick<Kernel, "store" | "publisher">,
  updates: readonly RefUpdate[],
  outcome: SetOutcome,
): Promise<void> {
  if (outcome.kind !== "set") return;
  const written = new Map<SessionId, Map<HeadName, HeadPair>>();

  for (const [index, update] of updates.entries()) {
    const head = parseHeadRef(update.name);
    const revision = outcome.revisions[index];

    if (head === null || revision === undefined) continue;
    const heads = written.get(head.session) ?? new Map<HeadName, HeadPair>();
    written.set(head.session, heads);

    heads.set(
      head.head,
      update.target === null
        ? { tip: null, revision: EMPTY_REVISION }
        : { tip: asId<"commit">(update.target), revision },
    );
  }

  const logged = new Map<SessionId, SessionEvent[]>();

  for (const [index, { session, event }] of collectSessionEvents(updates).entries()) {
    const seq = outcome.logged[index];

    if (seq === undefined) continue;
    const events = logged.get(session) ?? [];
    logged.set(session, events);
    events.push({ ...event, seq, at: outcome.at });
  }

  for (const [session, events] of logged)
    kernel.publisher.logged(
      session,
      Math.min(...events.map((event) => event.seq)),
      Math.max(...events.map((event) => event.seq)),
    );

  for (const [session, events] of logged)
    await kernel.publisher.publish(
      session,
      await paired(kernel, session, events, written.get(session) ?? NO_PAIRS),
    );
}

/** Returns the kernel's {@link LogPublisher} over `bus`, reading gaps from `store`'s log. */
export function createLogPublisher(kernel: Pick<Kernel, "store" | "bus">): LogPublisher {
  const sessions = new Map<SessionId, Sequence>();

  const sequence = (session: SessionId, published: number | null = null): Sequence => {
    const found = sessions.get(session);

    if (found !== undefined) return found;
    const created: Sequence = {
      published,
      logged: 0,
      queue: serial(),
      linger: undefined,
    };
    sessions.set(session, created);

    return created;
  };

  const idle = (session: SessionId, state: Sequence): boolean =>
    sessions.get(session) === state &&
    !kernel.bus.watched(session) &&
    state.logged <= (state.published ?? 0);

  const forget = (session: SessionId): void => {
    const state = sessions.get(session);

    if (state === undefined || !idle(session, state)) return;
    clearTimeout(state.linger);

    state.linger = setTimeout(() => {
      if (!state.queue.busy && idle(session, state)) sessions.delete(session);
    }, PUBLISH_LINGER);

    if (typeof state.linger === "object") state.linger.unref();
  };

  kernel.bus.onUnwatched(forget);

  const emit = (session: SessionId, state: Sequence, item: LoggedItem): void => {
    if (state.published !== null && item.event.seq <= state.published) return;
    state.published = item.event.seq;
    kernel.bus.publish(session, item.event, item.head);
  };

  const fill = async (session: SessionId, state: Sequence, before: number): Promise<void> => {
    for (let from = state.published; from !== null && from + 1 < before;) {
      const events = await kernel.store.refs.log(session, asSeq(from), LOG_PAGE);
      const missing = events.filter((event) => event.seq < before);

      for (const item of await paired(kernel, session, missing, NO_PAIRS))
        emit(session, state, item);

      if (missing.length < LOG_PAGE) return;
      from = state.published;
    }
  };

  return {
    logged(session, from, through) {
      const state = sequence(session, from - 1);
      state.logged = Math.max(state.logged, through);
    },
    loggedThrough: (session) => sessions.get(session)?.logged ?? 0,
    publish(session, items) {
      const state = sequence(session);

      const published = state.queue.run(async () => {
        for (const item of items) {
          if (state.published !== null && item.event.seq > state.published + 1)
            await fill(session, state, item.event.seq).catch((error) =>
              dev("bus", "gap read failed", { session, error: String(error) }),
            );

          emit(session, state, item);
        }
      });

      void state.queue.settled().then(() => {
        if (!state.queue.busy) forget(session);
      });

      return published;
    },
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

function openFoldFeed(kernel: Feeds, session: SessionId, push: (item: FeedItem) => void): FoldFeed {
  let through = 0;
  let open = true;
  let held: FeedItem[] | null = [];
  let reading: Promise<void> = Promise.resolve();
  let mark: number | undefined;

  const deliver = (item: FeedItem): void => {
    const event = item.event;

    if (event.kind !== "patch" && event.seq !== 0) {
      if (event.seq <= through) return;
      through = event.seq;
    }

    push(item);
  };

  const readPast = async (): Promise<void> => {
    const reached = await kernel.store.commitMark?.();

    while (open) {
      const events = await kernel.store.refs.log(session, asSeq(through), LOG_PAGE);

      if (!open) return;

      for (const item of await paired(kernel, session, events, NO_PAIRS)) deliver(item);

      if (events.length < LOG_PAGE) {
        mark = reached;

        return;
      }
    }
  };

  const release = (): void => {
    const waiting = held ?? [];
    held = null;

    for (const item of waiting) accept(item);
  };

  const read = (waiting: FeedItem[]): Promise<void> => {
    held = waiting;

    reading = (async () => {
      try {
        await readPast();
      } finally {
        release();
      }
    })();

    return reading;
  };

  const accept = (item: FeedItem): void => {
    if (!open) return;

    if (held !== null) {
      held.push(item);

      return;
    }

    const event = item.event;

    if (event.kind === "patch" || event.seq <= through + 1) {
      deliver(item);

      return;
    }

    dev("fold", "gap", { session, through, seq: event.seq });
    read([item]).catch((error) =>
      dev("fold", "gap read failed", { session, error: String(error) }),
    );
  };

  const unsubscribe = kernel.bus.subscribe(session, (event, head) => accept({ event, head }));

  const ready = (async () => {
    try {
      await readPast();

      if (!open) return;

      const seed = { seq: asSeq(0), at: Date.now() };

      const events: SessionEvent[] = [
        {
          ...seed,
          head: null,
          kind: "activation",
          activation: kernel.sessions.activation(session),
        },
        { ...seed, head: null, kind: "catalog", catalog: kernel.sessions.catalog(session) },
        ...[...kernel.jobs.background(session), ...kernel.pages.background(session)].map(
          ({ head, item }): SessionEvent => ({ ...seed, head, kind: "background", item }),
        ),
      ];

      for (const event of events) deliver({ event, head: null });
    } finally {
      release();

      if (open)
        for (const [part, live] of kernel.streams.get(session) ?? []) {
          if (live.markdown !== null)
            push({ event: { kind: "patch", part, markdown: live.markdown }, head: null });

          if (live.progress !== null)
            push({ event: { kind: "patch", part, progress: live.progress }, head: null });
        }
    }
  })();

  reading = ready;

  return {
    ready,
    async sync() {
      if (held !== null) return reading;

      if (
        mark !== undefined &&
        through >= kernel.publisher.loggedThrough(session) &&
        mark === (await kernel.store.commitMark?.())
      )
        return;

      return held === null ? read([]) : reading;
    },
    async refresh() {
      const reached = await kernel.store.commitMark?.();
      let cursor = through;

      while (open) {
        const events = await kernel.store.refs.log(session, asSeq(cursor), LOG_PAGE);

        if (!open) return;

        await kernel.publisher.publish(
          session,
          await paired(
            kernel,
            session,
            events.filter((event) => event.seq > through),
            NO_PAIRS,
          ),
        );
        const last = events.at(-1);

        if (last === undefined || events.length < LOG_PAGE) {
          mark = reached;

          return;
        }

        cursor = last.seq;
      }
    },
    dispose() {
      open = false;
      unsubscribe();
    },
  };
}

async function paired(
  kernel: Pick<Kernel, "store">,
  session: SessionId,
  events: readonly SessionEvent[],
  written: ReadonlyMap<HeadName, HeadPair>,
): Promise<readonly LoggedItem[]> {
  const unknown = new Set(
    events.flatMap((event) => {
      const head = movedHead(event);

      return head === null || written.has(head) ? [] : [head];
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

    return { event, head: head === null ? null : (written.get(head) ?? read.get(head) ?? null) };
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

export function pollStore(kernel: Kernel): Disposer {
  const every = kernel.poll;

  if (every === null) return () => undefined;
  let running = false;
  let stopped = false;
  let seen: number | undefined;

  void kernel.store.commitMark?.().then((mark) => {
    seen ??= mark;
  });

  const readExternal = async (mark: number | undefined): Promise<void> => {
    await kernel.folds.refresh();

    if (stopped) return;
    await settleAnswersFrom(kernel);
    await rereadFences(kernel);
    await kernel.waits.refresh();
    seen = mark;

    for (const listener of kernel.externalCommits) listener();
  };

  const pass = async (): Promise<void> => {
    const mark = await kernel.store.commitMark?.();

    if (stopped) return;

    if (mark === undefined || mark !== seen)
      await readExternal(mark).catch((error) =>
        dev("poll", "external read failed", { error: String(error) }),
      );
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

async function rereadFences(kernel: Kernel): Promise<void> {
  for (const [run, session] of Array.from(kernel.driving)) {
    if (kernel.runs.signal(run)?.aborted === true) continue;

    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found !== null && !found.record.stopping) continue;
    dev("poll", "fenced", { session, run });
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
  }
}
