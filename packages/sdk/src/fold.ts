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

export type Sink<T> = {
  next(value: T): void;
  end(): void;
  fail(error: unknown): void;
};

const DONE = { done: true, value: undefined } as const;

const PARKED_FOLDS = 16;

const PARKED_LINGER = 30_000;

export interface FoldHold {
  state(): FoldState | null;
  subscribe(sink: Sink<FoldState>): Disposer;
}

export interface Folds {
  acquire(session: SessionId, head: HeadName): FoldHold;
}

export function createFolds(rows: Rows, principal: PrincipalId): Folds {
  const open = new Map<string, FoldHold>();

  const parked = new Map<
    string,
    { readonly state: FoldState; readonly timer: ReturnType<typeof setTimeout> }
  >();

  rows.link.signal.addEventListener(
    "abort",
    () => {
      for (const entry of parked.values()) clearTimeout(entry.timer);
      parked.clear();
    },
    { once: true },
  );

  const start = (session: SessionId, head: HeadName, key: string): FoldHold => {
    const sinks = new Set<Sink<FoldState>>();
    const resumed = parked.get(key);
    clearTimeout(resumed?.timer);
    parked.delete(key);
    let state = resumed?.state ?? emptyFold({ session, principal });
    let live = false;
    let unpaired = false;
    let closed = false;

    const frames = rows
      .watch(
        "head.watch",
        resumed === undefined ? { session, head } : { session, head, after: resumed.state.seq },
      )
      [Symbol.asyncIterator]();

    const finish = (end: (sink: Sink<FoldState>) => void): void => {
      if (open.get(key) === hold) open.delete(key);

      for (const sink of sinks) end(sink);
    };

    void (async () => {
      try {
        for (;;) {
          const next = await frames.next();

          if (next.done === true || closed) break;
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
          closed = true;

          if (open.get(key) === hold) {
            open.delete(key);

            if (live && !rows.link.signal.aborted) {
              const timer = setTimeout(() => parked.delete(key), PARKED_LINGER);

              if (typeof timer === "object") timer.unref();
              parked.set(key, { state, timer });

              for (const [oldest, entry] of parked) {
                if (parked.size <= PARKED_FOLDS) break;
                clearTimeout(entry.timer);
                parked.delete(oldest);
              }
            }
          }

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
        const known = (id: Message["id"]): boolean => state.messages.has(id);
        journal.landed(known);

        const view = withUnsent(
          project(state, head, options),
          journal.unsent(session, head),
          known,
        );

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

export function withUnsent(
  view: SessionView,
  unsent: readonly Message[],
  known: (id: Message["id"]) => boolean,
): SessionView {
  const over = new Map(unsent.map((message) => [message.id, message]));
  const missing = unsent.filter((message) => !known(message.id));

  if (missing.length === 0 && !view.messages.some((message) => over.has(message.id))) return view;
  const messages = view.messages.map((message) => over.get(message.id) ?? message);

  const at = messages.findIndex(
    (message) => message.kind === "user" && message.status.kind === "pending",
  );

  const index = at < 0 ? messages.length : at;

  return {
    ...view,
    messages: [...messages.slice(0, index), ...missing, ...messages.slice(index)],
  };
}

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
