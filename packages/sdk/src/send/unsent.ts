import type { HeadName, QueuedMessage, SessionId } from "@nyte-ai/schema";
import type { JournalLoop } from "./journal.ts";
import type { HeadView } from "../view/head-view.ts";
import { withUnsent } from "../connection/watch.ts";
import { sameJson } from "../live/store.ts";

interface Laid {
  readonly view: HeadView;
  readonly unsent: readonly QueuedMessage[];
  readonly result: HeadView;
}

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
