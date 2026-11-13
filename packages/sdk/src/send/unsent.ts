import type { Disposer, HeadName, QueuedMessage, SessionId } from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import { journals } from "../connection/client.ts";
import type { HeadView } from "../view/head-view.ts";
import { withUnsent } from "../connection/watch.ts";
import { sameJson } from "../live/store.ts";

export interface UnsentSends {
  subscribe(listener: () => void): Disposer;
  /** Lays the head's unsent sends over `view`, returning the view it returned last when `view` and the sends are unchanged. */
  lay(view: HeadView, seq: number | null): HeadView;
}

type Laid = {
  readonly view: HeadView;
  readonly unsent: readonly QueuedMessage[];
  readonly result: HeadView;
};

export function unsentSends(
  connection: Connection,
  session: SessionId,
  head: HeadName,
): UnsentSends {
  const journal = journals.get(connection);
  let last: Laid | null = null;

  if (journal === undefined) return { subscribe: () => () => undefined, lay: (view) => view };

  return {
    subscribe: (listener) => journal.subscribe(listener),
    lay(view, seq) {
      if (seq !== null) journal.landed(session, head, view, seq);
      const unsent = journal.unsent(session, head);

      if (last !== null && last.view === view && sameJson(last.unsent, unsent)) return last.result;
      last = { view, unsent, result: withUnsent(view, unsent) };

      return last.result;
    },
  };
}
