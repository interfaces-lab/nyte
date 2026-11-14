import type { HeadName, QueuedMessage, SessionId } from "@nyte-ai/schema";
import type { JournalLoop } from "./journal.ts";
import type { HeadView } from "../view/head-view.ts";
import { withUnsent } from "../connection/watch.ts";
import { sameJson } from "../live/store.ts";

type Laid = {
  readonly view: HeadView;
  readonly unsent: readonly QueuedMessage[];
  readonly result: HeadView;
};

/** Lays the head's journaled sends over each view it is given, returning the view it returned last when the view and the sends are unchanged. A view at a fresh `seq` tells the journal which sends the host now shows. */
export function laidSends(
  journal: JournalLoop,
  session: SessionId,
  head: HeadName,
): (view: HeadView, seq: number | null) => HeadView {
  let last: Laid | null = null;

  return (view, seq) => {
    if (seq !== null) journal.landed(session, head, view, seq);
    const unsent = journal.unsent(session, head);

    if (last !== null && last.view === view && sameJson(last.unsent, unsent)) return last.result;
    last = { view, unsent, result: withUnsent(view, unsent) };

    return last.result;
  };
}
