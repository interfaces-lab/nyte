import type { Disposer, HeadName, MessageId, QueuedMessage, SessionId } from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import { journals } from "../connection/client.ts";
import type { HeadView } from "../view/head-view.ts";
import { withUnsent } from "../connection/watch.ts";
import { sameJson } from "../live/store.ts";

export interface UnsentSends {
  subscribe(listener: () => void): Disposer;
  /** Lays the head's unsent sends over `view`, returning the view it returned last when `view` and the sends are unchanged. */
  lay(view: HeadView, seq: number | null): HeadView;
  /**
   * The ids of the unsent messages `lay` shows that waited more than a day without the host
   * seeing them. The SDK no longer sends these on its own; each still shows as unsent, its
   * `retrying` reason saying it waited too long. `resend` sends one again; `session.receipt(id).stop()` removes it.
   */
  expired(): readonly MessageId[];
  /** Sends an expired message again, as if it had just been sent. */
  resend(message: MessageId): Promise<void>;
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

  if (journal === undefined)
    return {
      subscribe: () => () => undefined,
      lay: (view) => view,
      expired: () => [],
      resend: async () => undefined,
    };

  return {
    subscribe: (listener) => journal.subscribe(listener),
    expired: () => journal.expired(session, head),
    async resend(message) {
      await journal.resend(session, message);
    },
    lay(view, seq) {
      if (seq !== null) journal.landed(session, head, view, seq);
      const unsent = journal.unsent(session, head);

      if (last !== null && last.view === view && sameJson(last.unsent, unsent)) return last.result;
      last = { view, unsent, result: withUnsent(view, unsent) };

      return last.result;
    },
  };
}
