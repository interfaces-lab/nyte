import type { HostView, HostViewWire, Json, QueuedMessage, SessionView } from "@nyte-ai/schema";
import { closable, coalesce } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

export type Sink<T> = {
  next(value: T): void;
  end(): void;
  fail(error: Error): void;
};

const DONE = { done: true, value: undefined } as const;

export function watchHost(rows: Rows, opened?: AsyncIterator<Json>): AsyncIterable<HostView> {
  return coalesce(
    pushed<HostView>((sink) => {
      let view: HostView | null = null;
      const frames = rows.watch("connection.watch", {}, opened)[Symbol.asyncIterator]();

      void (async () => {
        try {
          for (;;) {
            const next = await frames.next();

            if (next.done === true) break;
            view = hostView(next.value, rows.link.current(), rows.operations());
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

export function withUnsent<
  V extends Pick<SessionView, "messages" | "queue" | "leadingPrompt" | "execution">,
>(view: V, unsent: readonly QueuedMessage[]): V {
  const lead = view.leadingPrompt?.id;
  const held = unsent.filter((message) => message.id !== lead);

  if (held.length === 0) return view;
  const over = new Map(held.map((message) => [message.id, message]));
  const known = new Set([...view.messages, ...view.queue].map((message) => message.id));
  const live = view.execution.kind !== "idle";

  const waiting = held.filter(
    (message) =>
      !known.has(message.id) &&
      ((message.status.kind === "unsent" && message.status.retrying !== null) ||
        (live && message.delivery !== "steer")),
  );

  const missing = held.filter((message) => !known.has(message.id) && !waiting.includes(message));
  const messages = view.messages.map((message) => over.get(message.id) ?? message);

  const at = messages.findIndex(
    (message) => message.kind === "user" && message.status.kind === "pending",
  );

  const index = at < 0 ? messages.length : at;

  return {
    ...view,
    messages: [...messages.slice(0, index), ...missing, ...messages.slice(index)],
    queue: [...view.queue.map((message) => over.get(message.id) ?? message), ...waiting],
  };
}

function hostView(wire: HostViewWire, link: HostView["link"], operations: string | null): HostView {
  return {
    id: wire.id,
    link,
    operations,
    name: wire.name,
    platform: wire.platform,
    version: wire.version,
    catalog: wire.catalog,
    plugins: wire.plugins,
    settings: wire.settings,
    views: wire.views,
    defaultWorkspace: wire.defaultWorkspace,
    projects: wire.projects,
    authority: new Set(wire.authority),
  };
}

export function pushed<T>(start: (sink: Sink<T>) => () => void): AsyncIterable<T> {
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
