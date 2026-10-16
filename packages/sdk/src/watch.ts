import type {
  Disposer,
  HeadName,
  HostView,
  HostViewWire,
  Message,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import { closable, coalesce } from "@nyte-ai/core";
import { applyViewFrame } from "@nyte-ai/protocol";
import type { JournalLoop } from "./journal.ts";
import type { Rows } from "./rows.ts";

export type Sink<T> = {
  next(value: T): void;
  end(): void;
  fail(error: Error): void;
};

const DONE = { done: true, value: undefined } as const;

/** One `head.watch` shared by every watcher of a head in this client: the latest view and its subscribers. */
export interface ViewHold {
  view(): SessionView | null;
  subscribe(sink: Sink<SessionView>): Disposer;
}

/** Returns the client's open `head.watch`es, one per head and tail, each closed when its last watcher leaves. */
export interface HeadViews {
  acquire(session: SessionId, head: HeadName, options?: ViewOptions): ViewHold;
}

/** Returns the head watches of one client over `rows`: a hold applies the host's frames in order, a reconnect starting again from the whole view the host sends. */
export function createHeadViews(rows: Rows): HeadViews {
  const open = new Map<string, ViewHold>();

  const start = (
    key: string,
    session: SessionId,
    head: HeadName,
    options: ViewOptions | undefined,
  ): ViewHold => {
    const sinks = new Set<Sink<SessionView>>();
    let view: SessionView | null = null;
    const frames = rows.watch("head.watch", { session, head, options })[Symbol.asyncIterator]();

    const finish = (end: (sink: Sink<SessionView>) => void): void => {
      if (open.get(key) === hold) open.delete(key);

      for (const sink of sinks) end(sink);
    };

    void (async () => {
      try {
        for (;;) {
          const next = await frames.next();

          if (next.done === true) break;
          const current = applyViewFrame(view, next.value);
          view = current;

          for (const sink of sinks) sink.next(current);
        }

        finish((sink) => sink.end());
      } catch (error) {
        finish((sink) => sink.fail(error instanceof Error ? error : new Error(String(error))));
      }
    })();

    const hold: ViewHold = {
      view: () => view,
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
    acquire(session, head, options) {
      const key = JSON.stringify([session, head, options?.tail ?? null]);
      const known = open.get(key);

      if (known !== undefined) return known;
      const created = start(key, session, head, options);
      open.set(key, created);

      return created;
    },
  };
}

/** Returns a head's views from its shared hold, each with the journal's unsent messages for the head merged in. */
export function watchHead(
  views: HeadViews,
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
      const hold = views.acquire(session, head, options);
      let shown: SessionView | null = null;

      const emit = (): void => {
        const view = hold.view();

        if (view === null) return;
        journal.landed(session, head, view);
        const ids = new Set(view.messages.map((message) => message.id));
        const next = withUnsent(view, journal.unsent(session, head), (id) => ids.has(id));

        if (next === shown) return;
        shown = next;
        sink.next(next);
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
          sink.fail(error instanceof Error ? error : new Error(String(error)));
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
  };
}

function pushed<T>(start: (sink: Sink<T>) => () => void): AsyncIterable<T> {
  return closable<T>(() => {
    let slot: { readonly value: T } | null = null;
    let ending: { readonly error: Error } | "ended" | null = null;
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
