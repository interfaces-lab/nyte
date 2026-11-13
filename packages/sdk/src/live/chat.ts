import type { Disposer } from "@nyte-ai/schema";
import type { UnsentSends } from "../send/unsent.ts";
import { headView } from "../view/head-view.ts";
import type { HeadView } from "../view/head-view.ts";
import { streamText, withStreamedText } from "../view/streamed-text.ts";
import type { StreamedText } from "../view/streamed-text.ts";
import type { HeadStore } from "./head.ts";
import type { TextUpdate } from "./host-connection.ts";
import type { Freshness, Live } from "./store.ts";

export interface ChatSnapshot {
  /** The head's view with its unsent sends and streamed text laid in, or `null` until the head's first read lands. */
  readonly view: HeadView | null;
  /** The seq `view`'s rows are current through: the last fresh seq, kept while the store is stale, and 0 before the first read. */
  readonly seq: number;
  readonly freshness: Freshness;
}

export type ChatStore = Live<ChatSnapshot>;

export interface ChatOptions {
  readonly tail: number;
  readonly unsent?: UnsentSends;
}

type Opened = { readonly head: HeadStore; readonly stops: readonly Disposer[] };

/**
 * Returns the store a client draws a chat from: the head store `open` returns, with `unsent`'s sends
 * and the text `text` streams laid over its view. The store holds nothing until its first listener:
 * that one opens the head store and the text subscription, and the last to leave closes both and
 * returns the store to its first snapshot. `snapshot()` returns the same object until the drawn view
 * or the freshness changes, and listeners hear only of a new snapshot, so a text frame for a part
 * this view does not hold changes nothing. The text map is the store's own, pruned by
 * `withStreamedText` as each view is laid.
 */
export function openChatStore(
  open: () => HeadStore,
  text: (listener: (update: TextUpdate) => void) => Disposer,
  unsent: UnsentSends | undefined,
): ChatStore {
  const listeners = new Set<() => void>();
  let opened: Opened | null = null;
  let texts: StreamedText = new Map();
  let laid: HeadView | null = null;
  let snapshot = unopened();

  const show = (view: HeadView | null, freshness: Freshness): void => {
    if (view === snapshot.view && freshness === snapshot.freshness) return;
    snapshot = { view, seq: freshness.kind === "fresh" ? freshness.seq : snapshot.seq, freshness };

    for (const listener of listeners) listener();
  };

  const settle = (head: HeadStore): void => {
    const rows = head.snapshot();
    const freshness = head.freshness();
    const view = rows === null ? null : headView(rows);

    laid =
      view === null || unsent === undefined
        ? view
        : unsent.lay(view, freshness.kind === "fresh" ? freshness.seq : null);

    show(laid === null ? null : withStreamedText(laid, texts), freshness);
  };

  const stream = (update: TextUpdate): void => {
    texts = streamText(texts, update);

    if (laid !== null) show(withStreamedText(laid, texts), snapshot.freshness);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);

      if (opened === null) {
        const head = open();
        const changed = (): void => settle(head);
        const stops = [head.subscribe(changed), text(stream)];

        if (unsent !== undefined) stops.push(unsent.subscribe(changed));
        opened = { head, stops };
      }

      return () => {
        if (!listeners.delete(listener) || listeners.size > 0 || opened === null) return;

        for (const stop of opened.stops) stop();
        opened.head.close();
        opened = null;
        texts = new Map();
        laid = null;
        snapshot = unopened();
      };
    },
    snapshot: () => snapshot,
  };
}

function unopened(): ChatSnapshot {
  return { view: null, seq: 0, freshness: { kind: "stale", since: Date.now(), error: null } };
}
