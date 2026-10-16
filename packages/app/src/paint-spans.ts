import { followedTrace, startSpan } from "@nyte-ai/sdk";
import type { SessionId, SessionView } from "@nyte-ai/sdk";

/**
 * A session's views, each message that arrives after the first view timed as a
 * `client.paint` span from the view that brought it to the frame after it
 * painted. A user message is its own submit's trace (its id is the receipt id);
 * a part joins the submit the session last followed.
 */
export async function* tracePaints(
  views: AsyncIterable<SessionView>,
  session: SessionId,
): AsyncIterable<SessionView> {
  let seen: Set<string> | null = null;

  for await (const view of views) {
    const known: Set<string> = seen ?? new Set(view.messages.map((message) => message.id));

    for (const message of view.messages) {
      if (known.has(message.id)) continue;
      known.add(message.id);

      const ended = startSpan(
        "client.paint",
        message.kind === "user" ? message.id : followedTrace(session),
        { session, kind: message.kind === "user" ? "user" : message.partKind },
      );

      requestAnimationFrame(() => setTimeout(ended, 0));
    }

    seen = known;
    yield view;
  }
}
