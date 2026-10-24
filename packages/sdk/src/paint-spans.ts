import { followedTrace, startSpan, tracing } from "@nyte-ai/core";
import { mapped } from "@nyte-ai/protocol";
import type { SessionId, SessionView } from "@nyte-ai/schema";

/**
 * Returns `views`, each message that arrives after the first view timed as a
 * `client.paint` span from the view that brought it until `painted` resolves:
 * the client's next painted frame. The first view's message that is the
 * submit the session follows, a chat's first message started by this client,
 * is timed too. A user message is its own submit's trace (its id is the
 * receipt id); a part joins the submit the session last followed. With
 * tracing off when called, returns `views` as they are.
 */
export function tracePaints(
  views: AsyncIterable<SessionView>,
  session: SessionId,
  painted: () => Promise<void>,
): AsyncIterable<SessionView> {
  if (!tracing.enabled) return views;

  return {
    [Symbol.asyncIterator]() {
      let shown: SessionView | null = null;

      return mapped(views, (view) => {
        if (view.messages === shown?.messages && view.queue === shown.queue) return view;

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

        return view;
      })[Symbol.asyncIterator]();
    },
  };
}
