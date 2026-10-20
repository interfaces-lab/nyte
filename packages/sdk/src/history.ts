import type { Message, SessionView, TurnInfo, ViewOptions } from "@nyte-ai/schema";
import type { Head } from "@nyte-ai/core";
import { pushed } from "./watch.ts";

/** A head's views with its older messages paged in on demand: each view's `messages` are the pages `earlier` loaded, then the messages the watch carries, its `turns` the pages' turns before the watch's, and its `leadingPrompt` the prompt of the turn its first message belongs to when that prompt is not among its messages. A view whose messages and turns are the ones the view before it carried keeps that view's arrays. Iterate it once. */
export interface PagedViews extends AsyncIterable<SessionView> {
  /** Loads up to `limit` messages before the oldest one shown into the views, and resolves how many came: 0 once the head's first message is shown, asking the host only the first time. A call while one loads waits for that one. */
  earlier(limit: number): Promise<number>;
}

/**
 * Returns `head`'s views, older messages paged in through `head.history`. A
 * view keeps every message shown before its own first one, so messages that
 * leave the watch's window stay; a view whose first message was never shown
 * (the head moved, or the window jumped past the pages) drops the pages.
 */
export function pagedViews(
  head: Pick<Head, "watch" | "history">,
  options?: ViewOptions,
): PagedViews {
  let pages: readonly Message[] = [];
  let turns: readonly TurnInfo[] = [];
  let leadingPrompt: SessionView["leadingPrompt"] = null;
  let latest: SessionView | null = null;
  let shown: SessionView | null = null;
  let push: ((view: SessionView) => void) | null = null;
  let loading: Promise<number> | null = null;
  let exhausted: Message["id"] | null = null;

  const show = (view: SessionView): void => {
    const first = view.messages[0];
    const moved = first === undefined || first.id !== latest?.messages[0]?.id;
    const previous = moved || latest === null || shown === null ? null : { view: latest, shown };

    if (moved) {
      const before = shown?.messages ?? [];
      const kept =
        first === undefined ? -1 : before.findIndex((message) => message.id === first.id);
      pages = kept < 0 ? [] : before.slice(0, kept);
      leadingPrompt = shown?.leadingPrompt ?? null;
      const paged = new Set(pages.map((message) => message.turn));
      turns = (shown?.turns ?? []).filter((turn) => paged.has(turn.id));
    }

    if (view.leadingPrompt !== null && view.leadingPrompt.id === leadingPrompt?.id)
      leadingPrompt = view.leadingPrompt;

    latest = view;
    shown = pages.length === 0 ? view : withPages(view, { pages, turns, leadingPrompt }, previous);
    push?.(shown);
  };

  const load = async (limit: number): Promise<number> => {
    const oldest = shown?.messages[0];

    if (oldest === undefined || oldest.id === exhausted) return 0;
    const page = await head.history({ before: oldest.id, limit });
    const current = latest;

    if (page.messages.length === 0) {
      exhausted = oldest.id;

      return 0;
    }

    if (current === null || shown?.messages[0]?.id !== oldest.id) return 0;
    const known = new Set(turns.map((turn) => turn.id));
    pages = [...page.messages, ...pages];
    turns = [...page.turns.filter((turn) => !known.has(turn.id)), ...turns];
    leadingPrompt = page.leadingPrompt;
    shown = withPages(current, { pages, turns, leadingPrompt }, null);
    push?.(shown);

    return page.messages.length;
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

function withPages(
  view: SessionView,
  paged: Pick<SessionView, "turns" | "leadingPrompt"> & { readonly pages: readonly Message[] },
  previous: { readonly view: SessionView; readonly shown: SessionView } | null,
): SessionView {
  return {
    ...view,
    messages:
      previous?.view.messages === view.messages
        ? previous.shown.messages
        : [...paged.pages, ...view.messages],
    leadingPrompt: paged.leadingPrompt,
    turns:
      previous?.view.turns === view.turns
        ? previous.shown.turns
        : pagedTurns(paged.turns, view.turns),
  };
}

function pagedTurns(paged: readonly TurnInfo[], own: readonly TurnInfo[]): readonly TurnInfo[] {
  const ids = new Set(own.map((turn) => turn.id));

  return [...paged.filter((turn) => !ids.has(turn.id)), ...own];
}
