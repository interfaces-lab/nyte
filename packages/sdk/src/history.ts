import type { Message, SessionView, ViewOptions } from "@nyte-ai/schema";
import type { Head } from "@nyte-ai/core";
import { pushed } from "./watch.ts";

/** A head's views with its older messages paged in on demand: each view's `messages` are the pages `earlier` loaded, then the messages the watch carries. Iterate it once. */
export interface PagedViews extends AsyncIterable<SessionView> {
  /** Loads up to `limit` messages before the oldest one shown into the views, and resolves how many came: 0 once the head's first message is shown. A call while one loads waits for that one. */
  earlier(limit: number): Promise<number>;
}

/**
 * Returns `head`'s views, older messages paged in through `head.history`. A
 * view keeps every message shown before its own first one, so messages that
 * leave the watch's window stay; a view whose first message was never shown
 * (the head moved, or the window jumped past the pages) drops the pages.
 */
export function pagedViews(head: Head, options?: ViewOptions): PagedViews {
  let pages: readonly Message[] = [];
  let latest: SessionView | null = null;
  let shown: SessionView | null = null;
  let push: ((view: SessionView) => void) | null = null;
  let loading: Promise<number> | null = null;

  const show = (view: SessionView): void => {
    const first = view.messages[0];
    const before = shown?.messages ?? [];
    const kept = first === undefined ? -1 : before.findIndex((message) => message.id === first.id);
    pages = kept < 0 ? [] : before.slice(0, kept);
    latest = view;
    shown = pages.length === 0 ? view : { ...view, messages: [...pages, ...view.messages] };
    push?.(shown);
  };

  const load = async (limit: number): Promise<number> => {
    const oldest = shown?.messages[0];

    if (oldest === undefined) return 0;
    const page = await head.history({ before: oldest.id, limit });
    const current = latest;

    if (page.length === 0 || current === null || shown?.messages[0]?.id !== oldest.id) return 0;
    pages = [...page, ...pages];
    shown = { ...current, messages: [...pages, ...current.messages] };
    push?.(shown);

    return page.length;
  };

  return {
    [Symbol.asyncIterator]: () =>
      pushed<SessionView>((sink) => {
        const views = head.watch(options)[Symbol.asyncIterator]();
        push = (view) => sink.next(view);

        void (async () => {
          try {
            for (;;) {
              const next = await views.next();

              if (next.done === true) break;
              show(next.value);
            }

            sink.end();
          } catch (error) {
            sink.fail(error instanceof Error ? error : new Error(String(error)));
          }
        })();

        return () => {
          push = null;
          void views.return?.();
        };
      })[Symbol.asyncIterator](),
    earlier(limit) {
      loading ??= load(limit).finally(() => {
        loading = null;
      });

      return loading;
    },
  };
}
