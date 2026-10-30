import type { Head, Message, MessageId, SessionView } from "@nyte-ai/sdk";
import { contentDraftText } from "../../references/message-references.ts";

const RECALLED_PROMPTS = 10;

const PROMPT_PAGE = 10;

export type RecallDirection = "older" | "newer";

/** Newest first. `before` is null once there is nothing older to read. */
export interface PromptHistory {
  readonly prompts: readonly string[];
  readonly before: MessageId | null;
}

export function loadedPrompts(
  view: Pick<SessionView, "messages" | "leadingPrompt"> | undefined,
): PromptHistory {
  return morePrompts(
    { prompts: [], before: null },
    view?.leadingPrompt ?? null,
    view?.messages ?? [],
  );
}

/**
 * Reads on before the prompt leading each page, so a long turn costs one read and the messages
 * it skips there, steered ones among them, never count.
 */
export async function readPrompts(
  head: Pick<Head, "history">,
  history: PromptHistory,
  count: number,
): Promise<PromptHistory> {
  if (history.before === null || history.prompts.length >= count) return history;
  const page = await head.history({ before: history.before, limit: PROMPT_PAGE });

  return readPrompts(head, morePrompts(history, page.leadingPrompt, page.messages), count);
}

/** `undefined` is the unsent draft. */
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

function morePrompts(
  history: PromptHistory,
  leading: Message | null,
  messages: readonly Message[],
): PromptHistory {
  const earlier = (leading === null ? messages : [leading, ...messages]).flatMap((message) => {
    if (message.kind !== "user" || message.source.kind !== "user") return [];
    const prompt = contentDraftText(message.content);

    return prompt === "" ? [] : [prompt];
  });

  const prompts = [...history.prompts, ...earlier.toReversed()].slice(0, RECALLED_PROMPTS);
  const first = leading ?? messages[0];

  return {
    prompts,
    before: prompts.length === RECALLED_PROMPTS || first === undefined ? null : first.id,
  };
}
