import { lastUserText } from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";

/** The message the web server's provider answers by editing both accents in the sample's `design/tokens.css`. */
export const WARM_PROMPT = "/warm";

/** What the provider says once its edit of `design/tokens.css` is done. */
export const WARM_REPLY = "The accent is warm now, by day and by night.";

/** The edit tool call for {@link WARM_PROMPT}, then {@link WARM_REPLY} once its result is in. */
export function warmReply(request: Request): Reply | undefined {
  if (lastUserText(request) !== WARM_PROMPT) return undefined;

  if (request.context.messages.at(-1)?.role === "toolResult")
    return { content: [{ type: "text", text: WARM_REPLY }] };

  return {
    content: [
      {
        type: "toolCall",
        id: "warm-edit",
        name: "edit",
        arguments: {
          path: "design/tokens.css",
          edits: [
            { oldText: "--accent: #3f58a8;", newText: "--accent: #b4532a;" },
            { oldText: "--accent: #c1d0f6;", newText: "--accent: #ffcf9a;" },
          ],
        },
      },
    ],
  };
}
