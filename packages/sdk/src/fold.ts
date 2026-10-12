import type {
  Disposer,
  HeadName,
  HostView,
  HostViewWire,
  Message,
  PrincipalId,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import { closable, coalesce, emptyFold, fold, project, withPair } from "@nyte-ai/core";
import type { FoldState } from "@nyte-ai/core";
import type { OperationOutput } from "@nyte-ai/protocol";
import type { JournalLoop } from "./journal.ts";
import type { Rows } from "./rows.ts";

/** Receives the values a pushed stream yields: the newest wins, then its end or its failure. */
export type Sink<T> = {
  next(value: T): void;
  end(): void;
  fail(error: unknown): void;
};

const DONE = { done: true, value: undefined } as const;

/** Holds one head's client fold while a watcher needs it: its state once the feed is live (null before), and its changes, end and failure. */
export interface FoldHold {
  state(): FoldState | null;
  subscribe(sink: Sink<FoldState>): Disposer;
}

/** Returns a connection's folds: one per `(session, head)`, shared by its watchers. */
export interface Folds {
  acquire(session: SessionId, head: HeadName): FoldHold;
}

/**
 * Returns a connection's shared folds (§47f): the first watcher of a
 * `(session, head)` opens its `head.watch` and folds it on the client with
 * core's fold (remote carries deltas, never views); later watchers join it,
 * and the last one leaving closes the request and drops the fold.
 *
 * A head-moving event is offered only with the pair frame that follows it
 * (§40s, §54a); a logged event at or
 * below the last folded seq is dropped, so a resumed watch neither misses
 * nor repeats. The state is offered once the feed is live (the first seq-0
 * seed or patch), so history arrives as one view.
 */
export function createFolds(rows: Rows, principal: PrincipalId): Folds {
  const open = new Map<string, FoldHold>();

  const start = (session: SessionId, head: HeadName, key: string): FoldHold => {
    const sinks = new Set<Sink<FoldState>>();
    let state = emptyFold({ session, principal });
    let live = false;
    let unpaired = false;
    const frames = rows.watch("head.watch", { session, head })[Symbol.asyncIterator]();

    const finish = (end: (sink: Sink<FoldState>) => void): void => {
      if (open.get(key) === hold) open.delete(key);

      for (const sink of sinks) end(sink);
    };

    void (async () => {
      try {
        for (;;) {
          const next = await frames.next();

          if (next.done === true) break;
          const frame = next.value;
          state = applied(state, frame);

          if (frame.kind === "patch" || (frame.kind !== "revision" && frame.seq === 0)) live = true;
          unpaired = (frame.kind === "commit" || frame.kind === "head") && frame.head !== null;

          if (live && !unpaired) for (const sink of sinks) sink.next(state);
        }

        finish((sink) => sink.end());
      } catch (error) {
        finish((sink) => sink.fail(error));
      }
    })();

    const hold: FoldHold = {
      state: () => (live ? state : null),
      subscribe(sink) {
        sinks.add(sink);

        return () => {
          sinks.delete(sink);

          if (sinks.size > 0) return;

          if (open.get(key) === hold) open.delete(key);
          void frames.return?.();
        };
      },
    };

    return hold;
  };

  return {
    acquire(session, head) {
      const key = JSON.stringify([session, head]);
      const known = open.get(key);

      if (known !== undefined) return known;
      const created = start(session, head, key);
      open.set(key, created);

      return created;
    },
  };
}

/**
 * Yields a head's view on every change from the connection's shared fold
 * for it, projected with this watcher's options. The journal's unsent sends
 * for the head are merged as `unsent` user messages; views are coalesced to
 * one per 16 ms frame. `return()` leaves the fold.
 */
export function watchHead(
  folds: Folds,
  journal: JournalLoop,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly options?: ViewOptions;
  },
): AsyncIterable<SessionView> {
  return coalesce(
    pushed<SessionView>((sink) => {
      const { session, head, options } = input;
      const hold = folds.acquire(session, head);
      let shown: SessionView | null = null;

      const emit = (): void => {
        const state = hold.state();

        if (state === null) return;
        const view = withUnsent(project(state, head, options), journal, session, head, state);

        if (view === shown) return;
        shown = view;
        sink.next(view);
      };

      const leave = hold.subscribe({
        next: emit,
        end: () => sink.end(),
        fail: (error) => sink.fail(error),
      });

      const unsubscribe = journal.subscribe(emit);
      emit();

      return () => {
        unsubscribe();
        leave();
      };
    }),
  );
}

