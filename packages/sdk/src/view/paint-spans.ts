import { followedTrace, startSpan, tracing } from "@nyte-ai/core/client";
import { mapped } from "@nyte-ai/protocol";
import type { SessionId, SessionView } from "@nyte-ai/schema";

type Painted = Pick<SessionView, "messages" | "queue">;

/**
 * Returns the step a client calls with each view of `session` it draws, in order. Each message
 * that arrives after the first view is timed as a `client.paint` span from the view that brought
 * it until `painted` resolves: the client's next painted frame. The first view's message that is
 * the submit the session follows, a chat's first message started by this client, is timed too. A
 * user message is its own submit's trace (its id is the receipt id); a part joins the submit the
 * session last followed. With tracing off when called, the step does nothing.
 */
export function paintSpans(
  session: SessionId,
  painted: () => Promise<void>,
): (view: Painted) => void {
  return tracing.enabled ? timePaints(session, painted) : () => undefined;
}

/** Returns `views`, each one passed through `paintSpans`' step on its way. With tracing off when called, returns `views` as they are. */
export function tracePaints<V extends Painted>(
  views: AsyncIterable<V>,
  session: SessionId,
  painted: () => Promise<void>,
): AsyncIterable<V> {
  if (!tracing.enabled) return views;

  return {
    [Symbol.asyncIterator]() {
      const step = timePaints(session, painted);

      return mapped(views, (view) => {
        step(view);

        return view;
      })[Symbol.asyncIterator]();
    },
  };
}

function timePaints(session: SessionId, painted: () => Promise<void>): (view: Painted) => void {
  let shown: Painted | null = null;

  return (view) => {
    if (view.messages === shown?.messages && view.queue === shown.queue) return;

    const known =
      shown === null
        ? null
        : new Set([...shown.messages, ...shown.queue].map((message) => message.id));

    const followed = followedTrace(session);

    for (const message of [...view.messages, ...view.queue]) {
      if (known === null ? message.id !== followed : known.has(message.id)) continue;
      const user = message.kind === "user";

      const ended = startSpan("client.paint", user ? message.id : followed, {
        session,
        kind: user ? "user" : message.partKind,
      });

      void painted().then(() => ended());
    }

    shown = view;
  };
}
