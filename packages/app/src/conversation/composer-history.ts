import type { Message } from "@nyte-ai/sdk";
import { contentDraftText } from "./message-references.ts";

const RECALLED_PROMPTS = 10;

export type RecallDirection = "older" | "newer";

/** The chat's last prompts the user wrote, newest first. */
export function recentPrompts(messages: readonly Message[]): readonly string[] {
  return messages
    .flatMap((message) => {
      if (message.kind !== "user" || message.source.kind !== "user") return [];
      const prompt = contentDraftText(message.content);

      return prompt === "" ? [] : [prompt];
    })
    .slice(-RECALLED_PROMPTS)
    .toReversed();
}

/**
 * The next place in the prompt history: an index into `recentPrompts`, or `undefined` for the
 * unsent draft. Stepping past the oldest prompt stays on it.
 */
export function recallStep(
  count: number,
  position: number | undefined,
  direction: RecallDirection,
): number | undefined {
  if (direction === "newer")
    return position === undefined || position === 0 ? undefined : position - 1;

  if (count === 0) return undefined;

  return position === undefined ? 0 : Math.min(position + 1, count - 1);
}
