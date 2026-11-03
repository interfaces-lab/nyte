import type { Disposer, HeadName, SessionId } from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import { journals } from "./client.ts";
import type { HeadView } from "./head-view.ts";
import { withUnsent } from "./watch.ts";

export interface UnsentSends {
  subscribe(listener: () => void): Disposer;
  lay(view: HeadView, seq: number | null): HeadView;
}

export function unsentSends(
  connection: Connection,
  session: SessionId,
  head: HeadName,
): UnsentSends {
  const journal = journals.get(connection);

  if (journal === undefined) return { subscribe: () => () => undefined, lay: (view) => view };

  return {
    subscribe: (listener) => journal.subscribe(listener),
    lay(view, seq) {
      if (seq !== null) journal.landed(session, head, view, seq);

      return withUnsent(view, journal.unsent(session, head));
    },
  };
}
