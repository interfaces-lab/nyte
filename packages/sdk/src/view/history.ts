import type { Message, SessionView, TurnInfo } from "@nyte-ai/schema";
import type { Head } from "@nyte-ai/core";

type Pageable = Pick<SessionView, "messages" | "turns" | "leadingPrompt">;

export interface Pages<V extends Pageable> {
  show(view: V): V;
  earlier(limit: number): Promise<number>;
}

export function pages<V extends Pageable>(history: Head["history"]): Pages<V> {
  let paged: readonly Message[] = [];
  let turns: readonly TurnInfo[] = [];
  let leadingPrompt: SessionView["leadingPrompt"] = null;
  let latest: V | null = null;
  let shown: V | null = null;
  let loading: Promise<number> | null = null;
  let exhausted: Message["id"] | null = null;

  const show = (view: V): V => {
    if (view === latest && shown !== null) return shown;
    const first = view.messages[0];
    const moved = first === undefined || first.id !== latest?.messages[0]?.id;
    const previous = moved || latest === null || shown === null ? null : { view: latest, shown };

    if (moved) {
      const before = shown?.messages ?? [];
      const kept =
        first === undefined ? -1 : before.findIndex((message) => message.id === first.id);
      paged =
        kept < 0
          ? []
          : before
              .slice(0, kept)
              .filter((message) => message.kind !== "user" || message.status.kind !== "unsent");
      leadingPrompt = shown?.leadingPrompt ?? null;
      const pagedTurns = new Set(paged.map((message) => message.turn));
      turns = (shown?.turns ?? []).filter((turn) => pagedTurns.has(turn.id));
    }

    if (view.leadingPrompt !== null && view.leadingPrompt.id === leadingPrompt?.id) {
      leadingPrompt = view.leadingPrompt;
    }

    latest = view;
    shown =
      paged.length === 0 ? view : withPages(view, { pages: paged, turns, leadingPrompt }, previous);

    return shown;
  };

  const load = async (limit: number): Promise<number> => {
    const oldest = shown?.messages[0];

    if (oldest === undefined || oldest.id === exhausted) return 0;
    const page = await history({ before: oldest.id, limit });
    const current = latest;

    if (page.messages.length === 0) {
      exhausted = oldest.id;

      return 0;
    }

    if (current === null || shown?.messages[0]?.id !== oldest.id) return 0;
    const known = new Set(turns.map((turn) => turn.id));
    paged = [...page.messages, ...paged];
    turns = [...page.turns.filter((turn) => !known.has(turn.id)), ...turns];
    leadingPrompt = page.leadingPrompt;
    shown = withPages(current, { pages: paged, turns, leadingPrompt }, null);

    return page.messages.length;
  };

  return {
    show,
    earlier(limit) {
      loading ??= load(limit).finally(() => {
        loading = null;
      });

      return loading;
    },
  };
}

function withPages<V extends Pageable>(
  view: V,
  paged: Pick<SessionView, "turns" | "leadingPrompt"> & { readonly pages: readonly Message[] },
  previous: { readonly view: V; readonly shown: V } | null,
): V {
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