/**
 * Yields the host view whenever it changes, over `connection.watch` across
 * link loss: `authority` rebuilt as a `Set`, and `link` the client's own
 * state (the host's frame carries none), yielded again whenever it moves.
 *
 * A closed link yields its last view once more, then ends. Coalesced to one
 * view per 16 ms frame.
 */
export function watchHost(rows: Rows): AsyncIterable<HostView> {
  return coalesce(
    pushed<HostView>((sink) => {
      let view: HostView | null = null;
      const frames = rows.watch("connection.watch", {})[Symbol.asyncIterator]();

      void (async () => {
        try {
          for (;;) {
            const next = await frames.next();

            if (next.done === true) break;
            view = hostView(next.value, rows.link.current());
            sink.next(view);
          }

          sink.end();
        } catch (error) {
          sink.fail(error);
        }
      })();

      const unsubscribe = rows.link.subscribe((link) => {
        if (view !== null) {
          view = { ...view, link };
          sink.next(view);
        }

        if (link.kind === "closed") sink.end();
      });

      return () => {
        unsubscribe();
        void frames.return?.();
      };
    }),
  );
}

/** Returns a view with the journal's unsent sends for its head placed before its first pending user message, or the same view when there are none. The journal is first told which answered sends the view carries (they land and leave it), and a send the view already carries is not shown twice. */
export function withUnsent(
  view: SessionView,
  journal: JournalLoop,
  session: SessionId,
  head: HeadName,
  state: FoldState | null,
): SessionView {
  if (journal.unsent(session, head).length === 0) return view;

  const known = (id: Message["id"]): boolean =>
    state === null ? view.messages.some((message) => message.id === id) : state.messages.has(id);

  journal.landed(known);
  const missing = journal.unsent(session, head).filter((message) => !known(message.id));

  if (missing.length === 0) return view;

  const at = view.messages.findIndex(
    (message) => message.kind === "user" && message.status.kind === "pending",
  );

  const index = at < 0 ? view.messages.length : at;

  return {
    ...view,
    messages: [...view.messages.slice(0, index), ...missing, ...view.messages.slice(index)],
  };
}

/** Returns the fold state after one `head.watch` frame: a revision frame applies its head's pair, a logged event already folded is dropped, anything else is folded. */
function applied(state: FoldState, frame: OperationOutput<"head.watch">): FoldState {
  if (frame.kind === "revision") return withPair(state, frame.head, frame);

  if (frame.kind !== "patch" && frame.seq > 0 && frame.seq <= state.seq) return state;

  return fold(state, frame);
}

function hostView(wire: HostViewWire, link: HostView["link"]): HostView {
  return {
    id: wire.id,
    link,
    name: wire.name,
    platform: wire.platform,
    version: wire.version,
    catalog: wire.catalog,
    plugins: wire.plugins,
    settings: wire.settings,
    authority: new Set(wire.authority),
    operations: wire.operations,
  };
}

/** Returns a stream fed by `start` through a sink, opened on the first pull: the newest value pushed since the last pull wins, then the end or the failure. `return()` runs the disposer `start` returned. */
function pushed<T>(start: (sink: Sink<T>) => () => void): AsyncIterable<T> {
  return closable<T>(() => {
    let slot: { readonly value: T } | null = null;
    let ending: { readonly error: unknown } | "ended" | null = null;
    let wake: (() => void) | null = null;

    const signal = (): void => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    const stop = start({
      next(value) {
        if (ending !== null) return;
        slot = { value };
        signal();
      },
      end() {
        ending ??= "ended";
        signal();
      },
      fail(error) {
        ending ??= { error };
        signal();
      },
    });

    return {
      async pull(): Promise<IteratorResult<T>> {
        for (;;) {
          const held = slot;

          if (held !== null) {
            slot = null;

            return { done: false, value: held.value };
          }

          if (ending === "ended") return DONE;

          if (ending !== null) throw ending.error;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
      close: stop,
    };
  });
}
